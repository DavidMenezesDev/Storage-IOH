package httpapi

import (
	"context"
	"encoding/csv"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"storage-ioh/internal/audit"
	"storage-ioh/internal/auth"
	"storage-ioh/internal/clients"
	"storage-ioh/internal/connections"
	"storage-ioh/internal/objects"
)

type auditEvent struct {
	Action       string
	Client       *clients.Client
	ConnectionID string
	Bucket       string
	Key          string
	Detail       map[string]any
	UserEmail    string // sobrescreve o usuário da sessão (ex.: token de envio)
}

func (s *Server) audit(r *http.Request, e auditEvent) {
	ev := audit.Event{Action: e.Action, ConnectionID: e.ConnectionID, Bucket: e.Bucket, Key: e.Key, Detail: e.Detail, IP: clientIP(r)}
	if u := auth.UserFrom(r.Context()); u != nil {
		ev.UserEmail = u.Email
	}
	if e.UserEmail != "" {
		ev.UserEmail = e.UserEmail
	}
	if c := e.Client; c != nil {
		ev.ClientID, ev.ClientName = c.ID, c.Name
		if ev.ConnectionID == "" {
			ev.ConnectionID, ev.Bucket = c.ConnectionID, c.Bucket
		}
	}
	s.Audit.Record(r.Context(), ev)
}

// baseURL é a origem pública do app (PUBLIC_URL ou a origem vista pelo navegador via proxy do Next).
func (s *Server) baseURL(r *http.Request) string {
	if s.Cfg.PublicURL != "" {
		return strings.TrimRight(s.Cfg.PublicURL, "/")
	}
	proto := r.Header.Get("X-Forwarded-Proto")
	if proto == "" {
		proto = "http"
	}
	host := r.Header.Get("X-Forwarded-Host")
	if host == "" {
		host = r.Host
	}
	return proto + "://" + host
}

func (s *Server) client(w http.ResponseWriter, r *http.Request) (*clients.Client, bool) {
	c, err := s.Clients.Get(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		s.fail(w, r, err)
		return nil, false
	}
	return c, true
}

// ---- painel e CRUD ----

func (s *Server) backupsOverview(w http.ResponseWriter, r *http.Request) {
	o, err := s.Clients.Overview(r.Context())
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, 200, o)
}

func listFilter(r *http.Request) clients.ListFilter {
	q := r.URL.Query()
	f := clients.ListFilter{Q: strings.TrimSpace(q.Get("q"))}
	for _, st := range strings.Split(q.Get("status"), ",") {
		if st = strings.TrimSpace(st); st != "" {
			f.Statuses = append(f.Statuses, st)
		}
	}
	if v := q.Get("active"); v == "true" || v == "false" {
		b := v == "true"
		f.Active = &b
	}
	return f
}

func (s *Server) listClients(w http.ResponseWriter, r *http.Request) {
	items, err := s.Clients.List(r.Context(), listFilter(r))
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, 200, map[string]any{"items": items})
}

var csvStatus = map[string]string{"ok": "Em dia", "late": "Atrasado", "suspicious": "Suspeito", "missing": "Sem backup",
	"error": "Erro", "pending": "Aguardando", "inactive": "Inativo"}

