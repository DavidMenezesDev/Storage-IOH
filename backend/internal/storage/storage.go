// Package storage encapsula o acesso S3-compatível (AWS S3, Cloudflare R2, MinIO).
package storage

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/feature/s3/manager"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/aws/smithy-go"

	"storage-ioh/internal/connections"
	"storage-ioh/internal/objects"
)

var ErrNotFound = errors.New("objeto não encontrado")

type Bucket struct {
	Name      string     `json:"name"`
	CreatedAt *time.Time `json:"createdAt"`
}

type Listing struct {
	Prefix     string           `json:"prefix"`
	Folders    []objects.Folder `json:"folders"`
	Objects    []objects.Item   `json:"objects"`
	NextCursor *string          `json:"nextCursor"`
}

type Meta struct {
	objects.Item
	Metadata map[string]string `json:"metadata"`
}

// Client é um cliente para uma conexão. Para AWS S3 descobre a região de cada bucket.
type Client struct {
	conn    *connections.Connection
	base    *s3.Client
	httpc   *http.Client
	mu      sync.Mutex
	regions map[string]*s3.Client
}

var sharedHTTP = &http.Client{Transport: &http.Transport{
	Proxy:               http.ProxyFromEnvironment,
	MaxIdleConns:        200,
	MaxIdleConnsPerHost: 50,
	IdleConnTimeout:     90 * time.Second,
}}

func newS3(c *connections.Connection, region string) *s3.Client {
	cfg := aws.Config{
		Region:      region,
		Credentials: credentials.NewStaticCredentialsProvider(c.AccessKeyID, c.SecretAccessKey, ""),
		HTTPClient:  sharedHTTP,
		// R2/MinIO não suportam todos os checksums que o SDK calcula por padrão.
		RequestChecksumCalculation: aws.RequestChecksumCalculationWhenRequired,
		ResponseChecksumValidation: aws.ResponseChecksumValidationWhenRequired,
		RetryMaxAttempts:           3,
	}
	return s3.NewFromConfig(cfg, func(o *s3.Options) {
		if c.Endpoint != "" {
			o.BaseEndpoint = aws.String(c.Endpoint)
		}
		o.UsePathStyle = c.ForcePathStyle
	})
}

func New(c *connections.Connection) *Client {
	return &Client{conn: c, base: newS3(c, c.Region), httpc: sharedHTTP, regions: map[string]*s3.Client{}}
}

// Pool reaproveita clientes enquanto a conexão não muda (chave: id+updatedAt).
type Pool struct {
	mu      sync.Mutex
	clients map[string]*Client
}

func NewPool() *Pool { return &Pool{clients: map[string]*Client{}} }

func (p *Pool) For(c *connections.Connection) *Client {
	key := c.ID + "@" + c.UpdatedAt.Format(time.RFC3339Nano)
	p.mu.Lock()
	defer p.mu.Unlock()
	if cl, ok := p.clients[key]; ok {
		return cl
	}
	for k := range p.clients {
		if strings.HasPrefix(k, c.ID+"@") {
			delete(p.clients, k)
		}
	}
	cl := New(c)
	p.clients[key] = cl
	return cl
}

func (c *Client) forBucket(ctx context.Context, bucket string) *s3.Client {
	if c.conn.Provider != "s3" || c.conn.Endpoint != "" {
		return c.base
	}
	c.mu.Lock()
	cl, ok := c.regions[bucket]
	c.mu.Unlock()
	if ok {
		return cl
	}
	region := c.conn.Region
	if out, err := c.base.GetBucketLocation(ctx, &s3.GetBucketLocationInput{Bucket: &bucket}); err == nil {
		region = string(out.LocationConstraint)
		if region == "" {
			region = "us-east-1"
		}
	}
	cl = c.base
	if region != c.conn.Region {
		cl = newS3(c.conn, region)
	}
	c.mu.Lock()
	c.regions[bucket] = cl
	c.mu.Unlock()
	return cl
}

func (c *Client) ListBuckets(ctx context.Context) ([]Bucket, error) {
	out, err := c.base.ListBuckets(ctx, &s3.ListBucketsInput{})
	if err != nil {
		return nil, wrap(err)
	}
	res := make([]Bucket, 0, len(out.Buckets))
	for _, b := range out.Buckets {
		res = append(res, Bucket{Name: aws.ToString(b.Name), CreatedAt: b.CreationDate})
	}
	sort.Slice(res, func(i, j int) bool { return res[i].Name < res[j].Name })
	return res, nil
}

