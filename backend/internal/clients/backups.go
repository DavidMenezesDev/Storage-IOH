package clients

import (
	"context"
	"path"
	"time"

	"github.com/jackc/pgx/v5"
)

func (s *Store) Backups(ctx context.Context, clientID string, page, limit int) ([]Backup, int, error) {
	if page < 1 {
		page = 1
	}
	if limit < 1 || limit > 200 {
		limit = 50
	}
	var total int
	if err := s.db.QueryRow(ctx, `SELECT count(*) FROM client_backups WHERE client_id=$1`, clientID).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := s.db.Query(ctx, `SELECT key, size, last_modified, etag FROM client_backups WHERE client_id=$1
		ORDER BY last_modified DESC, key DESC LIMIT $2 OFFSET $3`, clientID, limit, (page-1)*limit)
	if err != nil {
		return nil, 0, err
	}
	out, err := collectBackups(rows)
	return out, total, err
}

// AllBackups devolve todos os backups do cliente, do mais novo para o mais antigo.
func (s *Store) AllBackups(ctx context.Context, clientID string) ([]Backup, error) {
	rows, err := s.db.Query(ctx, `SELECT key, size, last_modified, etag FROM client_backups WHERE client_id=$1
		ORDER BY last_modified DESC, key DESC`, clientID)
	if err != nil {
		return nil, err
	}
	return collectBackups(rows)
}

func collectBackups(rows pgx.Rows) ([]Backup, error) {
	defer rows.Close()
	out := []Backup{}
	for rows.Next() {
		var b Backup
		if err := rows.Scan(&b.Key, &b.Size, &b.LastModified, &b.ETag); err != nil {
			return nil, err
		}
		b.Name = path.Base(b.Key)
		out = append(out, b)
	}
	return out, rows.Err()
}