func (s *Server) exportClients(w http.ResponseWriter, r *http.Request) {
	items, err := s.Clients.List(r.Context(), listFilter(r))
	if err != nil {
		s.fail(w, r, err)
		return
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", contentDisposition("attachment", "clientes-backup-"+time.Now().Format("2006-01-02")+".csv"))
	_, _ = w.Write([]byte("\xef\xbb\xbf")) // BOM para o Excel abrir em UTF-8
	cw := csv.NewWriter(w)
	cw.Comma = ';'
	_ = cw.Write([]string{"Cliente", "Documento", "Status", "Motivo", "Último backup", "Tamanho do último (bytes)",
		"Qtd. backups", "Volume total (bytes)", "Conexão", "Bucket", "Prefixo", "Contato", "E-mail", "Telefone", "Tags", "Ativo"})
	for _, c := range items {
		last, size := "", ""
		if c.LastBackupAt != nil {
			last = c.LastBackupAt.Local().Format("02/01/2006 15:04")
		}
		if c.LastBackupSize != nil {
			size = strconv.FormatInt(*c.LastBackupSize, 10)
		}
		active := "sim"
		if !c.Active {
			active = "não"
		}
		_ = cw.Write([]string{c.Name, c.Document, csvStatus[c.Status], c.StatusReason, last, size, strconv.Itoa(c.BackupCount),
			strconv.FormatInt(c.TotalBytes, 10), c.ConnectionName, c.Bucket, c.Prefix, c.ContactName, c.ContactEmail,
			c.ContactPhone, strings.Join(c.Tags, ", "), active})
	}
	cw.Flush()
}

func (s *Server) getClient(w http.ResponseWriter, r *http.Request) {
	if c, ok := s.client(w, r); ok {
		writeJSON(w, 200, c)
	}
}

func (s *Server) checkLocation(ctx context.Context, c *clients.Client) error {
	if _, err := s.Conns.Get(ctx, c.ConnectionID); err != nil {
		if errors.Is(err, connections.ErrNotFound) {
			return errors.New("conexão não encontrada")
		}
		return err
	}
	return nil
}

func (s *Server) createClient(w http.ResponseWriter, r *http.Request) {
	var in clients.Input
	if err := decode(r, &in); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	c := &clients.Client{Active: true, Policy: clients.DefaultPolicy()}
	if _, err := in.Apply(c); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	if err := s.checkLocation(r.Context(), c); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	created, err := s.Clients.Create(r.Context(), c)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	s.audit(r, auditEvent{Action: "client.create", Client: created})
	if created.Active {
		_ = s.Enq.ScanClient(r.Context(), created.ID)
	}
	writeJSON(w, 201, created)
}

func (s *Server) updateClient(w http.ResponseWriter, r *http.Request) {
	c, ok := s.client(w, r)
	if !ok {
		return
	}
	var in clients.Input
	if err := decode(r, &in); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	rescan, err := in.Apply(c)
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	if err := s.checkLocation(r.Context(), c); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	updated, err := s.Clients.Update(r.Context(), c)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	s.audit(r, auditEvent{Action: "client.update", Client: updated})
	if rescan && updated.Active {
		_ = s.Enq.ScanClient(r.Context(), updated.ID)
	}
	writeJSON(w, 200, updated)
}

func (s *Server) deleteClient(w http.ResponseWriter, r *http.Request) {
	c, ok := s.client(w, r)
	if !ok {
		return
	}
	if err := s.Clients.Delete(r.Context(), c.ID); err != nil {
		s.fail(w, r, err)
		return
	}
	s.audit(r, auditEvent{Action: "client.delete", Client: c})
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) scanClient(w http.ResponseWriter, r *http.Request) {
	c, ok := s.client(w, r)
	if !ok {
		return
	}
	if !c.Active {
		writeErr(w, 409, "cliente inativo")
		return
	}
	if err := s.Enq.ScanClient(r.Context(), c.ID); err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, 202, map[string]int{"enqueued": 1})
}

// ---- histórico ----

func (s *Server) clientBackups(w http.ResponseWriter, r *http.Request) {
	c, ok := s.client(w, r)
	if !ok {
		return
	}
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if page < 1 {
		page = 1
	}
	if limit < 1 || limit > 200 {
		limit = 50
	}
	items, total, err := s.Clients.Backups(r.Context(), c.ID, page, limit)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, 200, map[string]any{"items": items, "total": total, "page": page, "limit": limit})
}

func (s *Server) clientSeries(w http.ResponseWriter, r *http.Request) {
	c, ok := s.client(w, r)
	if !ok {
		return
	}
	days, _ := strconv.Atoi(r.URL.Query().Get("days"))
	pts, err := s.Clients.Series(r.Context(), c.ID, days)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, 200, map[string]any{"points": pts})
}

// keyOf valida que a chave pertence ao local do cliente.
func keyOf(w http.ResponseWriter, c *clients.Client, key string) bool {
	if !validKey(key) || !strings.HasPrefix(key, c.Prefix) || strings.HasSuffix(key, "/") {
		writeErr(w, 403, "arquivo fora do local de backup do cliente")
		return false
	}
	return true
}

