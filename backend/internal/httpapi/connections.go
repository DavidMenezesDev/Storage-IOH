package httpapi

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"storage-ioh/internal/connections"
	"storage-ioh/internal/search"
	"storage-ioh/internal/storage"
)

func (s *Server) listConnections(w http.ResponseWriter, r *http.Request) {
	items, err := s.Conns.List(r.Context())
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, 200, map[string]any{"items": items})
}

func (s *Server) getConnection(w http.ResponseWriter, r *http.Request) {
	c, err := s.Conns.Get(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, 200, c)
}

func (s *Server) createConnection(w http.ResponseWriter, r *http.Request) {
	var in connections.Input
	if err := decode(r, &in); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	c := &connections.Connection{IndexEnabled: true, SyncIntervalMinutes: 360}
	if err := in.Apply(c); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	created, err := s.Conns.Create(r.Context(), c)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	s.audit(r, auditEvent{Action: "connection.create", ConnectionID: created.ID, Detail: map[string]any{"name": created.Name, "provider": created.Provider}})
	if err := s.Enq.SyncConnection(r.Context(), created.ID); err != nil {
		s.Log.Warn("não foi possível enfileirar sync inicial", "err", err)
	}
	writeJSON(w, 201, created)
}

func (s *Server) updateConnection(w http.ResponseWriter, r *http.Request) {
	c, err := s.Conns.Get(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		s.fail(w, r, err)
		return
	}
	var in connections.Input
	if err := decode(r, &in); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	wasIndexed := c.IndexEnabled
	if err := in.Apply(c); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	updated, err := s.Conns.Update(r.Context(), c)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	s.audit(r, auditEvent{Action: "connection.update", ConnectionID: updated.ID, Detail: map[string]any{"name": updated.Name}})
	if wasIndexed && !updated.IndexEnabled {
		_ = s.Index.DeleteByFilter(r.Context(), "connection_id = "+search.Quote(updated.ID), false)
	} else if updated.IndexEnabled {
		_ = s.Enq.SyncConnection(r.Context(), updated.ID)
	}
	writeJSON(w, 200, updated)
}

func (s *Server) deleteConnection(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if n, err := s.Clients.CountByConnection(r.Context(), id); err == nil && n > 0 {
		writeErr(w, 409, "esta conexão é usada por "+strconv.Itoa(n)+" cliente(s); mova-os antes de excluir")
		return
	}
	if err := s.Conns.Delete(r.Context(), id); err != nil {
		s.fail(w, r, err)
		return
	}
	s.audit(r, auditEvent{Action: "connection.delete", ConnectionID: id})
	if err := s.Index.DeleteByFilter(r.Context(), "connection_id = "+search.Quote(id), false); err != nil {
		s.Log.Warn("falha ao limpar índice da conexão removida", "err", err)
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) testConnection(w http.ResponseWriter, r *http.Request) {
	var body struct {
		connections.Input
		ID string `json:"id"`
	}
	if err := decode(r, &body); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	c := &connections.Connection{}
	if body.ID != "" {
		existing, err := s.Conns.Get(r.Context(), body.ID)
		if err != nil {
			s.fail(w, r, err)
			return
		}
		c = existing
	}
	if err := body.Input.Apply(c); err != nil {
		writeJSON(w, 200, map[string]any{"ok": false, "bucketCount": 0, "error": err.Error()})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	buckets, err := storage.New(c).ListBuckets(ctx)
	if err != nil {
		writeJSON(w, 200, map[string]any{"ok": false, "bucketCount": 0, "error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "bucketCount": len(buckets)})
}

func (s *Server) syncConnection(w http.ResponseWriter, r *http.Request) {
	c, err := s.Conns.Get(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		s.fail(w, r, err)
		return
	}
	var body struct {
		Bucket string `json:"bucket"`
	}
	if r.ContentLength > 0 {
		if err := decode(r, &body); err != nil {
			writeErr(w, 400, err.Error())
			return
		}
	}
	if !c.IndexEnabled {
		writeErr(w, 409, "indexação desativada para esta conexão")
		return
	}
	if body.Bucket != "" {
		err = s.Enq.SyncBucket(r.Context(), c.ID, body.Bucket)
	} else {
		err = s.Enq.SyncConnection(r.Context(), c.ID)
	}
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, 202, map[string]int{"enqueued": 1})
}
