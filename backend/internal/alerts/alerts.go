// Package alerts: histórico de mudanças de status e entrega por webhook/e-mail.
package alerts

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/mail"
	"net/smtp"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrNotFound = errors.New("canal não encontrado")

type SMTPConfig struct {
	Host     string
	Port     int
	User     string
	Password string
	From     string
}

func (c SMTPConfig) Configured() bool { return c.Host != "" && c.From != "" }

type Alert struct {
	ID         string    `json:"id"`
	ClientID   string    `json:"clientId"`
	ClientName string    `json:"clientName"`
	FromStatus string    `json:"fromStatus"`
	ToStatus   string    `json:"toStatus"`
	Message    string    `json:"message"`
	CreatedAt  time.Time `json:"createdAt"`
	Delivered  bool      `json:"delivered"`
	Error      *string   `json:"error"`
}

type Channel struct {
	ID           string    `json:"id"`
	Type         string    `json:"type"`
	Name         string    `json:"name"`
	Target       string    `json:"target"`
	OnlyProblems bool      `json:"onlyProblems"`
	Enabled      bool      `json:"enabled"`
	CreatedAt    time.Time `json:"createdAt"`
}

type ChannelInput struct {
	Type         *string `json:"type"`
	Name         *string `json:"name"`
	Target       *string `json:"target"`
	OnlyProblems *bool   `json:"onlyProblems"`
	Enabled      *bool   `json:"enabled"`
}

// Enqueuer agenda a entrega assíncrona (implementado pelo indexer/asynq).
type Enqueuer interface {
	DeliverAlert(ctx context.Context, alertID string) error
}

type Service struct {
	db        *pgxpool.Pool
	smtp      SMTPConfig
	publicURL string
	http      *http.Client
	enq       Enqueuer
}

func New(db *pgxpool.Pool, smtp SMTPConfig, publicURL string, enq Enqueuer) *Service {
	return &Service{db: db, smtp: smtp, publicURL: strings.TrimRight(publicURL, "/"), enq: enq,
		http: &http.Client{Timeout: 15 * time.Second}}
}

func (s *Service) SMTPConfigured() bool { return s.smtp.Configured() }

var statusLabel = map[string]string{
	"ok": "Em dia", "late": "Atrasado", "suspicious": "Suspeito", "missing": "Sem backup",
	"error": "Erro", "pending": "Aguardando", "inactive": "Inativo",
}

func Label(s string) string {
	if l, ok := statusLabel[s]; ok {
		return l
	}
	return s
}

func problem(s string) bool {
	return s == "late" || s == "suspicious" || s == "missing" || s == "error"
}

// ShouldAlert: entra em problema, muda de problema, ou se recupera de um problema.
func ShouldAlert(from, to string) bool {
	if from == to {
		return false
	}
	return problem(to) || (to == "ok" && problem(from))
}

// Notify registra o alerta e agenda a entrega.
func (s *Service) Notify(ctx context.Context, clientID, from, to, message string) error {
	if !ShouldAlert(from, to) {
		return nil
	}
	var id string
	if err := s.db.QueryRow(ctx, `INSERT INTO alerts (client_id, from_status, to_status, message) VALUES ($1,$2,$3,$4) RETURNING id`,
		clientID, from, to, message).Scan(&id); err != nil {
		return err
	}
	if s.enq != nil {
		return s.enq.DeliverAlert(ctx, id)
	}
	return nil
}

const alertCols = `a.id, a.client_id, c.name, a.from_status, a.to_status, a.message, a.created_at, a.delivered, a.error`

