// Package audit registra quem fez o quê com backups e objetos (trilha para LGPD).
package audit

import (
	"context"
	"encoding/json"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Entry struct {
	ID           string         `json:"id"`
	At           time.Time      `json:"at"`
	UserEmail    *string        `json:"userEmail"`
	Action       string         `json:"action"`
	ClientID     *string        `json:"clientId"`
	ClientName   *string        `json:"clientName"`
	ConnectionID *string        `json:"connectionId"`
	Bucket       *string        `json:"bucket"`
	Key          *string        `json:"key"`
	Detail       map[string]any `json:"detail"`
	IP           string         `json:"ip"`
}

// Event é o que os handlers informam; campos vazios viram NULL.
type Event struct {
	UserEmail    string
	Action       string
	ClientID     string
	ClientName   string
	ConnectionID string
	Bucket       string
	Key          string
	Detail       map[string]any
	IP           string
}

type Log struct {
	db  *pgxpool.Pool
	log *slog.Logger
}

func New(db *pgxpool.Pool, log *slog.Logger) *Log { return &Log{db: db, log: log} }

func null(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// Record nunca falha a requisição: erros vão para o log.
func (l *Log) Record(ctx context.Context, e Event) {
	if e.Detail == nil {
		e.Detail = map[string]any{}
	}
	detail, _ := json.Marshal(e.Detail)
	_, err := l.db.Exec(context.WithoutCancel(ctx), `INSERT INTO audit_log
		(user_email, action, client_id, client_name, connection_id, bucket, key, detail, ip)
		VALUES ($1,$2,$3::uuid,$4,$5::uuid,$6,$7,$8,$9)`,
		null(e.UserEmail), e.Action, null(e.ClientID), null(e.ClientName), null(e.ConnectionID),
		null(e.Bucket), null(e.Key), detail, e.IP)
	if err != nil {
		l.log.Error("auditoria: falha ao gravar", "action", e.Action, "err", err)
	}
}

type Filter struct {
	Action    string
	ClientID  string
	UserEmail string
	Before    *time.Time
	Limit     int
}

func (l *Log) List(ctx context.Context, f Filter) ([]Entry, error) {
	if f.Limit < 1 || f.Limit > 500 {
		f.Limit = 100
	}
	q := `SELECT id::text, at, user_email, action, client_id::text, client_name, connection_id::text, bucket, key, detail, ip
		FROM audit_log WHERE true`
	args := []any{}
	add := func(cond string, v any) {
		args = append(args, v)
		q += " AND " + cond + "$" + itoa(len(args))
	}
	if f.Action != "" {
		add("action = ", f.Action)
	}
	if f.ClientID != "" {
		add("client_id::text = ", f.ClientID)
	}
	if f.UserEmail != "" {
		add("user_email ILIKE ", "%"+f.UserEmail+"%")
	}
	if f.Before != nil {
		add("at < ", *f.Before)
	}
	args = append(args, f.Limit)
	q += " ORDER BY at DESC, id DESC LIMIT $" + itoa(len(args))
	rows, err := l.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Entry{}
	for rows.Next() {
		var e Entry
		var raw []byte
		if err := rows.Scan(&e.ID, &e.At, &e.UserEmail, &e.Action, &e.ClientID, &e.ClientName, &e.ConnectionID,
			&e.Bucket, &e.Key, &raw, &e.IP); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(raw, &e.Detail)
		if e.Detail == nil {
			e.Detail = map[string]any{}
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func itoa(i int) string {
	if i < 10 {
		return string(rune('0' + i))
	}
	return itoa(i/10) + string(rune('0'+i%10))
}
