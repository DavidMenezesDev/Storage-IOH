package httpapi

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"storage-ioh/internal/connections"
	"storage-ioh/internal/objects"
	"storage-ioh/internal/search"
	"storage-ioh/internal/storage"
	"storage-ioh/internal/thumbs"
)

const appSyncID = "app"

type target struct {
	conn   *connections.Connection
	client *storage.Client
	bucket string
}

func (s *Server) target(w http.ResponseWriter, r *http.Request) (*target, bool) {
	c, err := s.Conns.Get(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		s.fail(w, r, err)
		return nil, false
	}
	b := chi.URLParam(r, "bucket")
	if b == "" || len(b) > 255 || strings.ContainsAny(b, "/\\") {
		writeErr(w, 400, "bucket inválido")
		return nil, false
	}
	return &target{conn: c, client: s.Pool.For(c), bucket: b}, true
}

func validKey(k string) bool {
	return k != "" && len(k) <= 1024 && !strings.HasPrefix(k, "/") && !strings.ContainsRune(k, 0)
}

func (s *Server) listBuckets(w http.ResponseWriter, r *http.Request) {
	c, err := s.Conns.Get(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		s.fail(w, r, err)
		return
	}
	buckets, err := s.Pool.For(c).ListBuckets(r.Context())
	if err != nil {
		s.fail(w, r, err)
		return
	}
	sums, err := s.Stats.BucketSummaries(r.Context(), c.ID)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	type item struct {
		Name         string     `json:"name"`
		CreatedAt    *time.Time `json:"createdAt"`
		ObjectCount  *int64     `json:"objectCount"`
		TotalBytes   *int64     `json:"totalBytes"`
		LastSyncedAt *time.Time `json:"lastSyncedAt"`
	}
	out := make([]item, 0, len(buckets))
	for _, b := range buckets {
		it := item{Name: b.Name, CreatedAt: b.CreatedAt}
		if sm, ok := sums[b.Name]; ok {
			it.ObjectCount, it.TotalBytes, it.LastSyncedAt = sm.ObjectCount, sm.TotalBytes, sm.LastSyncedAt
		}
		out = append(out, it)
	}
	writeJSON(w, 200, map[string]any{"items": out})
}

func (s *Server) listObjects(w http.ResponseWriter, r *http.Request) {
	t, ok := s.target(w, r)
	if !ok {
		return
	}
	q := r.URL.Query()
	prefix, cursor := q.Get("prefix"), q.Get("cursor")
	if prefix != "" && !strings.HasSuffix(prefix, "/") {
		prefix += "/"
	}
	limit := int32(200)
	if v, err := strconv.Atoi(q.Get("limit")); err == nil && v > 0 {
		limit = int32(min(v, 1000))
	}
	var l storage.Listing
	if s.Cache.GetListing(r.Context(), t.conn.ID, t.bucket, prefix, cursor, limit, &l) {
		writeJSON(w, 200, l)
		return
	}
	res, err := t.client.List(r.Context(), t.bucket, prefix, cursor, limit)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	s.Cache.SetListing(r.Context(), t.conn.ID, t.bucket, prefix, cursor, limit, res)
	writeJSON(w, 200, res)
}

func (s *Server) objectMeta(w http.ResponseWriter, r *http.Request) {
	t, ok := s.target(w, r)
	if !ok {
		return
	}
	key := r.URL.Query().Get("key")
	if !validKey(key) {
		writeErr(w, 400, "key inválida")
		return
	}
	m, err := t.client.Head(r.Context(), t.bucket, key)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, 200, m)
}

func contentDisposition(kind, name string) string {
	ascii := strings.Map(func(r rune) rune {
		if r < 0x20 || r > 0x7e || r == '"' || r == '\\' {
			return '_'
		}
		return r
	}, name)
	return fmt.Sprintf(`%s; filename="%s"; filename*=UTF-8''%s`, kind, ascii, url.PathEscape(name))
}

func (s *Server) objectContent(w http.ResponseWriter, r *http.Request) {
	t, ok := s.target(w, r)
	if !ok {
		return
	}
	key := r.URL.Query().Get("key")
	if !validKey(key) {
		writeErr(w, 400, "key inválida")
		return
	}
	download := r.URL.Query().Get("download") == "1"
	name := path.Base(key)

	if s.Cfg.PreviewMode == "presigned" {
		disp := ""
		if download {
			disp = contentDisposition("attachment", name)
		}
		u, err := t.client.PresignGet(r.Context(), t.bucket, key, disp, 15*time.Minute)
		if err != nil {
			s.fail(w, r, err)
			return
		}
		http.Redirect(w, r, u, http.StatusFound)
		return
	}

	if download {
		s.audit(r, auditEvent{Action: "object.download", ConnectionID: t.conn.ID, Bucket: t.bucket, Key: key})
	}
	s.streamObject(w, r, t.client, t.bucket, key, download, 60)
}

