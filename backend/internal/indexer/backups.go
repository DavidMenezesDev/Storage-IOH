package indexer

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/hibiken/asynq"

	"storage-ioh/internal/alerts"
	"storage-ioh/internal/clients"
)

const (
	TypeClientScan   = "client:scan"
	TypeAlertDeliver = "alert:deliver"
	queueBackups     = "backups"
)

type idPayload struct {
	ID string `json:"id"`
}

func (e *Enqueuer) ScanClient(ctx context.Context, clientID string) error {
	b, _ := json.Marshal(idPayload{ID: clientID})
	_, err := e.c.EnqueueContext(ctx, asynq.NewTask(TypeClientScan, b), asynq.Queue(queueBackups),
		asynq.Unique(5*time.Minute), asynq.MaxRetry(2), asynq.Timeout(30*time.Minute))
	if errors.Is(err, asynq.ErrDuplicateTask) {
		return nil
	}
	return err
}

// DeliverAlert implementa alerts.Enqueuer.
func (e *Enqueuer) DeliverAlert(ctx context.Context, alertID string) error {
	b, _ := json.Marshal(idPayload{ID: alertID})
	_, err := e.c.EnqueueContext(ctx, asynq.NewTask(TypeAlertDeliver, b), asynq.Queue(queueBackups),
		asynq.MaxRetry(5), asynq.Timeout(2*time.Minute))
	return err
}

type BackupWorker struct {
	Clients  *clients.Store
	Scanner  *clients.Scanner
	Alerts   *alerts.Service
	Enq      *Enqueuer
	Interval time.Duration
	Log      *slog.Logger
}

func (w *BackupWorker) Register(mux *asynq.ServeMux) {
	mux.HandleFunc(TypeClientScan, func(ctx context.Context, t *asynq.Task) error {
		var p idPayload
		if err := json.Unmarshal(t.Payload(), &p); err != nil {
			return fmt.Errorf("%w: %v", asynq.SkipRetry, err)
		}
		return w.Scanner.Scan(ctx, p.ID)
	})
	mux.HandleFunc(TypeAlertDeliver, func(ctx context.Context, t *asynq.Task) error {
		var p idPayload
		if err := json.Unmarshal(t.Payload(), &p); err != nil {
			return fmt.Errorf("%w: %v", asynq.SkipRetry, err)
		}
		return w.Alerts.Deliver(ctx, p.ID)
	})
}

// Schedule enfileira a varredura dos clientes vencidos a cada minuto.
func (w *BackupWorker) Schedule(ctx context.Context) {
	tick := time.NewTicker(time.Minute)
	defer tick.Stop()
	for {
		ids, err := w.Clients.DueForScan(ctx, w.Interval)
		if err != nil {
			w.Log.Error("scheduler de backups: listar clientes", "err", err)
		}
		for _, id := range ids {
			if err := w.Enq.ScanClient(ctx, id); err != nil {
				w.Log.Error("scheduler de backups: enfileirar", "client", id, "err", err)
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
}
