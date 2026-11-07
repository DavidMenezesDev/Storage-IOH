package httpapi

import (
	"errors"
	"net/http"

	"storage-ioh/internal/audit"
	"storage-ioh/internal/auth"
)

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := decode(r, &body); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	ip := clientIP(r)
	if !s.Auth.AllowLogin(r.Context(), ip) {
		writeErr(w, 429, "muitas tentativas; tente novamente em alguns minutos")
		return
	}
	u, token, err := s.Auth.Login(r.Context(), body.Email, body.Password)
	if errors.Is(err, auth.ErrInvalid) {
		s.Audit.Record(r.Context(), audit.Event{UserEmail: body.Email, Action: "login.failed", IP: ip})
		writeErr(w, 401, err.Error())
		return
	}
	if err != nil {
		s.fail(w, r, err)
		return
	}
	s.Auth.ResetLoginLimit(r.Context(), ip)
	s.Audit.Record(r.Context(), audit.Event{UserEmail: u.Email, Action: "login", IP: ip})
	s.Auth.SetCookie(w, token)
	writeJSON(w, 200, map[string]any{"user": u})
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(auth.CookieName); err == nil {
		s.Auth.Logout(r.Context(), c.Value)
	}
	s.Auth.ClearCookie(w)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]any{"user": auth.UserFrom(r.Context())})
}
