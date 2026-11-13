package httpapi

import (
	"crypto/subtle"
	"errors"
	"net/http"
	"strings"

	"storage-ioh/internal/clients"
)

// Horários de envio diário que o aplicativo do cliente pode agendar.
var enrollSchedules = []string{"15:00", "17:00"}

type enrollRequest struct {
	Name     string `json:"name"`
	Document string `json:"document"`
}

type enrollResponse struct {
	ClientID       string   `json:"clientId"`
	IntegrationKey string   `json:"integrationKey"`
	IngestURL      string   `json:"ingestUrl"`
	Prefix         string   `json:"prefix"`
	Schedules      []string `json:"schedules"`
}

// enroll: o aplicativo do cliente envia nome + CNPJ e recebe a chave de integração (token de envio).
// Protegido por segredo compartilhado (ENROLL_SECRET). Um CNPJ já cadastrado nunca recebe chave por aqui —
// quem tem o segredo não pode assumir um cliente existente; a chave nova é gerada por um admin.
func (s *Server) enroll(w http.ResponseWriter, r *http.Request) {
	cfg := s.Cfg
	if cfg.EnrollSecret == "" {
		writeErr(w, 404, "rota não encontrada")
		return
	}
	got, _ := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	if subtle.ConstantTimeCompare([]byte(strings.TrimSpace(got)), []byte(cfg.EnrollSecret)) != 1 {
		writeErr(w, 401, "chave de cadastro inválida")
		return
	}
	var in enrollRequest
	if err := decode(r, &in); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	name := strings.TrimSpace(in.Name)
	if name == "" || len(name) > 200 {
		writeErr(w, 400, "nome da empresa é obrigatório")
		return
	}
	if !clients.ValidCNPJ(in.Document) {
		writeErr(w, 400, "CNPJ inválido")
		return
	}
	doc := strings.Map(func(r rune) rune {
		if r >= '0' && r <= '9' {
			return r
		}
		return -1
	}, in.Document)

	if _, err := s.Clients.ByDocument(r.Context(), doc); err == nil {
		writeErr(w, 409, "CNPJ já cadastrado; peça ao administrador para gerar uma nova chave de integração")
		return
	} else if !errors.Is(err, clients.ErrNotFound) {
		s.fail(w, r, err)
		return
	}

	c := &clients.Client{Active: true, Policy: clients.DefaultPolicy()}
	connID, bucket, prefix := cfg.EnrollConnectionID, cfg.EnrollBucket, cfg.EnrollPrefix+doc+"/"
	apply := clients.Input{Name: &name, Document: &doc, ConnectionID: &connID, Bucket: &bucket, Prefix: &prefix}
	if _, err := apply.Apply(c); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	if err := s.checkLocation(r.Context(), c); err != nil {
		s.Log.Error("autocadastro: conexão ENROLL_CONNECTION_ID inválida", "err", err)
		writeErr(w, 503, "cadastro indisponível no servidor")
		return
	}
	created, err := s.Clients.Create(r.Context(), c)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	token, prefixTok, err := s.Clients.NewIngestToken(r.Context(), created.ID)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	s.audit(r, auditEvent{Action: "client.enroll", Client: created, UserEmail: "enroll", Detail: map[string]any{"tokenPrefix": prefixTok}})
	writeJSON(w, 201, enrollResponse{
		ClientID:       created.ID,
		IntegrationKey: token,
		IngestURL:      s.baseURL(r) + "/api/ingest/",
		Prefix:         created.Prefix,
		Schedules:      enrollSchedules,
	})
}
