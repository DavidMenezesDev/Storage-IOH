// Package stats grava execuções de sync, resumos por bucket e snapshots diários.
package stats

import (
	"context"
	"encoding/json"
	"sort"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Store struct{ db *pgxpool.Pool }

func New(db *pgxpool.Pool) *Store { return &Store{db: db} }

type CategoryAgg struct {
	Bytes int64 `json:"bytes"`
	Count int64 `json:"count"`
}

type BucketSummary struct {
	Name         string     `json:"name"`
	CreatedAt    *time.Time `json:"createdAt"`
	ObjectCount  *int64     `json:"objectCount"`
	TotalBytes   *int64     `json:"totalBytes"`
	LastSyncedAt *time.Time `json:"lastSyncedAt"`
}

func (s *Store) BucketSummaries(ctx context.Context, connID string) (map[string]BucketSummary, error) {
	rows, err := s.db.Query(ctx, `SELECT name, object_count, total_bytes, last_synced_at FROM buckets WHERE connection_id = $1`, connID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]BucketSummary{}
	for rows.Next() {
		var b BucketSummary
		if err := rows.Scan(&b.Name, &b.ObjectCount, &b.TotalBytes, &b.LastSyncedAt); err != nil {
			return nil, err
		}
		out[b.Name] = b
	}
	return out, rows.Err()
}

// SyncBucketList registra os buckets existentes e remove os que sumiram.
func (s *Store) SyncBucketList(ctx context.Context, connID string, names []string, created []*time.Time) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	for i, n := range names {
		if _, err := tx.Exec(ctx, `INSERT INTO buckets (connection_id, name, created_at) VALUES ($1,$2,$3)
			ON CONFLICT (connection_id, name) DO UPDATE SET created_at = EXCLUDED.created_at`, connID, n, created[i]); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(ctx, `DELETE FROM buckets WHERE connection_id = $1 AND NOT (name = ANY($2))`, connID, names); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Store) StartRun(ctx context.Context, connID, bucket string) (string, error) {
	var id string
	err := s.db.QueryRow(ctx, `INSERT INTO sync_runs (connection_id, bucket, status) VALUES ($1,$2,'running') RETURNING id`,
		connID, bucket).Scan(&id)
	return id, err
}

func (s *Store) FinishRun(ctx context.Context, runID string, objects, bytes int64, runErr error) error {
	status, msg := "success", (*string)(nil)
	if runErr != nil {
		status = "failed"
		m := runErr.Error()
		msg = &m
	}
	_, err := s.db.Exec(ctx, `UPDATE sync_runs SET status=$2, finished_at=now(), objects_seen=$3, bytes_seen=$4, error=$5 WHERE id=$1`,
		runID, status, objects, bytes, msg)
	return err
}

// FailStaleRuns marca como falhas execuções que ficaram "running" (worker reiniciado).
func (s *Store) FailStaleRuns(ctx context.Context) error {
	_, err := s.db.Exec(ctx, `UPDATE sync_runs SET status='failed', finished_at=now(), error='interrompido (worker reiniciado)'
		WHERE status='running'`)
	return err
}

// RecordBucket atualiza o resumo do bucket e o snapshot do dia.
func (s *Store) RecordBucket(ctx context.Context, connID, bucket string, count, bytes int64, byCat map[string]CategoryAgg) error {
	cat, _ := json.Marshal(byCat)
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `INSERT INTO buckets (connection_id, name, object_count, total_bytes, bytes_by_category, last_synced_at)
		VALUES ($1,$2,$3,$4,$5,now())
		ON CONFLICT (connection_id, name) DO UPDATE SET object_count=EXCLUDED.object_count, total_bytes=EXCLUDED.total_bytes,
		bytes_by_category=EXCLUDED.bytes_by_category, last_synced_at=now()`, connID, bucket, count, bytes, cat); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO storage_snapshots (day, connection_id, bucket, object_count, total_bytes, bytes_by_category)
		VALUES (current_date,$1,$2,$3,$4,$5)
		ON CONFLICT (day, connection_id, bucket) DO UPDATE SET object_count=EXCLUDED.object_count,
		total_bytes=EXCLUDED.total_bytes, bytes_by_category=EXCLUDED.bytes_by_category`, connID, bucket, count, bytes, cat); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// AdjustBucket aplica deltas vindos de ações feitas pelo app (upload/delete) sem esperar a próxima sync.
func (s *Store) AdjustBucket(ctx context.Context, connID, bucket, category string, dCount, dBytes int64) error {
	_, err := s.db.Exec(ctx, `UPDATE buckets SET
		object_count = GREATEST(COALESCE(object_count,0) + $3, 0),
		total_bytes  = GREATEST(COALESCE(total_bytes,0) + $4, 0),
		bytes_by_category = jsonb_set(bytes_by_category, ARRAY[$5::text], jsonb_build_object(
			'bytes', GREATEST(COALESCE((bytes_by_category->$5->>'bytes')::bigint,0) + $4, 0),
			'count', GREATEST(COALESCE((bytes_by_category->$5->>'count')::bigint,0) + $3, 0)))
		WHERE connection_id=$1 AND name=$2 AND last_synced_at IS NOT NULL`, connID, bucket, dCount, dBytes, category)
	return err
}

type BucketAgg struct {
	ConnectionID   string `json:"connectionId"`
	ConnectionName string `json:"connectionName"`
	Bucket         string `json:"bucket"`
	Bytes          int64  `json:"bytes"`
	Count          int64  `json:"count"`
}

type CategoryRow struct {
	Category string `json:"category"`
	Bytes    int64  `json:"bytes"`
	Count    int64  `json:"count"`
}

type Overview struct {
	TotalBytes      int64         `json:"totalBytes"`
	ObjectCount     int64         `json:"objectCount"`
	BucketCount     int64         `json:"bucketCount"`
	ConnectionCount int64         `json:"connectionCount"`
	LastSyncAt      *time.Time    `json:"lastSyncAt"`
	ByCategory      []CategoryRow `json:"byCategory"`
	ByBucket        []BucketAgg   `json:"byBucket"`
	Largest         any           `json:"largest"`
}

func (s *Store) Overview(ctx context.Context) (*Overview, error) {
	o := &Overview{ByCategory: []CategoryRow{}, ByBucket: []BucketAgg{}}
	if err := s.db.QueryRow(ctx, `SELECT
		(SELECT count(*) FROM connections),
		(SELECT count(*) FROM buckets),
		(SELECT COALESCE(sum(total_bytes),0) FROM buckets),
		(SELECT COALESCE(sum(object_count),0) FROM buckets),
		(SELECT max(last_synced_at) FROM buckets)`).Scan(&o.ConnectionCount, &o.BucketCount, &o.TotalBytes, &o.ObjectCount, &o.LastSyncAt); err != nil {
		return nil, err
	}
	rows, err := s.db.Query(ctx, `SELECT b.connection_id, c.name, b.name, COALESCE(b.total_bytes,0), COALESCE(b.object_count,0), b.bytes_by_category
		FROM buckets b JOIN connections c ON c.id = b.connection_id ORDER BY COALESCE(b.total_bytes,0) DESC, b.name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	cats := map[string]*CategoryRow{}
	for rows.Next() {
		var b BucketAgg
		var raw []byte
		if err := rows.Scan(&b.ConnectionID, &b.ConnectionName, &b.Bucket, &b.Bytes, &b.Count, &raw); err != nil {
			return nil, err
		}
		o.ByBucket = append(o.ByBucket, b)
		var m map[string]CategoryAgg
		_ = json.Unmarshal(raw, &m)
		for k, v := range m {
			if cats[k] == nil {
				cats[k] = &CategoryRow{Category: k}
			}
			cats[k].Bytes += v.Bytes
			cats[k].Count += v.Count
		}
	}
	for _, c := range cats {
		o.ByCategory = append(o.ByCategory, *c)
	}
	sort.Slice(o.ByCategory, func(i, j int) bool { return o.ByCategory[i].Bytes > o.ByCategory[j].Bytes })
	return o, rows.Err()
}