// streamObject faz o proxy do objeto com suporte a Range e cabeçalhos seguros.
func (s *Server) streamObject(w http.ResponseWriter, r *http.Request, cl *storage.Client, bucket, key string, download bool, maxAge int) {
	obj, err := cl.Get(r.Context(), bucket, key, r.Header.Get("Range"))
	if err != nil {
		s.fail(w, r, err)
		return
	}
	defer obj.Body.Close()
	name := path.Base(key)
	ext := objects.Ext(key)
	ct := obj.ContentType
	if ct == "" || ct == "binary/octet-stream" || ct == "application/octet-stream" {
		ct = objects.ContentTypeOf(ext)
	}
	h := w.Header()
	h.Set("Content-Type", ct)
	h.Set("Accept-Ranges", "bytes")
	h.Set("X-Content-Type-Options", "nosniff")
	// Conteúdo do bucket nunca deve executar no contexto do app (HTML/SVG maliciosos).
	h.Set("Content-Security-Policy", "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox")
	if maxAge > 0 {
		h.Set("Cache-Control", "private, max-age="+strconv.Itoa(maxAge))
	} else {
		h.Set("Cache-Control", "no-store")
	}
	if obj.ETag != "" {
		h.Set("ETag", obj.ETag)
	}
	if !obj.LastModified.IsZero() {
		h.Set("Last-Modified", obj.LastModified.UTC().Format(http.TimeFormat))
	}
	if obj.ContentLength >= 0 {
		h.Set("Content-Length", strconv.FormatInt(obj.ContentLength, 10))
	}
	if download {
		h.Set("Content-Disposition", contentDisposition("attachment", name))
	} else {
		h.Set("Content-Disposition", contentDisposition("inline", name))
	}
	status := http.StatusOK
	if obj.ContentRange != "" {
		h.Set("Content-Range", obj.ContentRange)
		status = http.StatusPartialContent
	}
	w.WriteHeader(status)
	if r.Method == http.MethodHead {
		return
	}
	_, _ = io.Copy(w, obj.Body)
}

func (s *Server) objectThumb(w http.ResponseWriter, r *http.Request) {
	t, ok := s.target(w, r)
	if !ok {
		return
	}
	q := r.URL.Query()
	key := q.Get("key")
	if !validKey(key) {
		writeErr(w, 400, "key inválida")
		return
	}
	size := 256
	if v, err := strconv.Atoi(q.Get("size")); err == nil {
		size = max(64, min(v, 1024))
	}
	if !s.Thumbs.Supports(objects.Ext(key)) {
		writeErr(w, 404, "sem miniatura para este tipo")
		return
	}
	etag := q.Get("etag")
	if etag == "" {
		m, err := t.client.Head(r.Context(), t.bucket, key)
		if err != nil {
			s.fail(w, r, err)
			return
		}
		etag = m.ETag
	}
	file, err := s.Thumbs.Get(r.Context(), t.client, t.conn.ID, t.bucket, key, etag, size)
	if errors.Is(err, thumbs.ErrUnsupported) {
		writeErr(w, 404, "não foi possível gerar miniatura")
		return
	}
	if err != nil {
		s.fail(w, r, err)
		return
	}
	f, err := os.Open(file)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	defer f.Close()
	w.Header().Set("Content-Type", "image/jpeg")
	w.Header().Set("Cache-Control", "private, max-age=86400")
	_, _ = io.Copy(w, f)
}

// ---- mutações ----

func (s *Server) afterMutation(r *http.Request, t *target) {
	s.Cache.Invalidate(r.Context(), t.conn.ID, t.bucket)
}

func (s *Server) indexItems(r *http.Request, t *target, items []objects.Item) {
	if !t.conn.IndexEnabled || len(items) == 0 {
		return
	}
	docs := make([]search.Doc, len(items))
	for i, it := range items {
		docs[i] = search.NewDoc(t.conn.ID, t.bucket, appSyncID, it)
	}
	if err := s.Index.Upsert(r.Context(), docs, false); err != nil {
		s.Log.Warn("falha ao indexar objetos", "err", err)
	}
}

