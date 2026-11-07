// Package indexer sincroniza o conteúdo dos buckets com o índice de busca (tarefas asynq).
package indexer

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/hibiken/asynq"

	"storage-ioh/internal/connections"
	"storage-ioh/internal/objects"
	"storage-ioh/internal/search"
	"storage-ioh/internal/stats"
	"storage-ioh/internal/storage"
)

const (
	TypeSyncConnection = "index:connection"
	TypeSyncBucket     = "index:bucket"
	queue              = "index"
	batchSize          = 1000
)

type payload struct {
	ConnectionID string `json:"connectionId"`
	Bucket       string `json:"bucket,omitempty"`
}

// Enqueuer é usado pela API para disparar sincronizações.
type Enqueuer struct{ c *asynq.Client }

func NewEnqueuer(opt asynq.RedisConnOpt) *Enqueuer { return &Enqueuer{c: asynq.NewClient(opt)} }

func (e *Enqueuer) Close() error { return e.c.Close() }

func (e *Enqueuer) SyncConnection(ctx context.Context, connID string) error {
	b, _ := json.Marshal(payload{ConnectionID: connID})
	_, err := e.c.EnqueueContext(ctx, asynq.NewTask(TypeSyncConnection, b), asynq.Queue(queue),
		asynq.Unique(2*time.Minute), asynq.MaxRetry(3), asynq.Timeout(5*time.Minute))
	if errors.Is(err, asynq.ErrDuplicateTask) {
		return nil
	}
	return err
}

func (e *Enqueuer) SyncBucket(ctx context.Context, connID, bucket string) error {
	b, _ := json.Marshal(payload{ConnectionID: connID, Bucket: bucket})
	_, err := e.c.EnqueueContext(ctx, asynq.NewTask(TypeSyncBucket, b), asynq.Queue(queue),
		asynq.Unique(time.Hour), asynq.MaxRetry(3), asynq.Timeout(6*time.Hour))
	if errors.Is(err, asynq.ErrDuplicateTask) {
		return nil
	}
	return err
}

type Worker struct {
	Conns *connections.Store
	Pool  *storage.Pool
	Index *search.Index
	Stats *stats.Store
	Enq   *Enqueuer
	Log   *slog.Logger
}

func (w *Worker) Register(mux *asynq.ServeMux) {
	mux.HandleFunc(TypeSyncConnection, w.handleConnection)
	mux.HandleFunc(TypeSyncBucket, w.handleBucket)
}

