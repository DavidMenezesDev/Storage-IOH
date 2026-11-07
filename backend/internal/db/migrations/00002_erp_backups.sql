-- +goose Up
ALTER TABLE users
    ADD COLUMN name          TEXT NOT NULL DEFAULT '',
    ADD COLUMN role          TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'operator', 'viewer')),
    ADD COLUMN active        BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN last_login_at TIMESTAMPTZ;

CREATE TABLE clients (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                  TEXT NOT NULL,
    document              TEXT NOT NULL DEFAULT '',
    contact_name          TEXT NOT NULL DEFAULT '',
    contact_email         TEXT NOT NULL DEFAULT '',
    contact_phone         TEXT NOT NULL DEFAULT '',
    notes                 TEXT NOT NULL DEFAULT '',
    tags                  TEXT[] NOT NULL DEFAULT '{}',
    active                BOOLEAN NOT NULL DEFAULT true,
    connection_id         UUID NOT NULL REFERENCES connections (id) ON DELETE RESTRICT,
    bucket                TEXT NOT NULL,
    prefix                TEXT NOT NULL DEFAULT '',

    expected_every_hours  INTEGER NOT NULL DEFAULT 24 CHECK (expected_every_hours > 0),
    grace_hours           INTEGER NOT NULL DEFAULT 6 CHECK (grace_hours >= 0),
    min_size_bytes        BIGINT NOT NULL DEFAULT 1024 CHECK (min_size_bytes >= 0),
    size_drop_pct         INTEGER NOT NULL DEFAULT 50 CHECK (size_drop_pct BETWEEN 0 AND 100),
    file_pattern          TEXT NOT NULL DEFAULT '*',
    retention_days        INTEGER NOT NULL DEFAULT 0 CHECK (retention_days >= 0),
    retention_min_keep    INTEGER NOT NULL DEFAULT 7 CHECK (retention_min_keep >= 1),
    retention_auto        BOOLEAN NOT NULL DEFAULT false,

    ingest_token_hash     TEXT UNIQUE,
    ingest_token_prefix   TEXT,

    status                TEXT NOT NULL DEFAULT 'pending',
    status_reason         TEXT NOT NULL DEFAULT 'Aguardando primeira varredura',
    status_changed_at     TIMESTAMPTZ,
    last_backup_at        TIMESTAMPTZ,
    last_backup_key       TEXT,
    last_backup_size      BIGINT,
    backup_count          INTEGER NOT NULL DEFAULT 0,
    total_bytes           BIGINT NOT NULL DEFAULT 0,
    last_scan_at          TIMESTAMPTZ,
    last_scan_error       TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX clients_status_idx ON clients (status) WHERE active;

CREATE TABLE client_backups (
    client_id     UUID NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
    key           TEXT NOT NULL,
    size          BIGINT NOT NULL,
    last_modified TIMESTAMPTZ NOT NULL,
    etag          TEXT NOT NULL DEFAULT '',
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (client_id, key)
);
CREATE INDEX client_backups_recent_idx ON client_backups (client_id, last_modified DESC);
CREATE INDEX client_backups_global_recent_idx ON client_backups (last_modified DESC);

CREATE TABLE share_links (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_hash    TEXT NOT NULL UNIQUE,
    client_id     UUID NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
    key           TEXT NOT NULL,
    expires_at    TIMESTAMPTZ NOT NULL,
    max_downloads INTEGER,
    downloads     INTEGER NOT NULL DEFAULT 0,
    revoked       BOOLEAN NOT NULL DEFAULT false,
    url           TEXT NOT NULL,
    created_by    TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX share_links_client_idx ON share_links (client_id, created_at DESC);

CREATE TABLE alert_channels (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type          TEXT NOT NULL CHECK (type IN ('webhook', 'email')),
    name          TEXT NOT NULL,
    target        TEXT NOT NULL,
    only_problems BOOLEAN NOT NULL DEFAULT false,
    enabled       BOOLEAN NOT NULL DEFAULT true,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE alerts (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id   UUID NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
    from_status TEXT NOT NULL,
    to_status   TEXT NOT NULL,
    message     TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    delivered   BOOLEAN NOT NULL DEFAULT false,
    error       TEXT
);
CREATE INDEX alerts_created_idx ON alerts (created_at DESC);
CREATE INDEX alerts_client_idx ON alerts (client_id, created_at DESC);

CREATE TABLE audit_log (
    id            BIGSERIAL PRIMARY KEY,
    at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    user_email    TEXT,
    action        TEXT NOT NULL,
    client_id     UUID,          -- sem FK: a trilha sobrevive à exclusão do cliente
    client_name   TEXT,
    connection_id UUID,
    bucket        TEXT,
    key           TEXT,
    detail        JSONB NOT NULL DEFAULT '{}'::jsonb,
    ip            TEXT NOT NULL DEFAULT ''
);
CREATE INDEX audit_at_idx ON audit_log (at DESC);
CREATE INDEX audit_client_idx ON audit_log (client_id, at DESC);

-- +goose Down
DROP TABLE audit_log;
DROP TABLE alerts;
DROP TABLE alert_channels;
DROP TABLE share_links;
DROP TABLE client_backups;
DROP TABLE clients;
ALTER TABLE users DROP COLUMN last_login_at, DROP COLUMN active, DROP COLUMN role, DROP COLUMN name;