type Point struct {
	Date  string `json:"date"`
	Bytes int64  `json:"bytes"`
	Count int64  `json:"count"`
}

// History soma, para cada dia, o snapshot mais recente (<= dia) de cada bucket ainda existente.
func (s *Store) History(ctx context.Context, days int) ([]Point, error) {
	rows, err := s.db.Query(ctx, `
		WITH days AS (SELECT generate_series(current_date - ($1::int - 1), current_date, '1 day')::date AS day)
		SELECT to_char(d.day, 'YYYY-MM-DD'), COALESCE(sum(s.total_bytes),0)::bigint, COALESCE(sum(s.object_count),0)::bigint
		FROM days d
		LEFT JOIN buckets b ON true
		LEFT JOIN LATERAL (
			SELECT total_bytes, object_count FROM storage_snapshots ss
			WHERE ss.connection_id = b.connection_id AND ss.bucket = b.name AND ss.day <= d.day
			ORDER BY ss.day DESC LIMIT 1
		) s ON true
		GROUP BY d.day ORDER BY d.day`, days)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Point{}
	for rows.Next() {
		var p Point
		if err := rows.Scan(&p.Date, &p.Bytes, &p.Count); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

type Run struct {
	ID           string     `json:"id"`
	ConnectionID string     `json:"connectionId"`
	Bucket       string     `json:"bucket"`
	Status       string     `json:"status"`
	StartedAt    time.Time  `json:"startedAt"`
	FinishedAt   *time.Time `json:"finishedAt"`
	ObjectsSeen  int64      `json:"objectsSeen"`
	BytesSeen    int64      `json:"bytesSeen"`
	Error        *string    `json:"error"`
}

func (s *Store) Runs(ctx context.Context, connID string, limit int) ([]Run, error) {
	q := `SELECT id, connection_id, bucket, status, started_at, finished_at, objects_seen, bytes_seen, error FROM sync_runs`
	args := []any{limit}
	if connID != "" {
		q += ` WHERE connection_id = $2`
		args = append(args, connID)
	}
	q += ` ORDER BY started_at DESC LIMIT $1`
	rows, err := s.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Run{}
	for rows.Next() {
		var r Run
		if err := rows.Scan(&r.ID, &r.ConnectionID, &r.Bucket, &r.Status, &r.StartedAt, &r.FinishedAt, &r.ObjectsSeen, &r.BytesSeen, &r.Error); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *Store) Ping(ctx context.Context) error { return s.db.Ping(ctx) }