func (c *Client) List(ctx context.Context, bucket, prefix, cursor string, limit int32) (*Listing, error) {
	in := &s3.ListObjectsV2Input{
		Bucket:    &bucket,
		Prefix:    aws.String(prefix),
		Delimiter: aws.String("/"),
		MaxKeys:   aws.Int32(limit),
	}
	if cursor != "" {
		in.ContinuationToken = &cursor
	}
	out, err := c.forBucket(ctx, bucket).ListObjectsV2(ctx, in)
	if err != nil {
		return nil, wrap(err)
	}
	l := &Listing{Prefix: prefix, Folders: []objects.Folder{}, Objects: []objects.Item{}}
	for _, p := range out.CommonPrefixes {
		pf := aws.ToString(p.Prefix)
		l.Folders = append(l.Folders, objects.Folder{Name: strings.TrimSuffix(strings.TrimPrefix(pf, prefix), "/"), Prefix: pf})
	}
	for _, o := range out.Contents {
		k := aws.ToString(o.Key)
		if k == prefix { // marcador de pasta
			continue
		}
		l.Objects = append(l.Objects, objects.NewItem(k, aws.ToInt64(o.Size), aws.ToTime(o.LastModified), aws.ToString(o.ETag)))
	}
	if aws.ToBool(out.IsTruncated) && out.NextContinuationToken != nil {
		l.NextCursor = out.NextContinuationToken
	}
	return l, nil
}

// Walk percorre recursivamente todos os objetos sob prefix (sem delimitador), página a página.
func (c *Client) Walk(ctx context.Context, bucket, prefix string, fn func([]objects.Item) error) error {
	p := s3.NewListObjectsV2Paginator(c.forBucket(ctx, bucket), &s3.ListObjectsV2Input{
		Bucket: &bucket, Prefix: aws.String(prefix), MaxKeys: aws.Int32(1000),
	})
	for p.HasMorePages() {
		page, err := p.NextPage(ctx)
		if err != nil {
			return wrap(err)
		}
		items := make([]objects.Item, 0, len(page.Contents))
		for _, o := range page.Contents {
			items = append(items, objects.NewItem(aws.ToString(o.Key), aws.ToInt64(o.Size), aws.ToTime(o.LastModified), aws.ToString(o.ETag)))
		}
		if err := fn(items); err != nil {
			return err
		}
	}
	return nil
}

func (c *Client) Head(ctx context.Context, bucket, key string) (*Meta, error) {
	out, err := c.forBucket(ctx, bucket).HeadObject(ctx, &s3.HeadObjectInput{Bucket: &bucket, Key: &key})
	if err != nil {
		return nil, wrap(err)
	}
	m := &Meta{
		Item:     objects.NewItem(key, aws.ToInt64(out.ContentLength), aws.ToTime(out.LastModified), aws.ToString(out.ETag)),
		Metadata: out.Metadata,
	}
	if m.Metadata == nil {
		m.Metadata = map[string]string{}
	}
	if ct := aws.ToString(out.ContentType); ct != "" && ct != "binary/octet-stream" && ct != "application/octet-stream" {
		m.ContentType = ct
	}
	return m, nil
}

type Object struct {
	Body          io.ReadCloser
	ContentType   string
	ContentLength int64
	ContentRange  string
	ETag          string
	LastModified  time.Time
}

func (c *Client) Get(ctx context.Context, bucket, key, rangeHeader string) (*Object, error) {
	in := &s3.GetObjectInput{Bucket: &bucket, Key: &key}
	if rangeHeader != "" {
		in.Range = &rangeHeader
	}
	out, err := c.forBucket(ctx, bucket).GetObject(ctx, in)
	if err != nil {
		return nil, wrap(err)
	}
	return &Object{
		Body:          out.Body,
		ContentType:   aws.ToString(out.ContentType),
		ContentLength: aws.ToInt64(out.ContentLength),
		ContentRange:  aws.ToString(out.ContentRange),
		ETag:          aws.ToString(out.ETag),
		LastModified:  aws.ToTime(out.LastModified),
	}, nil
}

func (c *Client) PresignGet(ctx context.Context, bucket, key, disposition string, ttl time.Duration) (string, error) {
	in := &s3.GetObjectInput{Bucket: &bucket, Key: &key}
	if disposition != "" {
		in.ResponseContentDisposition = &disposition
	}
	req, err := s3.NewPresignClient(c.forBucket(ctx, bucket)).PresignGetObject(ctx, in, s3.WithPresignExpires(ttl))
	if err != nil {
		return "", wrap(err)
	}
	return req.URL, nil
}