func (s *Server) downloadBackup(w http.ResponseWriter, r *http.Request) {
	c, ok := s.client(w, r)
	if !ok {
		return
	}
	key := r.URL.Query().Get("key")
	if !keyOf(w, c, key) {
		return
	}
	cl, err := s.Scanner.Target(r.Context(), c)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	if rg := r.Header.Get("Range"); rg == "" || strings.HasPrefix(rg, "bytes=0-") {
		s.audit(r, auditEvent{Action: "backup.download", Client: c, Key: key})
	}
	s.streamObject(w, r, cl, c.Bucket, key, true, 0)
}

func (s *Server) shareBackup(w http.ResponseWriter, r *http.Request) {
	c, ok := s.client(w, r)
	if !ok {
		return
	}
	var body struct {
		Key          string `json:"key"`
		ExpiresHours int    `json:"expiresHours"`
		MaxDownloads *int   `json:"maxDownloads"`
	}
	if err := decode(r, &body); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	if !keyOf(w, c, body.Key) {
		return
	}
	if body.ExpiresHours == 0 {
		body.ExpiresHours = 24
	}
	if body.ExpiresHours < 1 || body.ExpiresHours > 168 {
		writeErr(w, 400, "validade deve estar entre 1 e 168 horas")
		return
	}
	if body.MaxDownloads != nil && *body.MaxDownloads < 1 {
		body.MaxDownloads = nil
	}
	cl, err := s.Scanner.Target(r.Context(), c)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	if _, err := cl.Head(r.Context(), c.Bucket, body.Key); err != nil {
		s.fail(w, r, err)
		return
	}
	link, err := s.Clients.CreateShare(r.Context(), c.ID, body.Key, s.baseURL(r), auth.UserFrom(r.Context()).Email,
		time.Duration(body.ExpiresHours)*time.Hour, body.MaxDownloads)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	s.audit(r, auditEvent{Action: "backup.share", Client: c, Key: body.Key,
		Detail: map[string]any{"shareId": link.ID, "expiresAt": link.ExpiresAt, "maxDownloads": body.MaxDownloads}})
	writeJSON(w, 201, link)
}

func (s *Server) listShares(w http.ResponseWriter, r *http.Request) {
	c, ok := s.client(w, r)
	if !ok {
		return
	}
	items, err := s.Clients.Shares(r.Context(), c.ID)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, 200, map[string]any{"items": items})
}

func (s *Server) revokeShare(w http.ResponseWriter, r *http.Request) {
	link, err := s.Clients.Share(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		s.fail(w, r, err)
		return
	}
	if err := s.Clients.RevokeShare(r.Context(), link.ID); err != nil {
		s.fail(w, r, err)
		return
	}
	c, _ := s.Clients.Get(r.Context(), link.ClientID)
	s.audit(r, auditEvent{Action: "share.revoke", Client: c, Key: link.Key, Detail: map[string]any{"shareId": link.ID}})
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) publicShare(w http.ResponseWriter, r *http.Request) {
	token := chi.URLParam(r, "token")
	// Ranges subsequentes do mesmo download não consomem o link de novo.
	continuing := strings.HasPrefix(r.Header.Get("Range"), "bytes=") && !strings.HasPrefix(r.Header.Get("Range"), "bytes=0-")
	var link *clients.ShareLink
	var err error
	if continuing {
		link, err = s.Clients.PeekShare(r.Context(), token)
	} else {
		link, err = s.Clients.ConsumeShare(r.Context(), token)
	}
	if errors.Is(err, clients.ErrShareGone) {
		writeErr(w, 410, err.Error())
		return
	}
	if errors.Is(err, clients.ErrShareNotFound) {
		writeErr(w, 404, "link não encontrado")
		return
	}
	if err != nil {
		s.fail(w, r, err)
		return
	}
	c, err := s.Clients.Get(r.Context(), link.ClientID)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	cl, err := s.Scanner.Target(r.Context(), c)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	if !continuing {
		s.audit(r, auditEvent{Action: "share.download", Client: c, Key: link.Key, UserEmail: "link:" + link.CreatedBy,
			Detail: map[string]any{"shareId": link.ID, "downloads": link.Downloads}})
	}
	w.Header().Set("Referrer-Policy", "no-referrer")
	s.streamObject(w, r, cl, c.Bucket, link.Key, true, 0)
}

// ---- envio por token ----

func (s *Server) createIngestToken(w http.ResponseWriter, r *http.Request) {
	c, ok := s.client(w, r)
	if !ok {
		return
	}
	token, prefix, err := s.Clients.NewIngestToken(r.Context(), c.ID)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	s.audit(r, auditEvent{Action: "token.create", Client: c, Detail: map[string]any{"prefix": prefix}})
	writeJSON(w, 201, map[string]string{"token": token, "prefix": prefix})
}

