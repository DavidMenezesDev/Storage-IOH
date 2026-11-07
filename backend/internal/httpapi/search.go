package httpapi

import (
	"mime"
	"net/http"
	"strconv"
	"time"

	"storage-ioh/internal/search"
)

func parseDisposition(v string) (string, map[string]string, error) { return mime.ParseMediaType(v) }

type searchHit struct {
	search.Hit
	ConnectionName string `json:"connectionName"`
}

func (s *Server) connNames(r *http.Request) map[string]string {
	names := map[string]string{}
	if conns, err := s.Conns.List(r.Context()); err == nil {
		for _, c := range conns {
			names[c.ID] = c.Name
		}
	}
	return names
}

func withNames(hits []search.Hit, names map[string]string) []searchHit {
	out := make([]searchHit, 0, len(hits))
	for _, h := range hits {
		out = append(out, searchHit{Hit: h, ConnectionName: names[h.ConnectionID]})
	}
	return out
}

func parseTime(v string) *time.Time {
	if v == "" {
		return nil
	}
	for _, layout := range []string{time.RFC3339, "2006-01-02"} {
		if t, err := time.Parse(layout, v); err == nil {
			return &t
		}
	}
	return nil
}

func parseInt(v string) *int64 {
	if n, err := strconv.ParseInt(v, 10, 64); err == nil {
		return &n
	}
	return nil
}

func (s *Server) search(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	page, _ := strconv.ParseInt(q.Get("page"), 10, 64)
	limit, _ := strconv.ParseInt(q.Get("limit"), 10, 64)
	query := search.Query{
		Q: q.Get("q"), Connection: q.Get("connection"), Bucket: q.Get("bucket"),
		Category: q.Get("category"), Ext: q.Get("ext"),
		MinSize: parseInt(q.Get("minSize")), MaxSize: parseInt(q.Get("maxSize")),
		From: parseTime(q.Get("from")), To: parseTime(q.Get("to")),
		Sort: q.Get("sort"), Page: page, Limit: limit,
	}
	if query.To != nil && len(q.Get("to")) == 10 { // data sem hora: inclui o dia inteiro
		t := query.To.Add(24*time.Hour - time.Second)
		query.To = &t
	}
	res, err := s.Index.Search(r.Context(), query)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, 200, map[string]any{
		"hits": withNames(res.Hits, s.connNames(r)), "total": res.Total, "page": res.Page, "limit": res.Limit,
		"processingTimeMs": res.ProcessingTimeMs, "facets": res.Facets,
	})
}

func (s *Server) statsOverview(w http.ResponseWriter, r *http.Request) {
	o, err := s.Stats.Overview(r.Context())
	if err != nil {
		s.fail(w, r, err)
		return
	}
	largest := []searchHit{}
	if res, err := s.Index.Search(r.Context(), search.Query{Sort: "size:desc", Limit: 10}); err == nil {
		largest = withNames(res.Hits, s.connNames(r))
	} else {
		s.Log.Warn("maiores arquivos: busca falhou", "err", err)
	}
	o.Largest = largest
	writeJSON(w, 200, o)
}

func (s *Server) statsHistory(w http.ResponseWriter, r *http.Request) {
	days, _ := strconv.Atoi(r.URL.Query().Get("days"))
	if days < 1 || days > 365 {
		days = 30
	}
	pts, err := s.Stats.History(r.Context(), days)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, 200, map[string]any{"points": pts})
}

func (s *Server) syncRuns(w http.ResponseWriter, r *http.Request) {
	conn := r.URL.Query().Get("connection")
	if conn != "" {
		if _, err := s.Conns.Get(r.Context(), conn); err != nil {
			s.fail(w, r, err)
			return
		}
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit < 1 || limit > 200 {
		limit = 50
	}
	runs, err := s.Stats.Runs(r.Context(), conn, limit)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, 200, map[string]any{"items": runs})
}
