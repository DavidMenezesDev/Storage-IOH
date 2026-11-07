// storage-ioh: binário único com os subcomandos api, worker e migrate.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/hibiken/asynq"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"storage-ioh/internal/alerts"
	"storage-ioh/internal/audit"
	"storage-ioh/internal/auth"
	"storage-ioh/internal/cache"
	"storage-ioh/internal/clients"
	"storage-ioh/internal/config"
	"storage-ioh/internal/connections"
	"storage-ioh/internal/db"
	"storage-ioh/internal/httpapi"
	"storage-ioh/internal/indexer"
	"storage-ioh/internal/search"
	"storage-ioh/internal/secret"
	"storage-ioh/internal/stats"
	"storage-ioh/internal/storage"
	"storage-ioh/internal/thumbs"
)

func main() {
	cmd := "api"
	if len(os.Args) > 1 {
		cmd = os.Args[1]
	}
	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintln(os.Stderr, "configuração inválida:", err)
		os.Exit(1)
	}
	log := newLogger(cfg.LogLevel)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	switch cmd {
	case "api":
		err = runAPI(ctx, cfg, log)
	case "worker":
		err = runWorker(ctx, cfg, log)
	case "migrate":
		err = runMigrate(ctx, cfg)
	default:
		err = fmt.Errorf("subcomando desconhecido %q (use: api | worker | migrate)", cmd)
	}
	if err != nil {
		log.Error("encerrando com erro", "err", err)
		os.Exit(1)
	}
}

func newLogger(level string) *slog.Logger {
	var l slog.Level
	_ = l.UnmarshalText([]byte(level))
	return slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: l}))
}

type deps struct {
	pool  *pgxpool.Pool
	rdb   *redis.Client
	ropt  asynq.RedisConnOpt
	conns *connections.Store
	index *search.Index
	stats *stats.Store
	enq   *indexer.Enqueuer
	pool2 *storage.Pool
	cli   *clients.Store
	scan  *clients.Scanner
	alrt  *alerts.Service
	aud   *audit.Log
}

// retry tenta fn até dar certo ou o contexto acabar (dependências subindo junto no compose).
func retry(ctx context.Context, log *slog.Logger, what string, fn func() error) error {
	var err error
	for i := 0; i < 30; i++ {
		if err = fn(); err == nil {
			return nil
		}
		log.Warn("aguardando dependência", "dep", what, "err", err)
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(2 * time.Second):
		}
	}
	return fmt.Errorf("%s: %w", what, err)
}

func setup(ctx context.Context, cfg *config.Config, log *slog.Logger, migrate bool) (*deps, error) {
	d := &deps{}
	if err := retry(ctx, log, "postgres", func() (err error) {
		d.pool, err = db.Connect(ctx, cfg.DatabaseURL)
		return
	}); err != nil {
		return nil, err
	}
	if migrate {
		if err := db.Migrate(ctx, d.pool); err != nil {
			return nil, fmt.Errorf("migrations: %w", err)
		}
	}
	ropt, err := asynq.ParseRedisURI(cfg.RedisURL)
	if err != nil {
		return nil, fmt.Errorf("REDIS_URL: %w", err)
	}
	d.ropt = ropt
	opts, err := redis.ParseURL(cfg.RedisURL)
	if err != nil {
		return nil, fmt.Errorf("REDIS_URL: %w", err)
	}
	d.rdb = redis.NewClient(opts)
	if err := retry(ctx, log, "redis", func() error { return d.rdb.Ping(ctx).Err() }); err != nil {
		return nil, err
	}
	box, err := secret.New(cfg.AppSecret)
	if err != nil {
		return nil, err
	}
	d.conns = connections.NewStore(d.pool, box)
	d.index = search.New(cfg.MeiliURL, cfg.MeiliKey)
	if err := retry(ctx, log, "meilisearch", func() error { return d.index.Setup(ctx) }); err != nil {
		return nil, err
	}
	d.stats = stats.New(d.pool)
	d.enq = indexer.NewEnqueuer(ropt)
	d.pool2 = storage.NewPool()
	d.cli = clients.NewStore(d.pool)
	d.aud = audit.New(d.pool, log)
	d.alrt = alerts.New(d.pool, alerts.SMTPConfig{Host: cfg.SMTPHost, Port: cfg.SMTPPort, User: cfg.SMTPUser,
		Password: cfg.SMTPPassword, From: cfg.SMTPFrom}, cfg.PublicURL, d.enq)
	d.scan = &clients.Scanner{Store: d.cli, Conns: d.conns, Pool: d.pool2, Notify: d.alrt, Audit: d.aud, Log: log}
	return d, nil
}