func (s *Server) unindexKeys(r *http.Request, t *target, keys []string) {
	ids := make([]string, len(keys))
	for i, k := range keys {
		ids[i] = objects.DocID(t.conn.ID, t.bucket, k)
	}
	if err := s.Index.DeleteIDs(r.Context(), ids); err != nil {
		s.Log.Warn("falha ao remover objetos do índice", "err", err)
	}
}

func cleanUploadName(name string) (string, bool) {
	name = strings.ReplaceAll(name, "\\", "/")
	parts := strings.Split(name, "/")
	out := parts[:0]
	for _, p := range parts {
		switch p {
		case "", ".":
			continue
		case "..":
			return "", false
		}
		out = append(out, p)
	}
	if len(out) == 0 {
		return "", false
	}
	return strings.Join(out, "/"), true
}

func (s *Server) upload(w http.ResponseWriter, r *http.Request) {
	t, ok := s.target(w, r)
	if !ok {
		return
	}
	prefix := r.URL.Query().Get("prefix")
	if prefix != "" && !strings.HasSuffix(prefix, "/") {
		prefix += "/"
	}
	r.Body = http.MaxBytesReader(w, r.Body, s.Cfg.UploadMaxMB<<20)
	mr, err := r.MultipartReader()
	if err != nil {
		writeErr(w, 400, "esperado multipart/form-data")
		return
	}
	uploaded := []objects.Item{}
	defer func() {
		if len(uploaded) > 0 {
			s.afterMutation(r, t)
			s.indexItems(r, t, uploaded)
		}
	}()
	for {
		part, err := mr.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			writeErr(w, 400, "upload interrompido: "+err.Error())
			return
		}
		if part.FormName() != "files" || part.FileName() == "" {
			part.Close()
			continue
		}
		// FileName() descarta diretórios; usamos o nome bruto para permitir upload de pastas.
		raw := part.FileName()
		if _, params, err := parseDisposition(part.Header.Get("Content-Disposition")); err == nil && params["filename"] != "" {
			raw = params["filename"]
		}
		rel, ok := cleanUploadName(raw)
		if !ok {
			part.Close()
			writeErr(w, 400, "nome de arquivo inválido: "+raw)
			return
		}
		key := prefix + rel
		var prevSize int64 = -1
		if m, err := t.client.Head(r.Context(), t.bucket, key); err == nil {
			prevSize = m.Size
		}
		cr := &countingReader{r: part}
		if err := t.client.Put(r.Context(), t.bucket, key, part.Header.Get("Content-Type"), cr); err != nil {
			part.Close()
			s.fail(w, r, err)
			return
		}
		part.Close()
		it := objects.NewItem(key, cr.n, time.Now(), "")
		if m, err := t.client.Head(r.Context(), t.bucket, key); err == nil {
			it = m.Item
		}
		uploaded = append(uploaded, it)
		if prevSize >= 0 {
			_ = s.Stats.AdjustBucket(r.Context(), t.conn.ID, t.bucket, it.Category, 0, it.Size-prevSize)
		} else {
			_ = s.Stats.AdjustBucket(r.Context(), t.conn.ID, t.bucket, it.Category, 1, it.Size)
		}
	}
	for _, it := range uploaded {
		s.audit(r, auditEvent{Action: "object.upload", ConnectionID: t.conn.ID, Bucket: t.bucket, Key: it.Key, Detail: map[string]any{"size": it.Size}})
	}
	writeJSON(w, 200, map[string]any{"uploaded": uploaded})
}

type countingReader struct {
	r io.Reader
	n int64
}

func (c *countingReader) Read(p []byte) (int, error) {
	n, err := c.r.Read(p)
	c.n += int64(n)
	return n, err
}

func (s *Server) createFolder(w http.ResponseWriter, r *http.Request) {
	t, ok := s.target(w, r)
	if !ok {
		return
	}
	var body struct {
		Prefix string `json:"prefix"`
	}
	if err := decode(r, &body); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	p, ok := cleanUploadName(body.Prefix)
	if !ok {
		writeErr(w, 400, "nome de pasta inválido")
		return
	}
	p += "/"
	if err := t.client.Put(r.Context(), t.bucket, p, "application/x-directory", bytes.NewReader(nil)); err != nil {
		s.fail(w, r, err)
		return
	}
	s.afterMutation(r, t)
	writeJSON(w, 201, map[string]string{"prefix": p})
}

