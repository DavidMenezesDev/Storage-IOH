// Package search mantém o índice de objetos no Meilisearch.
package search

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/meilisearch/meilisearch-go"

	"storage-ioh/internal/objects"
)

const indexUID = "objects"

type Doc struct {
	ID           string `json:"id"`
	ConnectionID string `json:"connection_id"`
	Bucket       string `json:"bucket"`
	Key          string `json:"key"`
	Name         string `json:"name"`
	Prefix       string `json:"prefix"`
	Ext          string `json:"ext"`
	Category     string `json:"category"`
	ContentType  string `json:"content_type"`
	Size         int64  `json:"size"`
	LastModified int64  `json:"last_modified"`
	ETag         string `json:"etag"`
	SyncID       string `json:"sync_id"`
}

func NewDoc(connID, bucket, syncID string, it objects.Item) Doc {
	prefix := ""
	if i := strings.LastIndexByte(it.Key, '/'); i >= 0 {
		prefix = it.Key[:i+1]
	}
	return Doc{
		ID: objects.DocID(connID, bucket, it.Key), ConnectionID: connID, Bucket: bucket,
		Key: it.Key, Name: it.Name, Prefix: prefix, Ext: it.Ext, Category: it.Category,
		ContentType: it.ContentType, Size: it.Size, LastModified: it.LastModified.Unix(), ETag: it.ETag, SyncID: syncID,
	}
}

func (d Doc) Item() objects.Item {
	return objects.Item{
		Key: d.Key, Name: d.Name, Size: d.Size, LastModified: time.Unix(d.LastModified, 0).UTC(),
		ETag: d.ETag, Category: d.Category, Ext: d.Ext, ContentType: d.ContentType,
	}
}

type Index struct {
	client meilisearch.ServiceManager
	idx    meilisearch.IndexManager
}

func New(url, key string) *Index {
	c := meilisearch.New(url, meilisearch.WithAPIKey(key))
	return &Index{client: c, idx: c.Index(indexUID)}
}

func (s *Index) Healthy() bool { return s.client.IsHealthy() }

// Setup cria o índice e aplica as configurações (idempotente).
func (s *Index) Setup(ctx context.Context) error {
	if _, err := s.client.GetIndex(indexUID); err != nil {
		t, err := s.client.CreateIndex(&meilisearch.IndexConfig{Uid: indexUID, PrimaryKey: "id"})
		if err != nil {
			return fmt.Errorf("meilisearch: criar índice: %w", err)
		}
		if err := s.wait(ctx, t); err != nil {
			return err
		}
	}
	t, err := s.idx.UpdateSettings(&meilisearch.Settings{
		SearchableAttributes: []string{"name", "key"},
		FilterableAttributes: []string{"connection_id", "bucket", "prefix", "ext", "category", "size", "last_modified", "sync_id"},
		SortableAttributes:   []string{"name", "size", "last_modified"},
		Pagination:           &meilisearch.Pagination{MaxTotalHits: 100000},
		Faceting:             &meilisearch.Faceting{MaxValuesPerFacet: 100},
		SeparatorTokens:      []string{"/", "_", "-", "."},
	})
	if err != nil {
		return fmt.Errorf("meilisearch: settings: %w", err)
	}
	return s.wait(ctx, t)
}

func (s *Index) wait(ctx context.Context, t *meilisearch.TaskInfo) error {
	task, err := s.client.WaitForTaskWithContext(ctx, t.TaskUID, 200*time.Millisecond)
	if err != nil {
		return err
	}
	if task.Status == meilisearch.TaskStatusFailed {
		return fmt.Errorf("meilisearch: tarefa %d falhou: %s", task.UID, task.Error.Message)
	}
	return nil
}

func (s *Index) Upsert(ctx context.Context, docs []Doc, wait bool) error {
	if len(docs) == 0 {
		return nil
	}
	pk := "id"
	t, err := s.idx.AddDocumentsWithContext(ctx, docs, &meilisearch.DocumentOptions{PrimaryKey: &pk})
	if err != nil {
		return err
	}
	if wait {
		return s.wait(ctx, t)
	}
	return nil
}

func (s *Index) DeleteIDs(ctx context.Context, ids []string) error {
	if len(ids) == 0 {
		return nil
	}
	_, err := s.idx.DeleteDocumentsWithContext(ctx, ids, nil)
	return err
}