func (c *Client) Put(ctx context.Context, bucket, key, contentType string, body io.Reader) error {
	up := manager.NewUploader(c.forBucket(ctx, bucket), func(u *manager.Uploader) {
		u.PartSize = 16 << 20
		u.Concurrency = 3
	})
	if contentType == "" {
		contentType = objects.ContentTypeOf(objects.Ext(key))
	}
	_, err := up.Upload(ctx, &s3.PutObjectInput{Bucket: &bucket, Key: &key, Body: body, ContentType: &contentType})
	return wrap(err)
}

// PutLarge envia arquivos grandes (backups) em partes de 32 MB — até ~320 GB por arquivo.
func (c *Client) PutLarge(ctx context.Context, bucket, key, contentType string, body io.Reader) error {
	up := manager.NewUploader(c.forBucket(ctx, bucket), func(u *manager.Uploader) {
		u.PartSize = 32 << 20
		u.Concurrency = 2
	})
	_, err := up.Upload(ctx, &s3.PutObjectInput{Bucket: &bucket, Key: &key, Body: body, ContentType: &contentType})
	return wrap(err)
}

func (c *Client) Copy(ctx context.Context, bucket, from, to string) error {
	src := bucket + "/" + escapeKey(from)
	_, err := c.forBucket(ctx, bucket).CopyObject(ctx, &s3.CopyObjectInput{Bucket: &bucket, Key: &to, CopySource: &src})
	return wrap(err)
}

// DeleteKeys apaga até N chaves em lotes de 1000.
func (c *Client) DeleteKeys(ctx context.Context, bucket string, keys []string) (int, error) {
	cl := c.forBucket(ctx, bucket)
	deleted := 0
	for i := 0; i < len(keys); i += 1000 {
		end := min(i+1000, len(keys))
		ids := make([]types.ObjectIdentifier, 0, end-i)
		for _, k := range keys[i:end] {
			ids = append(ids, types.ObjectIdentifier{Key: aws.String(k)})
		}
		out, err := cl.DeleteObjects(ctx, &s3.DeleteObjectsInput{
			Bucket: &bucket, Delete: &types.Delete{Objects: ids, Quiet: aws.Bool(true)},
		})
		if err != nil {
			return deleted, wrap(err)
		}
		if len(out.Errors) > 0 {
			e := out.Errors[0]
			return deleted + len(ids) - len(out.Errors), fmt.Errorf("falha ao apagar %s: %s", aws.ToString(e.Key), aws.ToString(e.Message))
		}
		deleted += len(ids)
	}
	return deleted, nil
}

func escapeKey(k string) string {
	parts := strings.Split(k, "/")
	for i, p := range parts {
		parts[i] = urlPathEscape(p)
	}
	return strings.Join(parts, "/")
}

func urlPathEscape(s string) string {
	const hex = "0123456789ABCDEF"
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		ch := s[i]
		if ('a' <= ch && ch <= 'z') || ('A' <= ch && ch <= 'Z') || ('0' <= ch && ch <= '9') || strings.IndexByte("-_.~", ch) >= 0 {
			b.WriteByte(ch)
		} else {
			b.WriteByte('%')
			b.WriteByte(hex[ch>>4])
			b.WriteByte(hex[ch&15])
		}
	}
	return b.String()
}

// Error carrega o status HTTP sugerido para erros do provedor.
type Error struct {
	Status int
	Msg    string
}

func (e *Error) Error() string { return e.Msg }

func wrap(err error) error {
	if err == nil {
		return nil
	}
	var nsk *types.NoSuchKey
	var nf *types.NotFound
	var nsb *types.NoSuchBucket
	if errors.As(err, &nsk) || errors.As(err, &nf) {
		return ErrNotFound
	}
	if errors.As(err, &nsb) {
		return &Error{Status: http.StatusNotFound, Msg: "bucket não encontrado"}
	}
	var ae smithy.APIError
	if errors.As(err, &ae) {
		switch ae.ErrorCode() {
		case "AccessDenied", "InvalidAccessKeyId", "SignatureDoesNotMatch", "Forbidden":
			return &Error{Status: http.StatusForbidden, Msg: "acesso negado pelo provedor: " + ae.ErrorCode()}
		case "InvalidRange":
			return &Error{Status: http.StatusRequestedRangeNotSatisfiable, Msg: "range inválido"}
		case "NoSuchKey", "NotFound":
			return ErrNotFound
		}
		return &Error{Status: http.StatusBadGateway, Msg: "erro do provedor: " + ae.ErrorCode() + ": " + ae.ErrorMessage()}
	}
	if errors.Is(err, context.Canceled) {
		return err
	}
	return &Error{Status: http.StatusBadGateway, Msg: "falha ao falar com o provedor: " + err.Error()}
}