func (d *deps) close() {
	d.enq.Close()
	d.rdb.Close()
	d.pool.Close()
}

func runMigrate(ctx context.Context, cfg *config.Config) error {
	pool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	return db.Migrate(ctx, pool)
}

func runAPI(ctx context.Context, cfg *config.Config, log *slog.Logger) error {
	d, err := setup(ctx, cfg, log, true)
	if err != nil {
		return err
	}
	defer d.close()

	authSvc := auth.New(d.pool, d.rdb, cfg.SessionTTL, cfg.CookieSecure)
	created, err := authSvc.Bootstrap(ctx, cfg.AdminEmail, cfg.AdminPassword)
	if err != nil {
		return err
	}
	if created {
		log.Info("usuário admin criado", "email", cfg.AdminEmail)
	}
	if err := os.MkdirAll(cfg.ThumbDir, 0o755); err != nil {
		return fmt.Errorf("THUMB_DIR: %w", err)
	}

	srv := &httpapi.Server{
		Cfg: cfg, Log: log, Auth: authSvc, Conns: d.conns, Pool: d.pool2,
		Clients: d.cli, Scanner: d.scan, Alerts: d.alrt, Audit: d.aud,
		Cache: cache.New(d.rdb, cfg.ListCacheTTL), Index: d.index, Stats: d.stats,
		Thumbs: thumbs.New(cfg.ThumbDir, cfg.ThumbMaxSourceMB), Enq: d.enq, Redis: d.rdb,
	}
	hs := &http.Server{Addr: cfg.HTTPAddr, Handler: srv.Router(), ReadHeaderTimeout: 10 * time.Second}
	errc := make(chan error, 1)
	go func() { errc <- hs.ListenAndServe() }()
	log.Info("api ouvindo", "addr", cfg.HTTPAddr, "preview_mode", cfg.PreviewMode)
	select {
	case err := <-errc:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	case <-ctx.Done():
	}
	shutdown, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	return hs.Shutdown(shutdown)
}

func runWorker(ctx context.Context, cfg *config.Config, log *slog.Logger) error {
	d, err := setup(ctx, cfg, log, false)
	if err != nil {
		return err
	}
	defer d.close()
	if err := d.stats.FailStaleRuns(ctx); err != nil {
		log.Warn("não foi possível marcar execuções interrompidas", "err", err)
	}
	w := &indexer.Worker{Conns: d.conns, Pool: d.pool2, Index: d.index, Stats: d.stats, Enq: d.enq, Log: log}
	bw := &indexer.BackupWorker{Clients: d.cli, Scanner: d.scan, Alerts: d.alrt, Enq: d.enq, Log: log,
		Interval: time.Duration(cfg.ScanIntervalMinutes) * time.Minute}
	mux := asynq.NewServeMux()
	w.Register(mux)
	bw.Register(mux)
	srv := asynq.NewServer(d.ropt, asynq.Config{
		Concurrency:     cfg.WorkerConcurrency,
		Queues:          map[string]int{"backups": 3, "index": 1},
		Logger:          asynqLogger{log},
		ShutdownTimeout: 20 * time.Second,
	})
	if err := srv.Start(mux); err != nil {
		return err
	}
	go w.Schedule(ctx)
	go bw.Schedule(ctx)
	log.Info("worker iniciado", "concurrency", cfg.WorkerConcurrency)
	<-ctx.Done()
	srv.Shutdown()
	return nil
}

type asynqLogger struct{ l *slog.Logger }

func (a asynqLogger) Debug(args ...any) { a.l.Debug(fmt.Sprint(args...)) }
func (a asynqLogger) Info(args ...any)  { a.l.Info(fmt.Sprint(args...)) }
func (a asynqLogger) Warn(args ...any)  { a.l.Warn(fmt.Sprint(args...)) }
func (a asynqLogger) Error(args ...any) { a.l.Error(fmt.Sprint(args...)) }
func (a asynqLogger) Fatal(args ...any) { a.l.Error(fmt.Sprint(args...)); os.Exit(1) }