func (s *Service) List(ctx context.Context, clientID string, limit int) ([]Alert, error) {
	if limit < 1 || limit > 500 {
		limit = 100
	}
	q := `SELECT ` + alertCols + ` FROM alerts a JOIN clients c ON c.id=a.client_id`
	args := []any{limit}
	if clientID != "" {
		q += ` WHERE a.client_id::text = $2`
		args = append(args, clientID)
	}
	rows, err := s.db.Query(ctx, q+` ORDER BY a.created_at DESC LIMIT $1`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Alert{}
	for rows.Next() {
		var a Alert
		if err := rows.Scan(&a.ID, &a.ClientID, &a.ClientName, &a.FromStatus, &a.ToStatus, &a.Message, &a.CreatedAt, &a.Delivered, &a.Error); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

type payload struct {
	Text       string    `json:"text"`
	Content    string    `json:"content"`
	Event      string    `json:"event"`
	Client     pClient   `json:"client"`
	FromStatus string    `json:"fromStatus"`
	ToStatus   string    `json:"toStatus"`
	Message    string    `json:"message"`
	At         time.Time `json:"at"`
	URL        string    `json:"url,omitempty"`
}

type pClient struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Document string `json:"document"`
}

// Deliver envia um alerta para todos os canais ativos e registra o resultado.
func (s *Service) Deliver(ctx context.Context, alertID string) error {
	var p payload
	err := s.db.QueryRow(ctx, `SELECT a.client_id, c.name, c.document, a.from_status, a.to_status, a.message, a.created_at
		FROM alerts a JOIN clients c ON c.id=a.client_id WHERE a.id=$1`, alertID).
		Scan(&p.Client.ID, &p.Client.Name, &p.Client.Document, &p.FromStatus, &p.ToStatus, &p.Message, &p.At)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	p.Event = "client.status"
	icon := "⚠️"
	if p.ToStatus == "ok" {
		icon = "✅"
	} else if p.ToStatus == "error" || p.ToStatus == "missing" {
		icon = "🚨"
	}
	p.Text = fmt.Sprintf("%s Backup de %s: %s → %s. %s", icon, p.Client.Name, Label(p.FromStatus), Label(p.ToStatus), p.Message)
	if s.publicURL != "" {
		p.URL = s.publicURL + "/clients/" + p.Client.ID
		p.Text += "\n" + p.URL
	}
	p.Content = p.Text

	chans, err := s.Channels(ctx)
	if err != nil {
		return err
	}
	var errs []string
	sent := 0
	for _, ch := range chans {
		if !ch.Enabled || (ch.OnlyProblems && p.ToStatus == "ok") {
			continue
		}
		if err := s.send(ctx, ch, p); err != nil {
			errs = append(errs, ch.Name+": "+err.Error())
			continue
		}
		sent++
	}
	var errMsg *string
	if len(errs) > 0 {
		m := strings.Join(errs, "; ")
		errMsg = &m
	}
	_, err = s.db.Exec(ctx, `UPDATE alerts SET delivered=$2, error=$3 WHERE id=$1`, alertID, sent > 0 && len(errs) == 0, errMsg)
	if err != nil {
		return err
	}
	if len(errs) > 0 && sent == 0 {
		return errors.New(*errMsg) // deixa o asynq tentar de novo
	}
	return nil
}

func (s *Service) send(ctx context.Context, ch Channel, p payload) error {
	switch ch.Type {
	case "webhook":
		body, _ := json.Marshal(p)
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, ch.Target, bytes.NewReader(body))
		if err != nil {
			return err
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("User-Agent", "storage-ioh-alerts/1")
		res, err := s.http.Do(req)
		if err != nil {
			return err
		}
		res.Body.Close()
		if res.StatusCode >= 300 {
			return fmt.Errorf("HTTP %d", res.StatusCode)
		}
		return nil
	case "email":
		subject := fmt.Sprintf("[Backup] %s: %s", p.Client.Name, Label(p.ToStatus))
		return s.sendMail(splitEmails(ch.Target), subject, p.Text)
	}
	return errors.New("tipo de canal desconhecido")
}

func splitEmails(s string) []string {
	var out []string
	for _, e := range strings.Split(s, ",") {
		if e = strings.TrimSpace(e); e != "" {
			out = append(out, e)
		}
	}
	return out
}

func (s *Service) sendMail(to []string, subject, body string) error {
	if !s.smtp.Configured() {
		return errors.New("SMTP não configurado (defina SMTP_HOST e SMTP_FROM no .env)")
	}
	from, err := mail.ParseAddress(s.smtp.From)
	if err != nil {
		return fmt.Errorf("SMTP_FROM inválido: %w", err)
	}
	var msg bytes.Buffer
	fmt.Fprintf(&msg, "From: %s\r\nTo: %s\r\nSubject: =?UTF-8?B?%s?=\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nDate: %s\r\n\r\n%s\r\n",
		from.String(), strings.Join(to, ", "), b64(subject), time.Now().Format(time.RFC1123Z), body)
	addr := net.JoinHostPort(s.smtp.Host, strconv.Itoa(s.smtp.Port))
	var auth smtp.Auth
	if s.smtp.User != "" {
		auth = smtp.PlainAuth("", s.smtp.User, s.smtp.Password, s.smtp.Host)
	}
	if s.smtp.Port == 465 { // TLS implícito
		conn, err := tls.Dial("tcp", addr, &tls.Config{ServerName: s.smtp.Host})
		if err != nil {
			return err
		}
		c, err := smtp.NewClient(conn, s.smtp.Host)
		if err != nil {
			return err
		}
		defer c.Close()
		if auth != nil {
			if err := c.Auth(auth); err != nil {
				return err
			}
		}
		if err := c.Mail(from.Address); err != nil {
			return err
		}
		for _, r := range to {
			if err := c.Rcpt(r); err != nil {
				return err
			}
		}
		w, err := c.Data()
		if err != nil {
			return err
		}
		if _, err := w.Write(msg.Bytes()); err != nil {
			return err
		}
		if err := w.Close(); err != nil {
			return err
		}
		return c.Quit()
	}
	return smtp.SendMail(addr, auth, from.Address, to, msg.Bytes())
}

// ---- canais ----

const chanCols = `id, type, name, target, only_problems, enabled, created_at`

func scanChannel(row pgx.Row) (*Channel, error) {
	var c Channel
	err := row.Scan(&c.ID, &c.Type, &c.Name, &c.Target, &c.OnlyProblems, &c.Enabled, &c.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return &c, err
}

func (s *Service) Channels(ctx context.Context) ([]Channel, error) {
	rows, err := s.db.Query(ctx, `SELECT `+chanCols+` FROM alert_channels ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Channel{}
	for rows.Next() {
		c, err := scanChannel(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *c)
	}
	return out, rows.Err()
}

func (s *Service) Channel(ctx context.Context, id string) (*Channel, error) {
	return scanChannel(s.db.QueryRow(ctx, `SELECT `+chanCols+` FROM alert_channels WHERE id::text=$1`, id))
}

func (in ChannelInput) apply(c *Channel) error {
	if in.Type != nil {
		c.Type = *in.Type
	}
	if in.Name != nil {
		c.Name = strings.TrimSpace(*in.Name)
	}
	if in.Target != nil {
		c.Target = strings.TrimSpace(*in.Target)
	}
	if in.OnlyProblems != nil {
		c.OnlyProblems = *in.OnlyProblems
	}
	if in.Enabled != nil {
		c.Enabled = *in.Enabled
	}
	if c.Name == "" {
		return errors.New("nome é obrigatório")
	}
	switch c.Type {
	case "webhook":
		u, err := url.Parse(c.Target)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
			return errors.New("URL do webhook inválida")
		}
	case "email":
		list := splitEmails(c.Target)
		if len(list) == 0 {
			return errors.New("informe ao menos um e-mail")
		}
		for _, e := range list {
			if _, err := mail.ParseAddress(e); err != nil {
				return errors.New("e-mail inválido: " + e)
			}
		}
	default:
		return errors.New("tipo deve ser webhook ou email")
	}
	return nil
}

func (s *Service) CreateChannel(ctx context.Context, in ChannelInput) (*Channel, error) {
	c := &Channel{Enabled: true}
	if err := in.apply(c); err != nil {
		return nil, err
	}
	return scanChannel(s.db.QueryRow(ctx, `INSERT INTO alert_channels (type, name, target, only_problems, enabled)
		VALUES ($1,$2,$3,$4,$5) RETURNING `+chanCols, c.Type, c.Name, c.Target, c.OnlyProblems, c.Enabled))
}

func (s *Service) UpdateChannel(ctx context.Context, id string, in ChannelInput) (*Channel, error) {
	c, err := s.Channel(ctx, id)
	if err != nil {
		return nil, err
	}
	if err := in.apply(c); err != nil {
		return nil, err
	}
	return scanChannel(s.db.QueryRow(ctx, `UPDATE alert_channels SET type=$2, name=$3, target=$4, only_problems=$5, enabled=$6
		WHERE id=$1 RETURNING `+chanCols, c.ID, c.Type, c.Name, c.Target, c.OnlyProblems, c.Enabled))
}

func (s *Service) DeleteChannel(ctx context.Context, id string) error {
	tag, err := s.db.Exec(ctx, `DELETE FROM alert_channels WHERE id::text=$1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// Test envia uma mensagem de teste para um canal.
func (s *Service) Test(ctx context.Context, id string) error {
	ch, err := s.Channel(ctx, id)
	if err != nil {
		return err
	}
	p := payload{Event: "test", At: time.Now().UTC(), FromStatus: "ok", ToStatus: "ok",
		Client: pClient{Name: "Teste"}, Message: "Mensagem de teste do Storage-IOH."}
	p.Text = "🔔 Teste de alerta do Storage-IOH: este canal está funcionando."
	p.Content = p.Text
	if ch.Type == "email" {
		return s.sendMail(splitEmails(ch.Target), "[Backup] Teste de alerta", p.Text)
	}
	return s.send(ctx, *ch, p)
}