func (s *Index) DeleteByFilter(ctx context.Context, filter string, wait bool) error {
	t, err := s.idx.DeleteDocumentsByFilterWithContext(ctx, filter, nil)
	if err != nil {
		return err
	}
	if wait {
		return s.wait(ctx, t)
	}
	return nil
}

// Quote escapa um valor para o filtro do Meilisearch.
func Quote(v string) string {
	return `"` + strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(v) + `"`
}

type Query struct {
	Q          string
	Connection string
	Bucket     string
	Category   string
	Ext        string
	MinSize    *int64
	MaxSize    *int64
	From       *time.Time
	To         *time.Time
	Sort       string
	Page       int64
	Limit      int64
}

type Hit struct {
	ConnectionID string `json:"connectionId"`
	Bucket       string `json:"bucket"`
	objects.Item
}

type Result struct {
	Hits             []Hit                       `json:"hits"`
	Total            int64                       `json:"total"`
	Page             int64                       `json:"page"`
	Limit            int64                       `json:"limit"`
	ProcessingTimeMs int64                       `json:"processingTimeMs"`
	Facets           map[string]map[string]int64 `json:"facets"`
}

var sortFields = map[string]string{"name": "name", "size": "size", "lastModified": "last_modified"}

func (s *Index) Search(ctx context.Context, q Query) (*Result, error) {
	var filters []string
	eq := func(field, v string) {
		if v == "" {
			return
		}
		var ors []string
		for _, part := range strings.Split(v, ",") {
			if part = strings.TrimSpace(part); part != "" {
				ors = append(ors, field+" = "+Quote(part))
			}
		}
		if len(ors) > 0 {
			filters = append(filters, "("+strings.Join(ors, " OR ")+")")
		}
	}
	eq("connection_id", q.Connection)
	eq("bucket", q.Bucket)
	eq("category", q.Category)
	eq("ext", strings.ToLower(q.Ext))
	if q.MinSize != nil {
		filters = append(filters, "size >= "+strconv.FormatInt(*q.MinSize, 10))
	}
	if q.MaxSize != nil {
		filters = append(filters, "size <= "+strconv.FormatInt(*q.MaxSize, 10))
	}
	if q.From != nil {
		filters = append(filters, "last_modified >= "+strconv.FormatInt(q.From.Unix(), 10))
	}
	if q.To != nil {
		filters = append(filters, "last_modified <= "+strconv.FormatInt(q.To.Unix(), 10))
	}
	if q.Page < 1 {
		q.Page = 1
	}
	if q.Limit < 1 || q.Limit > 100 {
		q.Limit = 50
	}
	req := &meilisearch.SearchRequest{
		Page:        q.Page,
		HitsPerPage: &q.Limit,
		Facets:      []string{"bucket", "category", "ext"},
	}
	if len(filters) > 0 {
		req.Filter = strings.Join(filters, " AND ")
	}
	if q.Sort != "" {
		field, dir, _ := strings.Cut(q.Sort, ":")
		if f, ok := sortFields[field]; ok {
			if dir != "desc" {
				dir = "asc"
			}
			req.Sort = []string{f + ":" + dir}
		}
	}
	res, err := s.idx.SearchWithContext(ctx, q.Q, req)
	if err != nil {
		return nil, err
	}
	var docs []Doc
	if err := res.Hits.DecodeInto(&docs); err != nil {
		return nil, err
	}
	out := &Result{
		Hits: make([]Hit, 0, len(docs)), Total: res.TotalHits, Page: q.Page, Limit: q.Limit,
		ProcessingTimeMs: res.ProcessingTimeMs,
		Facets:           map[string]map[string]int64{"bucket": {}, "category": {}, "ext": {}},
	}
	for _, d := range docs {
		out.Hits = append(out.Hits, Hit{ConnectionID: d.ConnectionID, Bucket: d.Bucket, Item: d.Item()})
	}
	if len(res.FacetDistribution) > 0 {
		var fd map[string]map[string]int64
		if err := json.Unmarshal(res.FacetDistribution, &fd); err == nil {
			for k, v := range fd {
				out.Facets[k] = v
			}
		}
	}
	return out, nil
}
