// Package httpapi expõe a API REST usada pelo frontend.
package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/redis/go-redis/v9"

	"storage-ioh/internal/alerts"
	"storage-ioh/internal/audit"
	"storage-ioh/internal/auth"
	"storage-ioh/internal/cache"
	"storage-ioh/internal/clients"
	"storage-ioh/internal/config"
	"storage-ioh/internal/connections"
	"storage-ioh/internal/indexer"
	"storage-ioh/internal/search"
	"storage-ioh/internal/stats"
	"storage-ioh/internal/storage"
	"storage-ioh/internal/thumbs"
)

type Server struct {
	Cfg     *config.Config
	Log     *slog.Logger
	Auth    *auth.Service
	Conns   *connections.Store
	Pool    *storage.Pool
	Cache   *cache.Cache
	Index   *search.Index
	Stats   *stats.Store
	Thumbs  *thumbs.Service
	Enq     *indexer.Enqueuer
	Redis   *redis.Client
	Clients *clients.Store
	Scanner *clients.Scanner
	Alerts  *alerts.Service
	Audit   *audit.Log
}

func (s *Server) Router() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID, middleware.RealIP, s.logRequests, middleware.Recoverer)

	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) { writeJSON(w, 200, map[string]string{"status": "ok"}) })
	r.Get("/readyz", s.ready)

	r.Route("/api", func(r chi.Router) {
		r.Post("/auth/login", s.login)
		r.Post("/auth/logout", s.logout)

		// sem login: envio de backups por token e links públicos
		r.Put("/ingest/*", s.ingest)
		r.Post("/enroll", s.enroll)
		r.Get("/public/share/{token}", s.publicShare)

		r.Group(func(r chi.Router) {
			r.Use(s.requireAuth)
			r.Get("/auth/me", s.me)
			r.Post("/auth/password", s.changePassword)
			r.Get("/settings", s.settings)

			viewer := r.With(s.requireRole(auth.RoleViewer))
			operator := r.With(s.requireRole(auth.RoleOperator))
			admin := r.With(s.requireRole(auth.RoleAdmin))

			// conexões e storage
			viewer.Get("/connections", s.listConnections)
			admin.Post("/connections", s.createConnection)
			admin.Post("/connections/test", s.testConnection)
			viewer.Get("/connections/{id}", s.getConnection)
			admin.Patch("/connections/{id}", s.updateConnection)
			admin.Delete("/connections/{id}", s.deleteConnection)
			operator.Post("/connections/{id}/sync", s.syncConnection)

			viewer.Get("/connections/{id}/buckets", s.listBuckets)
			r.Route("/connections/{id}/buckets/{bucket}", func(r chi.Router) {
				r.With(s.requireRole(auth.RoleViewer)).Get("/objects", s.listObjects)
				r.With(s.requireRole(auth.RoleViewer)).Get("/object/meta", s.objectMeta)
				r.With(s.requireRole(auth.RoleOperator)).Get("/object/content", s.objectContent)
				r.With(s.requireRole(auth.RoleOperator)).Get("/object/thumb", s.objectThumb)
				r.With(s.requireRole(auth.RoleOperator)).Post("/objects/upload", s.upload)
				r.With(s.requireRole(auth.RoleOperator)).Post("/folders", s.createFolder)
				r.With(s.requireRole(auth.RoleAdmin)).Post("/objects/delete", s.deleteObjects)
				r.With(s.requireRole(auth.RoleAdmin)).Post("/objects/rename", s.renameObject)
			})

			viewer.Get("/search", s.search)
			viewer.Get("/stats/overview", s.statsOverview)
			viewer.Get("/stats/history", s.statsHistory)
			viewer.Get("/sync-runs", s.syncRuns)

			// backups ERP
			viewer.Get("/backups/overview", s.backupsOverview)
			viewer.Get("/clients", s.listClients)
			viewer.Get("/clients/export.csv", s.exportClients)
			admin.Post("/clients", s.createClient)
			viewer.Get("/clients/{id}", s.getClient)
			admin.Patch("/clients/{id}", s.updateClient)
			admin.Delete("/clients/{id}", s.deleteClient)
			operator.Post("/clients/{id}/scan", s.scanClient)
			viewer.Get("/clients/{id}/backups", s.clientBackups)
			viewer.Get("/clients/{id}/backups/series", s.clientSeries)
			operator.Get("/clients/{id}/backups/download", s.downloadBackup)
			operator.Post("/clients/{id}/backups/share", s.shareBackup)
			operator.Get("/clients/{id}/shares", s.listShares)
			operator.Delete("/shares/{id}", s.revokeShare)
			admin.Post("/clients/{id}/ingest-token", s.createIngestToken)
			admin.Delete("/clients/{id}/ingest-token", s.revokeIngestToken)
			viewer.Get("/clients/{id}/retention/preview", s.retentionPreview)
			admin.Post("/clients/{id}/retention/apply", s.retentionApply)
			viewer.Get("/clients/{id}/alerts", s.clientAlerts)
			admin.Get("/clients/{id}/audit", s.clientAudit)

			viewer.Get("/alerts", s.listAlerts)
			admin.Get("/alert-channels", s.listChannels)
			admin.Post("/alert-channels", s.createChannel)
			admin.Patch("/alert-channels/{id}", s.updateChannel)
			admin.Delete("/alert-channels/{id}", s.deleteChannel)
			admin.Post("/alert-channels/{id}/test", s.testChannel)

			admin.Get("/users", s.listUsers)
			admin.Post("/users", s.createUser)
			admin.Patch("/users/{id}", s.updateUser)
			admin.Delete("/users/{id}", s.deleteUser)
			admin.Get("/audit", s.listAudit)
		})
		r.NotFound(func(w http.ResponseWriter, _ *http.Request) { writeErr(w, 404, "rota não encontrada") })
	})
	return r
}

