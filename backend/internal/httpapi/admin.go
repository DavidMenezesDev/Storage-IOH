package httpapi

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"storage-ioh/internal/alerts"
	"storage-ioh/internal/audit"
	"storage-ioh/internal/auth"
)

// ---- usuários ----

func (s *Server) listUsers(w http.ResponseWriter, r *http.Request) {
	items, err := s.Auth.List(r.Context())
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, 200, map[string]any{"items": items})
}

func (s *Server) userErr(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, auth.ErrDuplicate):
		writeErr(w, 409, err.Error())
	case errors.Is(err, auth.ErrLastAdmin):
		writeErr(w, 409, err.Error())
	case errors.Is(err, auth.ErrNotFound):
		writeErr(w, 404, err.Error())
	default:
		if isValidation(err) {
			writeErr(w, 400, err.Error())
			return
		}
		s.fail(w, r, err)
	}
}

// isValidation identifica erros de validação simples (mensagens em português geradas pelo pacote auth).
func isValidation(err error) bool {
	msg := err.Error()
	for _, p := range []string{"e-mail inválido", "papel deve", "senha precisa", "nova senha", "senha atual"} {
		if len(msg) >= len(p) && msg[:len(p)] == p {
			return true
		}
	}
	return false
}

func (s *Server) createUser(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email    string `json:"email"`
		Name     string `json:"name"`
		Role     string `json:"role"`
		Password string `json:"password"`
	}
	if err := decode(r, &body); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	u, err := s.Auth.Create(r.Context(), body.Email, body.Name, body.Role, body.Password)
	if err != nil {
		s.userErr(w, r, err)
		return
	}
	s.audit(r, auditEvent{Action: "user.create", Detail: map[string]any{"email": u.Email, "role": u.Role}})
	writeJSON(w, 201, u)
}

func (s *Server) updateUser(w http.ResponseWriter, r *http.Request) {
	var p auth.UserPatch
	if err := decode(r, &p); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	u, err := s.Auth.Update(r.Context(), chi.URLParam(r, "id"), p)
	if err != nil {
		s.userErr(w, r, err)
		return
	}
	detail := map[string]any{"email": u.Email, "role": u.Role, "active": u.Active}
	if p.Password != nil && *p.Password != "" {
		detail["passwordChanged"] = true
	}
	s.audit(r, auditEvent{Action: "user.update", Detail: detail})
	writeJSON(w, 200, u)
}

func (s *Server) deleteUser(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == auth.UserFrom(r.Context()).ID {
		writeErr(w, 409, "você não pode excluir o próprio usuário")
		return
	}
	u, err := s.Auth.Get(r.Context(), id)
	if err != nil {
		s.userErr(w, r, err)
		return
	}
	if err := s.Auth.Delete(r.Context(), id); err != nil {
		s.userErr(w, r, err)
		return
	}
	s.audit(r, auditEvent{Action: "user.delete", Detail: map[string]any{"email": u.Email}})
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) changePassword(w http.ResponseWriter, r *http.Request) {
	var body struct {
		CurrentPassword string `json:"currentPassword"`
		NewPassword     string `json:"newPassword"`
	}
	if err := decode(r, &body); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	if err := s.Auth.ChangePassword(r.Context(), auth.UserFrom(r.Context()).ID, body.CurrentPassword, body.NewPassword); err != nil {
		s.userErr(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---- auditoria e configurações ----

func (s *Server) listAudit(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	limit, _ := strconv.Atoi(q.Get("limit"))
	items, err := s.Audit.List(r.Context(), audit.Filter{
		Action: q.Get("action"), ClientID: q.Get("clientId"), UserEmail: q.Get("userEmail"),
		Before: parseTime(q.Get("before")), Limit: limit,
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, 200, map[string]any{"items": items})
}

func (s *Server) settings(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]any{
		"smtpConfigured":      s.Alerts.SMTPConfigured(),
		"publicUrl":           s.baseURL(r),
		"scanIntervalMinutes": s.Cfg.ScanIntervalMinutes,
	})
}

// ---- alertas ----

func (s *Server) listAlerts(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	items, err := s.Alerts.List(r.Context(), "", limit)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, 200, map[string]any{"items": items})
}

func (s *Server) listChannels(w http.ResponseWriter, r *http.Request) {
	items, err := s.Alerts.Channels(r.Context())
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, 200, map[string]any{"items": items})
}

func (s *Server) createChannel(w http.ResponseWriter, r *http.Request) {
	var in alerts.ChannelInput
	if err := decode(r, &in); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	c, err := s.Alerts.CreateChannel(r.Context(), in)
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	s.audit(r, auditEvent{Action: "channel.create", Detail: map[string]any{"name": c.Name, "type": c.Type}})
	writeJSON(w, 201, c)
}

func (s *Server) updateChannel(w http.ResponseWriter, r *http.Request) {
	var in alerts.ChannelInput
	if err := decode(r, &in); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	c, err := s.Alerts.UpdateChannel(r.Context(), chi.URLParam(r, "id"), in)
	if errors.Is(err, alerts.ErrNotFound) {
		writeErr(w, 404, err.Error())
		return
	}
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	s.audit(r, auditEvent{Action: "channel.update", Detail: map[string]any{"name": c.Name, "enabled": c.Enabled}})
	writeJSON(w, 200, c)
}

func (s *Server) deleteChannel(w http.ResponseWriter, r *http.Request) {
	c, err := s.Alerts.Channel(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		s.fail(w, r, err)
		return
	}
	if err := s.Alerts.DeleteChannel(r.Context(), c.ID); err != nil {
		s.fail(w, r, err)
		return
	}
	s.audit(r, auditEvent{Action: "channel.delete", Detail: map[string]any{"name": c.Name}})
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) testChannel(w http.ResponseWriter, r *http.Request) {
	if err := s.Alerts.Test(r.Context(), chi.URLParam(r, "id")); err != nil {
		if errors.Is(err, alerts.ErrNotFound) {
			writeErr(w, 404, err.Error())
			return
		}
		writeJSON(w, 200, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}
