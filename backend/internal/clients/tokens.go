package clients

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

var (
	ErrShareGone     = errors.New("link expirado, revogado ou sem downloads restantes")
	ErrShareNotFound = errors.New("link não encontrado")
)

func randomToken(prefix string) (string, error) {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return prefix + hex.EncodeToString(b), nil
}

func hashToken(t string) string {
	h := sha256.Sum256([]byte(t))
	return hex.EncodeToString(h[:])
}

// NewIngestToken gera um token de envio novo (invalida o anterior). O token em claro só existe aqui.
func (s *Store) NewIngestToken(ctx context.Context, clientID string) (token, prefix string, err error) {
	token, err = randomToken("ioh_")
	if err != nil {
		return "", "", err
	}
	prefix = token[:12]
	tag, err := s.db.Exec(ctx, `UPDATE clients SET ingest_token_hash=$2, ingest_token_prefix=$3, updated_at=now() WHERE id::text=$1`,
		clientID, hashToken(token), prefix)
	if err != nil {
		return "", "", err
	}
	if tag.RowsAffected() == 0 {
		return "", "", ErrNotFound
	}
	return token, prefix, nil
}

func (s *Store) RevokeIngestToken(ctx context.Context, clientID string) error {
	tag, err := s.db.Exec(ctx, `UPDATE clients SET ingest_token_hash=NULL, ingest_token_prefix=NULL, updated_at=now() WHERE id::text=$1`, clientID)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}

func (s *Store) ByIngestToken(ctx context.Context, token string) (*Client, error) {
	if token == "" {
		return nil, ErrNotFound
	}
	return scanClient(s.db.QueryRow(ctx, `SELECT `+clientCols+clientFrom+` WHERE c.ingest_token_hash = $1`, hashToken(token)))
}

type ShareLink struct {
	ID           string    `json:"id"`
	ClientID     string    `json:"clientId"`
	Key          string    `json:"key"`
	URL          string    `json:"url"`
	ExpiresAt    time.Time `json:"expiresAt"`
	MaxDownloads *int      `json:"maxDownloads"`
	Downloads    int       `json:"downloads"`
	CreatedBy    string    `json:"createdBy"`
	CreatedAt    time.Time `json:"createdAt"`
	Revoked      bool      `json:"revoked"`
}

const shareCols = `id, client_id, key, url, expires_at, max_downloads, downloads, created_by, created_at, revoked`

func scanShare(row pgx.Row) (*ShareLink, error) {
	var l ShareLink
	err := row.Scan(&l.ID, &l.ClientID, &l.Key, &l.URL, &l.ExpiresAt, &l.MaxDownloads, &l.Downloads, &l.CreatedBy, &l.CreatedAt, &l.Revoked)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrShareNotFound
	}
	return &l, err
}

// CreateShare cria um link; baseURL é a origem pública do app.
func (s *Store) CreateShare(ctx context.Context, clientID, key, baseURL, createdBy string, ttl time.Duration, maxDownloads *int) (*ShareLink, error) {
	token, err := randomToken("")
	if err != nil {
		return nil, err
	}
	url := baseURL + "/api/public/share/" + token
	return scanShare(s.db.QueryRow(ctx, `INSERT INTO share_links (token_hash, client_id, key, expires_at, max_downloads, url, created_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING `+shareCols,
		hashToken(token), clientID, key, time.Now().Add(ttl), maxDownloads, url, createdBy))
}

func (s *Store) Shares(ctx context.Context, clientID string) ([]ShareLink, error) {
	rows, err := s.db.Query(ctx, `SELECT `+shareCols+` FROM share_links
		WHERE client_id::text=$1 AND expires_at > now() - interval '30 days' ORDER BY created_at DESC`, clientID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ShareLink{}
	for rows.Next() {
		l, err := scanShare(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *l)
	}
	return out, rows.Err()
}

func (s *Store) Share(ctx context.Context, id string) (*ShareLink, error) {
	return scanShare(s.db.QueryRow(ctx, `SELECT `+shareCols+` FROM share_links WHERE id::text=$1`, id))
}

func (s *Store) RevokeShare(ctx context.Context, id string) error {
	tag, err := s.db.Exec(ctx, `UPDATE share_links SET revoked=true WHERE id::text=$1`, id)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrShareNotFound
	}
	return err
}

// ConsumeShare valida o token e conta um download de forma atômica.
func (s *Store) ConsumeShare(ctx context.Context, token string) (*ShareLink, error) {
	l, err := scanShare(s.db.QueryRow(ctx, `UPDATE share_links SET downloads = downloads + 1
		WHERE token_hash=$1 AND NOT revoked AND expires_at > now() AND (max_downloads IS NULL OR downloads < max_downloads)
		RETURNING `+shareCols, hashToken(token)))
	if errors.Is(err, ErrShareNotFound) {
		var exists bool
		_ = s.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM share_links WHERE token_hash=$1)`, hashToken(token)).Scan(&exists)
		if exists {
			return nil, ErrShareGone
		}
	}
	return l, err
}

// PeekShare valida o link sem contar download (continuação de um download por Range).
func (s *Store) PeekShare(ctx context.Context, token string) (*ShareLink, error) {
	l, err := scanShare(s.db.QueryRow(ctx, `SELECT `+shareCols+` FROM share_links WHERE token_hash=$1`, hashToken(token)))
	if err != nil {
		return nil, err
	}
	if l.Revoked || time.Now().After(l.ExpiresAt) {
		return nil, ErrShareGone
	}
	return l, nil
}