func (s *Store) HasBackup(ctx context.Context, clientID, key string) (bool, error) {
	var ok bool
	err := s.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM client_backups WHERE client_id=$1 AND key=$2)`, clientID, key).Scan(&ok)
	return ok, err
}

type SeriesPoint struct {
	Date     string `json:"date"`
	Backups  int    `json:"backups"`
	Bytes    int64  `json:"bytes"`
	LastSize *int64 `json:"lastSize"`
}

func (s *Store) Series(ctx context.Context, clientID string, days int) ([]SeriesPoint, error) {
	if days < 1 || days > 365 {
		days = 60
	}
	rows, err := s.db.Query(ctx, `
		WITH d AS (SELECT generate_series(current_date - ($2::int - 1), current_date, '1 day')::date AS day)
		SELECT to_char(d.day,'YYYY-MM-DD'), count(b.key)::int, COALESCE(sum(b.size),0)::bigint,
			(SELECT size FROM client_backups x WHERE x.client_id=$1 AND x.last_modified::date = d.day ORDER BY x.last_modified DESC LIMIT 1)
		FROM d LEFT JOIN client_backups b ON b.client_id=$1 AND b.last_modified::date = d.day
		GROUP BY d.day ORDER BY d.day`, clientID, days)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SeriesPoint{}
	for rows.Next() {
		var p SeriesPoint
		if err := rows.Scan(&p.Date, &p.Backups, &p.Bytes, &p.LastSize); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// ReplaceBackups grava a lista completa encontrada na varredura e atualiza os agregados e o status.
// Devolve o status anterior (para gerar alerta em transições).
func (s *Store) ReplaceBackups(ctx context.Context, c *Client, all []Backup, status, reason, scanErr string) (prev string, err error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	if err := tx.QueryRow(ctx, `SELECT status FROM clients WHERE id=$1 FOR UPDATE`, c.ID).Scan(&prev); err != nil {
		return "", err
	}
	if scanErr == "" {
		if _, err := tx.Exec(ctx, `DELETE FROM client_backups WHERE client_id=$1`, c.ID); err != nil {
			return "", err
		}
		rows := make([][]any, len(all))
		for i, b := range all {
			rows[i] = []any{c.ID, b.Key, b.Size, b.LastModified, b.ETag}
		}
		if _, err := tx.CopyFrom(ctx, pgx.Identifier{"client_backups"}, []string{"client_id", "key", "size", "last_modified", "etag"},
			pgx.CopyFromRows(rows)); err != nil {
			return "", err
		}
		var lastAt *time.Time
		var lastKey *string
		var lastSize *int64
		var total int64
		for _, b := range all {
			total += b.Size
		}
		if len(all) > 0 {
			lastAt, lastKey, lastSize = &all[0].LastModified, &all[0].Key, &all[0].Size
		}
		if _, err := tx.Exec(ctx, `UPDATE clients SET last_backup_at=$2, last_backup_key=$3, last_backup_size=$4,
			backup_count=$5, total_bytes=$6, last_scan_at=now(), last_scan_error=NULL WHERE id=$1`,
			c.ID, lastAt, lastKey, lastSize, len(all), total); err != nil {
			return "", err
		}
	} else {
		if _, err := tx.Exec(ctx, `UPDATE clients SET last_scan_at=now(), last_scan_error=$2 WHERE id=$1`, c.ID, scanErr); err != nil {
			return "", err
		}
	}
	if _, err := tx.Exec(ctx, `UPDATE clients SET status=$2, status_reason=$3,
		status_changed_at = CASE WHEN status <> $2 THEN now() ELSE status_changed_at END WHERE id=$1`, c.ID, status, reason); err != nil {
		return "", err
	}
	return prev, tx.Commit(ctx)
}

type RecentBackup struct {
	Backup
	ClientID   string `json:"clientId"`
	ClientName string `json:"clientName"`
}

type DailyPoint struct {
	Date              string `json:"date"`
	Backups           int    `json:"backups"`
	Bytes             int64  `json:"bytes"`
	ClientsWithBackup int    `json:"clientsWithBackup"`
}

type Overview struct {
	Counts        map[string]int `json:"counts"`
	TotalClients  int            `json:"totalClients"`
	ActiveClients int            `json:"activeClients"`
	TotalBytes    int64          `json:"totalBytes"`
	Last24h       struct {
		Backups int   `json:"backups"`
		Bytes   int64 `json:"bytes"`
	} `json:"last24h"`
	Attention []*Client      `json:"attention"`
	Recent    []RecentBackup `json:"recent"`
	Daily     []DailyPoint   `json:"daily"`
}

func (s *Store) Overview(ctx context.Context) (*Overview, error) {
	o := &Overview{Counts: map[string]int{}, Recent: []RecentBackup{}, Daily: []DailyPoint{}}
	for _, st := range AllStatuses {
		o.Counts[st] = 0
	}
	rows, err := s.db.Query(ctx, `SELECT status, count(*) FROM clients GROUP BY status`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var st string
		var n int
		if err := rows.Scan(&st, &n); err != nil {
			rows.Close()
			return nil, err
		}
		o.Counts[st] = n
		o.TotalClients += n
	}
	rows.Close()
	if err := s.db.QueryRow(ctx, `SELECT count(*) FILTER (WHERE active), COALESCE(sum(total_bytes) FILTER (WHERE active),0) FROM clients`).
		Scan(&o.ActiveClients, &o.TotalBytes); err != nil {
		return nil, err
	}
	if err := s.db.QueryRow(ctx, `SELECT count(*), COALESCE(sum(b.size),0) FROM client_backups b JOIN clients c ON c.id=b.client_id
		WHERE c.active AND b.last_modified > now() - interval '24 hours'`).Scan(&o.Last24h.Backups, &o.Last24h.Bytes); err != nil {
		return nil, err
	}
	if o.Attention, err = s.List(ctx, ListFilter{Problems: true, Limit: 50}); err != nil {
		return nil, err
	}
	rows, err = s.db.Query(ctx, `SELECT b.key, b.size, b.last_modified, b.etag, c.id, c.name FROM client_backups b
		JOIN clients c ON c.id=b.client_id ORDER BY b.last_modified DESC LIMIT 20`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var r RecentBackup
		if err := rows.Scan(&r.Key, &r.Size, &r.LastModified, &r.ETag, &r.ClientID, &r.ClientName); err != nil {
			rows.Close()
			return nil, err
		}
		r.Name = path.Base(r.Key)
		o.Recent = append(o.Recent, r)
	}
	rows.Close()
	rows, err = s.db.Query(ctx, `
		WITH d AS (SELECT generate_series(current_date - 29, current_date, '1 day')::date AS day)
		SELECT to_char(d.day,'YYYY-MM-DD'), count(b.key)::int, COALESCE(sum(b.size),0)::bigint, count(DISTINCT b.client_id)::int
		FROM d LEFT JOIN client_backups b ON b.last_modified::date = d.day
		GROUP BY d.day ORDER BY d.day`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var p DailyPoint
		if err := rows.Scan(&p.Date, &p.Backups, &p.Bytes, &p.ClientsWithBackup); err != nil {
			return nil, err
		}
		o.Daily = append(o.Daily, p)
	}
	return o, rows.Err()
}
