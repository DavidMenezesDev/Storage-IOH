package config

import (
	"errors"
	"time"

	"github.com/caarlos0/env/v11"
)

type Config struct {
	HTTPAddr      string        `env:"HTTP_ADDR" envDefault:":8080"`
	DatabaseURL   string        `env:"DATABASE_URL" envDefault:"postgres://ioh:ioh@postgres:5432/ioh?sslmode=disable"`
	RedisURL      string        `env:"REDIS_URL" envDefault:"redis://redis:6379/0"`
	MeiliURL      string        `env:"MEILI_URL" envDefault:"http://meilisearch:7700"`
	MeiliKey      string        `env:"MEILI_MASTER_KEY"`
	AppSecret     string        `env:"APP_SECRET"`
	AdminEmail    string        `env:"ADMIN_EMAIL" envDefault:"admin@local"`
	AdminPassword string        `env:"ADMIN_PASSWORD"`
	CookieSecure  bool          `env:"COOKIE_SECURE" envDefault:"false"`
	SessionTTL    time.Duration `env:"SESSION_TTL" envDefault:"720h"`

	// proxy (padrão): a API faz streaming do conteúdo. presigned: redireciona para URL pré-assinada.
	PreviewMode string `env:"PREVIEW_MODE" envDefault:"proxy"`

	ThumbDir          string        `env:"THUMB_DIR" envDefault:"/data/thumbs"`
	ThumbMaxSourceMB  int64         `env:"THUMB_MAX_SOURCE_MB" envDefault:"50"`
	UploadMaxMB       int64         `env:"UPLOAD_MAX_MB" envDefault:"5120"`
	ListCacheTTL      time.Duration `env:"LIST_CACHE_TTL" envDefault:"30s"`
	WorkerConcurrency int           `env:"WORKER_CONCURRENCY" envDefault:"4"`
	LogLevel          string        `env:"LOG_LEVEL" envDefault:"info"`

	// URL pública do app (ex.: https://backup.suaempresa.com.br) usada em links de compartilhamento e alertas.
	// Vazia: deduzida da requisição.
	PublicURL           string `env:"PUBLIC_URL"`
	ScanIntervalMinutes int    `env:"SCAN_INTERVAL_MINUTES" envDefault:"15"`
	IngestMaxGB         int64  `env:"INGEST_MAX_GB" envDefault:"500"`

	SMTPHost     string `env:"SMTP_HOST"`
	SMTPPort     int    `env:"SMTP_PORT" envDefault:"587"`
	SMTPUser     string `env:"SMTP_USER"`
	SMTPPassword string `env:"SMTP_PASSWORD"`
	SMTPFrom     string `env:"SMTP_FROM"`
}

func Load() (*Config, error) {
	var c Config
	if err := env.Parse(&c); err != nil {
		return nil, err
	}
	if len(c.AppSecret) < 16 {
		return nil, errors.New("APP_SECRET precisa ter pelo menos 16 caracteres (gere com: openssl rand -hex 32)")
	}
	if c.PreviewMode != "proxy" && c.PreviewMode != "presigned" {
		return nil, errors.New("PREVIEW_MODE deve ser 'proxy' ou 'presigned'")
	}
	if c.ScanIntervalMinutes < 1 {
		c.ScanIntervalMinutes = 1
	}
	return &c, nil
}
