-- +goose Up
CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE connections (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                  TEXT NOT NULL,
    provider              TEXT NOT NULL CHECK (provider IN ('s3', 'r2', 'minio', 'custom')),
    endpoint              TEXT NOT NULL DEFAULT '',
    region                TEXT NOT NULL DEFAULT '',
    force_path_style      BOOLEAN NOT NULL DEFAULT false,
    access_key_id         TEXT NOT NULL,
    secret_key_enc        BYTEA NOT NULL,
    index_enabled         BOOLEAN NOT NULL DEFAULT true,
    sync_interval_minutes INTEGER NOT NULL DEFAULT 360 CHECK (sync_interval_minutes >= 0),
    last_sync_at          TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE buckets (
    connection_id     UUID NOT NULL REFERENCES connections (id) ON DELETE CASCADE,
    name              TEXT NOT NULL,
    created_at        TIMESTAMPTZ,
    object_count      BIGINT,
    total_bytes       BIGINT,
    bytes_by_category JSONB NOT NULL DEFAULT '{}'::jsonb,
    last_synced_at    TIMESTAMPTZ,
    PRIMARY KEY (connection_id, name)
);

CREATE TABLE sync_runs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    connection_id UUID NOT NULL REFERENCES connections (id) ON DELETE CASCADE,
    bucket        TEXT NOT NULL,
    status        TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed')),
    started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at   TIMESTAMPTZ,
    objects_seen  BIGINT NOT NULL DEFAULT 0,
    bytes_seen    BIGINT NOT NULL DEFAULT 0,
    error         TEXT
);
CREATE INDEX sync_runs_conn_started_idx ON sync_runs (connection_id, started_at DESC);
CREATE INDEX sync_runs_started_idx ON sync_runs (started_at DESC);

CREATE TABLE storage_snapshots (
    day               DATE NOT NULL,
    connection_id     UUID NOT NULL REFERENCES connections (id) ON DELETE CASCADE,
    bucket            TEXT NOT NULL,
    object_count      BIGINT NOT NULL,
    total_bytes       BIGINT NOT NULL,
    bytes_by_category JSONB NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (day, connection_id, bucket)
);

-- +goose Down
DROP TABLE storage_snapshots;
DROP TABLE sync_runs;
DROP TABLE buckets;
DROP TABLE connections;
DROP TABLE users;