func (s *Server) requireRole(role string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !auth.UserFrom(r.Context()).Can(role) {
				writeErr(w, 403, "permissão insuficiente")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func (s *Server) logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		start := time.Now()
		next.ServeHTTP(ww, r)
		if r.URL.Path == "/healthz" || r.URL.Path == "/readyz" {
			return
		}
		lvl := slog.LevelInfo
		if ww.Status() >= 500 {
			lvl = slog.LevelError
		}
		s.Log.Log(r.Context(), lvl, "http", "method", r.Method, "path", r.URL.Path, "status", ww.Status(),
			"bytes", ww.BytesWritten(), "took", time.Since(start).Round(time.Microsecond).String())
	})
}

func (s *Server) requireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie(auth.CookieName)
		if err != nil {
			writeErr(w, 401, "não autenticado")
			return
		}
		u, err := s.Auth.Resolve(r.Context(), c.Value)
		if err != nil {
			writeErr(w, 401, "sessão expirada")
			return
		}
		// CSRF: o cookie é SameSite=Lax, então navegadores não o enviam em POST/PATCH/DELETE cross-site.
		next.ServeHTTP(w, r.WithContext(auth.WithUser(r.Context(), u)))
	})
}

func (s *Server) ready(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	checks := map[string]string{"postgres": "ok", "redis": "ok", "meilisearch": "ok"}
	status := 200
	if err := s.Stats.Ping(ctx); err != nil {
		checks["postgres"], status = err.Error(), 503
	}
	if err := s.Redis.Ping(ctx).Err(); err != nil {
		checks["redis"], status = err.Error(), 503
	}
	if !s.Index.Healthy() {
		checks["meilisearch"], status = "indisponível", 503
	}
	writeJSON(w, status, checks)
}

// ---- helpers ----

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func (s *Server) fail(w http.ResponseWriter, r *http.Request, err error) {
	var se *storage.Error
	switch {
	case errors.Is(err, connections.ErrNotFound), errors.Is(err, clients.ErrNotFound), errors.Is(err, auth.ErrNotFound),
		errors.Is(err, alerts.ErrNotFound), errors.Is(err, clients.ErrShareNotFound):
		writeErr(w, 404, err.Error())
	case errors.Is(err, storage.ErrNotFound):
		writeErr(w, 404, err.Error())
	case errors.As(err, &se):
		writeErr(w, se.Status, se.Msg)
	case errors.Is(err, context.Canceled):
		// cliente desistiu
	default:
		s.Log.Error("erro interno", "path", r.URL.Path, "err", err)
		writeErr(w, 500, "erro interno")
	}
}

func decode(r *http.Request, v any) error {
	dec := json.NewDecoder(http.MaxBytesReader(nil, r.Body, 1<<20))
	if err := dec.Decode(v); err != nil {
		return errors.New("JSON inválido: " + err.Error())
	}
	return nil
}

func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