func (s *Server) deleteObjects(w http.ResponseWriter, r *http.Request) {
	t, ok := s.target(w, r)
	if !ok {
		return
	}
	var body struct {
		Keys []string `json:"keys"`
	}
	if err := decode(r, &body); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	if len(body.Keys) == 0 || len(body.Keys) > 1000 {
		writeErr(w, 400, "informe entre 1 e 1000 chaves")
		return
	}
	var items []objects.Item
	var keys []string
	for _, k := range body.Keys {
		if !validKey(k) {
			writeErr(w, 400, "key inválida: "+k)
			return
		}
		if strings.HasSuffix(k, "/") {
			keys = append(keys, k) // marcador da pasta, se existir
			err := t.client.Walk(r.Context(), t.bucket, k, func(page []objects.Item) error {
				for _, it := range page {
					if it.Key != k {
						items = append(items, it)
						keys = append(keys, it.Key)
					}
				}
				return nil
			})
			if err != nil {
				s.fail(w, r, err)
				return
			}
			continue
		}
		m, err := t.client.Head(r.Context(), t.bucket, k)
		if errors.Is(err, storage.ErrNotFound) {
			continue
		}
		if err != nil {
			s.fail(w, r, err)
			return
		}
		items = append(items, m.Item)
		keys = append(keys, k)
	}
	n, err := t.client.DeleteKeys(r.Context(), t.bucket, keys)
	s.audit(r, auditEvent{Action: "object.delete", ConnectionID: t.conn.ID, Bucket: t.bucket,
		Detail: map[string]any{"requested": body.Keys, "deleted": n}})
	s.afterMutation(r, t)
	s.unindexKeys(r, t, keys)
	for _, it := range items {
		_ = s.Stats.AdjustBucket(r.Context(), t.conn.ID, t.bucket, it.Category, -1, -it.Size)
	}
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, 200, map[string]int{"deleted": n})
}

func (s *Server) renameObject(w http.ResponseWriter, r *http.Request) {
	t, ok := s.target(w, r)
	if !ok {
		return
	}
	var body struct {
		From string `json:"from"`
		To   string `json:"to"`
	}
	if err := decode(r, &body); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	if !validKey(body.From) || !validKey(body.To) || body.From == body.To {
		writeErr(w, 400, "origem/destino inválidos")
		return
	}
	isDir := strings.HasSuffix(body.From, "/")
	if isDir != strings.HasSuffix(body.To, "/") {
		writeErr(w, 400, "pasta só pode ser renomeada para pasta (terminar com /)")
		return
	}
	if isDir && strings.HasPrefix(body.To, body.From) {
		writeErr(w, 400, "não é possível mover uma pasta para dentro dela mesma")
		return
	}
	type mv struct{ from, to string }
	var moves []mv
	if isDir {
		err := t.client.Walk(r.Context(), t.bucket, body.From, func(page []objects.Item) error {
			for _, it := range page {
				moves = append(moves, mv{it.Key, body.To + strings.TrimPrefix(it.Key, body.From)})
			}
			return nil
		})
		if err != nil {
			s.fail(w, r, err)
			return
		}
		if len(moves) == 0 {
			writeErr(w, 404, "pasta vazia ou inexistente")
			return
		}
	} else {
		moves = []mv{{body.From, body.To}}
	}
	var done []objects.Item
	var oldKeys []string
	for _, m := range moves {
		if err := t.client.Copy(r.Context(), t.bucket, m.from, m.to); err != nil {
			s.fail(w, r, err)
			return
		}
		oldKeys = append(oldKeys, m.from)
	}
	if _, err := t.client.DeleteKeys(r.Context(), t.bucket, oldKeys); err != nil {
		s.fail(w, r, err)
		return
	}
	for _, m := range moves {
		if strings.HasSuffix(m.to, "/") {
			continue
		}
		if meta, err := t.client.Head(r.Context(), t.bucket, m.to); err == nil {
			done = append(done, meta.Item)
		}
	}
	s.audit(r, auditEvent{Action: "object.rename", ConnectionID: t.conn.ID, Bucket: t.bucket, Key: body.To,
		Detail: map[string]any{"from": body.From, "to": body.To, "objects": len(moves)}})
	s.afterMutation(r, t)
	s.unindexKeys(r, t, oldKeys)
	s.indexItems(r, t, done)
	if isDir {
		writeJSON(w, 200, objects.Item{Key: body.To, Name: path.Base(strings.TrimSuffix(body.To, "/")), Category: "other", LastModified: time.Now().UTC()})
		return
	}
	if len(done) == 0 {
		writeErr(w, 500, "objeto renomeado mas não encontrado no destino")
		return
	}
	writeJSON(w, 200, done[0])
}
