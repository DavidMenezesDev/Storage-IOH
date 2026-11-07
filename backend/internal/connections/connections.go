// Package connections persiste as conexões com provedores S3-compatíveis.
package connections

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"storage-ioh/internal/secret"
)

var ErrNotFound = errors.New("conexão não encontrada")

type Connection struct {
	ID                  string     `json:"id"`
	Name                string     `json:"name"`
	Provider            string     `json:"provider"`
	Endpoint            string     `json:"endpoint"`
	Region              string     `json:"region"`
	ForcePathStyle      bool       `json:"forcePathStyle"`
	AccessKeyID         string     `json:"accessKeyId"`
	HasSecret           bool       `json:"hasSecret"`
	IndexEnabled        bool       `json:"indexEnabled"`
	SyncIntervalMinutes int        `json:"syncIntervalMinutes"`
	LastSyncAt          *time.Time `json:"lastSyncAt"`
	CreatedAt           time.Time  `json:"createdAt"`
	UpdatedAt           time.Time  `json:"updatedAt"`

	SecretAccessKey string `json:"-"`
}

// Input é usado tanto no POST (todos obrigatórios relevantes) quanto no PATCH (ponteiros nil = não alterar).
type Input struct {
	Name                *string `json:"name"`
	Provider            *string `json:"provider"`
	Endpoint            *string `json:"endpoint"`
	Region              *string `json:"region"`
	ForcePathStyle      *bool   `json:"forcePathStyle"`
	AccessKeyID         *string `json:"accessKeyId"`
	SecretAccessKey     *string `json:"secretAccessKey"`
	IndexEnabled        *bool   `json:"indexEnabled"`
	SyncIntervalMinutes *int    `json:"syncIntervalMinutes"`
}

// Apply aplica o input sobre uma conexão existente (ou zero-value) e valida o resultado.
func (in Input) Apply(c *Connection) error {
	set := func(dst *string, src *string) {
		if src != nil {
			*dst = strings.TrimSpace(*src)
		}
	}
	set(&c.Name, in.Name)
	set(&c.Provider, in.Provider)
	set(&c.Endpoint, in.Endpoint)
	set(&c.Region, in.Region)
	set(&c.AccessKeyID, in.AccessKeyID)
	if in.SecretAccessKey != nil && *in.SecretAccessKey != "" {
		c.SecretAccessKey = strings.TrimSpace(*in.SecretAccessKey)
	}
	if in.ForcePathStyle != nil {
		c.ForcePathStyle = *in.ForcePathStyle
	}
	if in.IndexEnabled != nil {
		c.IndexEnabled = *in.IndexEnabled
	}
	if in.SyncIntervalMinutes != nil {
		c.SyncIntervalMinutes = *in.SyncIntervalMinutes
	}
	c.Endpoint = strings.TrimRight(c.Endpoint, "/")

	switch c.Provider {
	case "s3", "r2", "minio", "custom":
	default:
		return errors.New("provider deve ser s3, r2, minio ou custom")
	}
	if c.Name == "" {
		return errors.New("nome é obrigatório")
	}
	if c.AccessKeyID == "" || c.SecretAccessKey == "" {
		return errors.New("access key e secret key são obrigatórias")
	}
	if c.Provider != "s3" && c.Endpoint == "" {
		return errors.New("endpoint é obrigatório para " + c.Provider)
	}
	if c.Endpoint != "" && !strings.HasPrefix(c.Endpoint, "http://") && !strings.HasPrefix(c.Endpoint, "https://") {
		return errors.New("endpoint deve começar com http:// ou https://")
	}
	if c.SyncIntervalMinutes < 0 {
		return errors.New("syncIntervalMinutes não pode ser negativo")
	}
	if c.Region == "" {
		switch c.Provider {
		case "r2":
			c.Region = "auto"
		default:
			c.Region = "us-east-1"
		}
	}
	if c.Provider == "minio" {
		c.ForcePathStyle = true
	}
	c.HasSecret = true
	return nil
}

type Store struct {
	db  *pgxpool.Pool
	box *secret.Box
}

func NewStore(db *pgxpool.Pool, box *secret.Box) *Store { return &Store{db: db, box: box} }

const cols = `id, name, provider, endpoint, region, force_path_style, access_key_id, secret_key_enc,
	index_enabled, sync_interval_minutes, last_sync_at, created_at, updated_at`

func (s *Store) scan(row pgx.Row) (*Connection, error) {
	var c Connection
	var enc []byte
	err := row.Scan(&c.ID, &c.Name, &c.Provider, &c.Endpoint, &c.Region, &c.ForcePathStyle, &c.AccessKeyID, &enc,
		&c.IndexEnabled, &c.SyncIntervalMinutes, &c.LastSyncAt, &c.CreatedAt, &c.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if c.SecretAccessKey, err = s.box.Open(enc); err != nil {
		return nil, err
	}
	c.HasSecret = true
	return &c, nil
}

func (s *Store) List(ctx context.Context) ([]*Connection, error) {
	rows, err := s.db.Query(ctx, `SELECT `+cols+` FROM connections ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*Connection{}
	for rows.Next() {
		c, err := s.scan(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (s *Store) Get(ctx context.Context, id string) (*Connection, error) {
	if !isUUID(id) {
		return nil, ErrNotFound
	}
	return s.scan(s.db.QueryRow(ctx, `SELECT `+cols+` FROM connections WHERE id = $1`, id))
}

func (s *Store) Create(ctx context.Context, c *Connection) (*Connection, error) {
	enc, err := s.box.Seal(c.SecretAccessKey)
	if err != nil {
		return nil, err
	}
	return s.scan(s.db.QueryRow(ctx, `INSERT INTO connections
		(name, provider, endpoint, region, force_path_style, access_key_id, secret_key_enc, index_enabled, sync_interval_minutes)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING `+cols,
		c.Name, c.Provider, c.Endpoint, c.Region, c.ForcePathStyle, c.AccessKeyID, enc, c.IndexEnabled, c.SyncIntervalMinutes))
}

func (s *Store) Update(ctx context.Context, c *Connection) (*Connection, error) {
	enc, err := s.box.Seal(c.SecretAccessKey)
	if err != nil {
		return nil, err
	}
	return s.scan(s.db.QueryRow(ctx, `UPDATE connections SET
		name=$2, provider=$3, endpoint=$4, region=$5, force_path_style=$6, access_key_id=$7, secret_key_enc=$8,
		index_enabled=$9, sync_interval_minutes=$10, updated_at=now()
		WHERE id=$1 RETURNING `+cols,
		c.ID, c.Name, c.Provider, c.Endpoint, c.Region, c.ForcePathStyle, c.AccessKeyID, enc, c.IndexEnabled, c.SyncIntervalMinutes))
}

func (s *Store) Delete(ctx context.Context, id string) error {
	if !isUUID(id) {
		return ErrNotFound
	}
	tag, err := s.db.Exec(ctx, `DELETE FROM connections WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) TouchSync(ctx context.Context, id string) error {
	_, err := s.db.Exec(ctx, `UPDATE connections SET last_sync_at = now() WHERE id = $1`, id)
	return err
}

func isUUID(s string) bool {
	if len(s) != 36 {
		return false
	}
	for i, r := range s {
		switch i {
		case 8, 13, 18, 23:
			if r != '-' {
				return false
			}
		default:
			if !strings.ContainsRune("0123456789abcdefABCDEF", r) {
				return false
			}
		}
	}
	return true
}