func (s *Server) revokeIngestToken(w http.ResponseWriter, r *http.Request) {
	c, ok := s.client(w, r)
	if !ok {
		return
	}
	if err := s.Clients.RevokeIngestToken(r.Context(), c.ID); err != nil {
		s.fail(w, r, err)
		return
	}
	s.audit(r, auditEvent{Action: "token.revoke", Client: c})
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) ingest(w http.ResponseWriter, r *http.Request) {
	token, found := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	if !found || strings.TrimSpace(token) == "" {
		writeErr(w, 401, "token de envio ausente")
		return
	}
	c, err := s.Clients.ByIngestToken(r.Context(), strings.TrimSpace(token))
	if errors.Is(err, clients.ErrNotFound) {
		writeErr(w, 401, "token de envio inválido")
		return
	}
	if err != nil {
		s.fail(w, r, err)
		return
	}
	if !c.Active {
		writeErr(w, 403, "cliente inativo")
		return
	}
	raw, err := url.PathUnescape(chi.URLParam(r, "*"))
	if err != nil {
		writeErr(w, 400, "nome de arquivo inválido")
		return
	}
	rel, ok := cleanUploadName(raw)
	if !ok {
		writeErr(w, 400, "nome de arquivo inválido")
		return
	}
	key := c.Prefix + rel
	cl, err := s.Scanner.Target(r.Context(), c)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	body := http.MaxBytesReader(w, r.Body, s.Cfg.IngestMaxGB<<30)
	cr := &countingReader{r: body}
	if err := cl.PutLarge(r.Context(), c.Bucket, key, objects.ContentTypeOf(objects.Ext(key)), cr); err != nil {
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) {
			writeErr(w, 413, "arquivo maior que o limite de envio")
			return
		}
		s.fail(w, r, err)
		return
	}
	if r.ContentLength > 0 && cr.n != r.ContentLength {
		writeErr(w, 400, "envio incompleto")
		return
	}
	s.audit(r, auditEvent{Action: "backup.ingest", Client: c, Key: key, UserEmail: "token:" + strings.TrimSpace(token)[:12],
		Detail: map[string]any{"size": cr.n}})
	s.Cache.Invalidate(r.Context(), c.ConnectionID, c.Bucket)
	// atualiza status na hora (sem esperar o agendador)
	if err := s.Scanner.Scan(r.Context(), c.ID); err != nil {
		s.Log.Warn("varredura após envio falhou", "client", c.Name, "err", err)
	}
	writeJSON(w, 201, map[string]any{"key": key, "size": cr.n})
}

// ---- retenção e alertas ----

func (s *Server) retentionPreview(w http.ResponseWriter, r *http.Request) {
	c, ok := s.client(w, r)
	if !ok {
		return
	}
	items, bytes, keep, err := s.Scanner.Preview(r.Context(), c)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, 200, map[string]any{"items": items, "totalBytes": bytes, "keep": keep})
}

func (s *Server) retentionApply(w http.ResponseWriter, r *http.Request) {
	c, ok := s.client(w, r)
	if !ok {
		return
	}
	if c.Policy.RetentionDays <= 0 {
		writeErr(w, 409, "a política deste cliente não define retenção")
		return
	}
	n, bytes, err := s.Scanner.ApplyRetention(r.Context(), c)
	if n > 0 {
		s.audit(r, auditEvent{Action: "retention.apply", Client: c, Detail: map[string]any{"deleted": n, "bytes": bytes}})
	}
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, 200, map[string]any{"deleted": n, "bytes": bytes})
}

func (s *Server) clientAlerts(w http.ResponseWriter, r *http.Request) {
	c, ok := s.client(w, r)
	if !ok {
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	items, err := s.Alerts.List(r.Context(), c.ID, limit)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, 200, map[string]any{"items": items})
}

func (s *Server) clientAudit(w http.ResponseWriter, r *http.Request) {
	c, ok := s.client(w, r)
	if !ok {
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	items, err := s.Audit.List(r.Context(), audit.Filter{ClientID: c.ID, Limit: limit})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, 200, map[string]any{"items": items})
}