func (w *Worker) handleConnection(ctx context.Context, t *asynq.Task) error {
	var p payload
	if err := json.Unmarshal(t.Payload(), &p); err != nil {
		return fmt.Errorf("%w: %v", asynq.SkipRetry, err)
	}
	conn, err := w.Conns.Get(ctx, p.ConnectionID)
	if errors.Is(err, connections.ErrNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	buckets, err := w.Pool.For(conn).ListBuckets(ctx)
	if err != nil {
		return err
	}
	names := make([]string, len(buckets))
	created := make([]*time.Time, len(buckets))
	for i, b := range buckets {
		names[i], created[i] = b.Name, b.CreatedAt
	}
	if err := w.Stats.SyncBucketList(ctx, conn.ID, names, created); err != nil {
		return err
	}
	// remove do índice os buckets que não existem mais
	filter := "connection_id = " + search.Quote(conn.ID)
	for _, n := range names {
		filter += " AND bucket != " + search.Quote(n)
	}
	if err := w.Index.DeleteByFilter(ctx, filter, false); err != nil {
		w.Log.Warn("limpeza de buckets removidos falhou", "err", err)
	}
	if conn.IndexEnabled {
		for _, n := range names {
			if err := w.Enq.SyncBucket(ctx, conn.ID, n); err != nil {
				return err
			}
		}
	}
	return w.Conns.TouchSync(ctx, conn.ID)
}

func (w *Worker) handleBucket(ctx context.Context, t *asynq.Task) error {
	var p payload
	if err := json.Unmarshal(t.Payload(), &p); err != nil || p.Bucket == "" {
		return fmt.Errorf("%w: payload inválido", asynq.SkipRetry)
	}
	conn, err := w.Conns.Get(ctx, p.ConnectionID)
	if errors.Is(err, connections.ErrNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	runID, err := w.Stats.StartRun(ctx, conn.ID, p.Bucket)
	if err != nil {
		return err
	}
	log := w.Log.With("connection", conn.Name, "bucket", p.Bucket)
	start := time.Now()
	count, bytes, err := w.syncBucket(ctx, conn, p.Bucket)
	// usa contexto novo: a tarefa pode ter sido cancelada, mas o registro precisa ser fechado
	fctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if ferr := w.Stats.FinishRun(fctx, runID, count, bytes, err); ferr != nil {
		log.Error("falha ao registrar fim da sync", "err", ferr)
	}
	if err != nil {
		log.Error("sync falhou", "err", err, "objects", count)
		return err
	}
	_ = w.Conns.TouchSync(fctx, conn.ID)
	log.Info("sync concluída", "objects", count, "bytes", bytes, "took", time.Since(start).Round(time.Millisecond).String())
	return nil
}

func (w *Worker) syncBucket(ctx context.Context, conn *connections.Connection, bucket string) (int64, int64, error) {
	syncID := uuid.NewString()
	var count, bytes int64
	byCat := map[string]stats.CategoryAgg{}
	buf := make([]search.Doc, 0, batchSize)
	flush := func() error {
		if len(buf) == 0 {
			return nil
		}
		err := w.Index.Upsert(ctx, buf, false)
		buf = buf[:0]
		return err
	}
	err := w.Pool.For(conn).Walk(ctx, bucket, "", func(items []objects.Item) error {
		for _, it := range items {
			if len(it.Key) > 0 && it.Key[len(it.Key)-1] == '/' && it.Size == 0 {
				continue // marcador de pasta
			}
			count++
			bytes += it.Size
			a := byCat[it.Category]
			a.Bytes += it.Size
			a.Count++
			byCat[it.Category] = a
			buf = append(buf, search.NewDoc(conn.ID, bucket, syncID, it))
			if len(buf) >= batchSize {
				if err := flush(); err != nil {
					return err
				}
			}
		}
		return nil
	})
	if err == nil {
		err = flush()
	}
	if err != nil {
		return count, bytes, err
	}
	// Remove órfãos. A fila de tarefas do Meilisearch é sequencial, então este delete
	// roda depois de todos os upserts acima.
	filter := fmt.Sprintf("connection_id = %s AND bucket = %s AND sync_id != %s",
		search.Quote(conn.ID), search.Quote(bucket), search.Quote(syncID))
	if err := w.Index.DeleteByFilter(ctx, filter, true); err != nil {
		return count, bytes, err
	}
	return count, bytes, w.Stats.RecordBucket(ctx, conn.ID, bucket, count, bytes, byCat)
}

// Schedule verifica a cada minuto quais conexões precisam de nova sincronização.
func (w *Worker) Schedule(ctx context.Context) {
	tick := time.NewTicker(time.Minute)
	defer tick.Stop()
	for {
		w.scheduleOnce(ctx)
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
}

func (w *Worker) scheduleOnce(ctx context.Context) {
	conns, err := w.Conns.List(ctx)
	if err != nil {
		w.Log.Error("scheduler: listar conexões", "err", err)
		return
	}
	for _, c := range conns {
		if !c.IndexEnabled || c.SyncIntervalMinutes <= 0 {
			continue
		}
		if c.LastSyncAt != nil && time.Since(*c.LastSyncAt) < time.Duration(c.SyncIntervalMinutes)*time.Minute {
			continue
		}
		if err := w.Enq.SyncConnection(ctx, c.ID); err != nil {
			w.Log.Error("scheduler: enfileirar", "connection", c.Name, "err", err)
		}
	}
}
