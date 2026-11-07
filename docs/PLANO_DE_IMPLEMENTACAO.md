# Storage-IOH — Plano de Implementação

Baseado em [Storage-IOH.md](../Storage-IOH.md). Premissas: **leve** e **setup fácil** (`docker compose up` e pronto).

---

## 1. Escopo do MVP

| Funcionalidade | Como entra no MVP |
|---|---|
| Web interface moderna | Next.js (App Router) + Tailwind + shadcn/ui, tema claro/escuro |
| Conecta S3, R2 e MinIO | Um único cliente S3-compatível (aws-sdk-go-v2) com endpoint, região e path-style configuráveis |
| Navegação entre buckets | Sidebar: conexões → buckets; breadcrumb por prefixo (`/` como delimitador) |
| Visualização em lista, galeria e colunas | Três modos sobre a mesma API de listagem |
| Pesquisa, filtros e previews | Busca no Meilisearch + filtros (tipo, extensão, tamanho, data, bucket) |
| Busca indexada de objetos | Worker sincroniza listagens dos buckets para o Meilisearch |
| Dashboard de armazenamento | Agregados por conexão/bucket/tipo + histórico diário |
| Visualizar arquivos sem sair do app | Painel/modal de preview: imagem, vídeo, áudio, PDF, texto/código, Markdown, JSON, CSV |

**Fora do MVP** (fases posteriores): multiusuário com permissões, notificações de evento dos buckets (S3 Events / MinIO webhooks), versionamento de objetos, edição de lifecycle/políticas, compartilhamento por link público.

---

## 2. Arquitetura

```
                ┌──────────────┐
  navegador ───▶│  web (Next)  │  rewrites /api/* → api:8080 (mesma origem, sem CORS)
                └──────┬───────┘
                       ▼
                ┌──────────────┐     ┌────────────┐
                │  api (Go)    │────▶│ Postgres   │  conexões, sync runs, stats, usuários
                │  HTTP        │────▶│ Redis      │  cache de listagens + fila (asynq)
                └──┬───────┬───┘     │ Meilisearch│  índice de objetos
                   │       │ enqueue └────────────┘
                   │       ▼
                   │  ┌──────────────┐
                   │  │ worker (Go)  │  sync/indexação, thumbnails, snapshots de stats
                   │  └──────┬───────┘
                   ▼         ▼
             S3 / R2 / MinIO (provedores externos)
```

- **api** e **worker** são o **mesmo binário Go** com subcomandos (`storage-ioh api`, `storage-ioh worker`) → uma imagem só, menos manutenção.
- O navegador nunca fala direto com o provedor no MVP: preview/download passam por **proxy streaming na API com suporte a `Range`**. Isso evita exigir configuração de CORS nos buckets (setup fácil). URLs pré-assinadas ficam como opção (`PREVIEW_MODE=presigned`) para quem quiser tirar a carga da API.

### Stack detalhada

| Camada | Escolha | Motivo |
|---|---|---|
| HTTP Go | `chi` | leve, idiomático, middlewares prontos |
| S3 | `aws-sdk-go-v2/service/s3` | cobre S3, R2 (`https://<account>.r2.cloudflarestorage.com`, região `auto`) e MinIO (path-style) |
| Postgres | `pgx/v5` + `sqlc` + migrations `goose` (embutidas no binário) | SQL tipado, sem ORM |
| Fila | `hibiken/asynq` sobre Redis | retries, agendamento, cron, UI opcional |
| Cache | `go-redis/v9` | listagens com TTL curto |
| Busca | `meilisearch-go` | |
| Thumbnails | `disintegration/imaging` (imagens); `ffmpeg` opcional para vídeo | |
| Config | env vars (`caarlos0/env`) | 12-factor, combina com compose |
| Logs | `log/slog` JSON | stdlib |
| Front | Next.js 15, TypeScript, Tailwind, shadcn/ui, TanStack Query, TanStack Virtual, `react-pdf`, `shiki` | |

---

## 3. Estrutura do repositório

```
storage-ioh/
├── docker-compose.yml
├── docker-compose.dev.yml        # hot reload (air + next dev), portas expostas
├── .env.example
├── Makefile                      # up, down, dev, test, lint, migrate, gen
├── backend/
│   ├── cmd/storage-ioh/main.go   # subcomandos api | worker | migrate
│   ├── internal/
│   │   ├── config/
│   │   ├── http/                 # router, handlers, middlewares (auth, logging, errors)
│   │   ├── auth/
│   │   ├── connections/          # CRUD + criptografia de credenciais
│   │   ├── storage/              # adaptador S3 (Provider interface), presets S3/R2/MinIO
│   │   ├── browse/               # listagem com delimitador, cache Redis
│   │   ├── preview/              # proxy com Range, detecção de tipo, thumbnails
│   │   ├── search/               # cliente Meili, settings do índice, query builder
│   │   ├── indexer/              # tasks asynq de sync
│   │   ├── stats/                # agregações e snapshots
│   │   └── db/                   # sqlc gerado + migrations/
│   ├── Dockerfile                # multi-stage → distroless (+ variante com ffmpeg)
│   └── go.mod
├── web/
│   ├── app/
│   │   ├── (auth)/login/
│   │   ├── dashboard/
│   │   ├── connections/
│   │   ├── browse/[connection]/[bucket]/[[...prefix]]/
│   │   └── search/
│   ├── components/
│   │   ├── browser/              # ListView, GalleryView, ColumnsView, Toolbar, Breadcrumb
│   │   ├── preview/              # PreviewPanel + renderers por tipo
│   │   └── dashboard/
│   ├── lib/api/                  # cliente tipado (gerado do OpenAPI)
│   ├── Dockerfile                # output: "standalone"
│   └── package.json
└── docs/
    └── openapi.yaml
```

---

## 4. Modelo de dados (Postgres)

```sql
users        (id, email, password_hash, created_at)
connections  (id, name, provider ENUM('s3','r2','minio','custom'),
              endpoint, region, force_path_style BOOL,
              access_key_enc BYTEA, secret_key_enc BYTEA,   -- AES-256-GCM, chave = APP_SECRET
              index_enabled BOOL, sync_interval INTERVAL,
              created_at, updated_at)
buckets      (id, connection_id, name, region, discovered_at,
              last_synced_at, object_count, total_bytes)     -- cache/resumo
sync_runs    (id, connection_id, bucket, status, started_at, finished_at,
              objects_seen, bytes_seen, error)
storage_snapshots (date, connection_id, bucket, object_count, total_bytes,
              bytes_by_category JSONB)                       -- histórico do dashboard
```

Credenciais nunca saem da API (respostas mascaram a secret key).

## 5. Índice Meilisearch (`objects`)

```json
{
  "id": "sha1(connection_id|bucket|key)",
  "connection_id": "…", "bucket": "…",
  "key": "fotos/2025/praia.jpg", "name": "praia.jpg", "prefix": "fotos/2025/",
  "ext": "jpg", "category": "image",
  "content_type": "image/jpeg",
  "size": 482113, "last_modified": 1730851200, "etag": "…",
  "sync_id": "…"
}
```

- `searchableAttributes`: `name`, `key`
- `filterableAttributes`: `connection_id`, `bucket`, `prefix`, `ext`, `category`, `size`, `last_modified`, `sync_id`
- `sortableAttributes`: `name`, `size`, `last_modified`
- `category` derivado da extensão/MIME: `image | video | audio | document | code | archive | other`.

### Estratégia de sincronização

1. **Full sync** (task `index:bucket`): `ListObjectsV2` paginado (sem delimitador) → lotes de 1.000 docs → `AddDocuments` (upsert). Cada doc recebe o `sync_id` da execução.
2. Ao final, remove órfãos: `DeleteDocumentsByFilter("bucket = X AND connection_id = Y AND sync_id != atual")`.
3. Agregados (contagem, bytes, bytes por categoria) são calculados **durante** a listagem e gravados em `buckets` e `storage_snapshots` → dashboard sem consultas caras.
4. Agendamento: cron do asynq por conexão (`sync_interval`, padrão 6h) + botão "Reindexar agora".
5. Ações feitas pelo próprio app (upload/delete, fase 5) atualizam o índice na hora.
6. Concorrência limitada por conexão (evita rate limit/custos de request no provedor).

---

## 6. API (v1)

```
POST   /api/auth/login | /api/auth/logout        GET /api/auth/me

GET    /api/connections                          POST /api/connections
PATCH  /api/connections/:id                      DELETE /api/connections/:id
POST   /api/connections/test                     # valida credenciais antes de salvar
POST   /api/connections/:id/sync                 # dispara reindexação

GET    /api/connections/:id/buckets
GET    /api/connections/:id/buckets/:bucket/objects?prefix=&cursor=&limit=
       → { folders: [...], objects: [...], nextCursor }
GET    /api/connections/:id/buckets/:bucket/object/meta?key=     # HEAD
GET    /api/connections/:id/buckets/:bucket/object/content?key=  # proxy com Range
GET    /api/connections/:id/buckets/:bucket/object/thumb?key=&size=
GET    /api/connections/:id/buckets/:bucket/object/download?key= # Content-Disposition

GET    /api/search?q=&connection=&bucket=&category=&ext=&min_size=&max_size=&from=&to=&sort=&page=
GET    /api/stats/overview        GET /api/stats/history?days=30
GET    /api/sync-runs?connection=
GET    /healthz | /readyz
```

Contrato documentado em `docs/openapi.yaml`; cliente TS gerado com `openapi-typescript`.

---

## 7. Frontend

- **Layout**: sidebar (conexões → buckets), topbar com busca global (⌘K), área principal, painel de preview à direita (redimensionável).
- **Lista**: tabela virtualizada (nome, tamanho, tipo, modificado), ordenação, seleção múltipla, scroll infinito via cursor.
- **Galeria**: grid de thumbnails (`/thumb`), lazy-load com IntersectionObserver; ícone por categoria quando não há thumb.
- **Colunas**: estilo Finder (Miller columns); cada coluna = uma listagem de prefixo; última coluna mostra preview.
- Modo de visualização persistido por usuário (localStorage) e refletido na URL (`?view=gallery`).
- **Preview** (`PreviewPanel` + registry por categoria):
  - imagem: `<img>` com zoom/pan
  - vídeo/áudio: `<video>/<audio>` nativo (streaming via Range)
  - PDF: `react-pdf`
  - texto/código: `shiki`, limite de 1 MB (acima disso: "baixar")
  - Markdown renderizado, JSON com árvore, CSV em tabela (primeiras N linhas)
  - fallback: metadados + download
  - navegação ←/→ entre arquivos da pasta atual sem fechar o preview
- **Busca**: página de resultados com facets (bucket, categoria, extensão), filtros de tamanho/data, mesmos três modos de visualização.
- **Dashboard**: cards (total armazenado, nº de objetos, nº de buckets, última sync), barras por bucket, donut por categoria, linha de crescimento (30/90 dias), top 10 maiores arquivos, status das syncs.
- **Conexões**: formulário com presets (S3 / R2 / MinIO preenchem endpoint/região/path-style), botão "Testar conexão".

---

## 8. Setup fácil (Docker Compose)

- `cp .env.example .env && docker compose up -d` → app em `http://localhost:3000`.
- `.env.example` com apenas o essencial: `APP_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `MEILI_MASTER_KEY`. Se `APP_SECRET` vier vazio, a API se recusa a subir com mensagem clara.
- Migrations rodam automaticamente no start da API.
- Usuário admin criado no primeiro boot a partir do `.env`.
- Healthchecks em todos os serviços + `depends_on: condition: service_healthy`.
- Volumes nomeados: `pgdata`, `redisdata`, `meilidata`, `thumbs`.
- Imagens publicadas no GHCR (`ghcr.io/<org>/storage-ioh-api`, `-web`) para quem não quer buildar.
- `docker-compose.dev.yml` opcional inclui um **MinIO local com dados de exemplo** para desenvolvimento e demo.
- Meta de consumo em idle: < 500 MB RAM somando todos os containers.

---

## 9. Fases e entregas

### Fase 0 — Fundação (≈ 1 semana)
- Monorepo, Makefile, compose (prod + dev), Dockerfiles multi-stage.
- Binário Go com subcomandos, config, slog, healthchecks, migrations embutidas.
- Next.js com layout base, tema, cliente de API, proxy `/api`.
- CI (GitHub Actions): lint (`golangci-lint`, `eslint`), testes, build de imagens.
- **Pronto quando**: `docker compose up` sobe tudo saudável e mostra a tela de login.

### Fase 1 — Conexões e navegação (≈ 1,5 semana)
- Auth admin (sessão em cookie httpOnly, bcrypt).
- CRUD de conexões com criptografia AES-GCM e "Testar conexão".
- Adaptador S3 com presets S3/R2/MinIO; listagem de buckets e de prefixos com cursor.
- Cache Redis de listagens (TTL 30 s, invalidado em ações).
- UI: sidebar, breadcrumb, **visualização em lista**.
- **Pronto quando**: navego por buckets reais de S3, R2 e MinIO.

### Fase 2 — Visualizações e preview (≈ 2 semanas)
- Proxy de conteúdo com Range, detecção de MIME, download.
- Worker + asynq; task de thumbnails (imagens; vídeo se ffmpeg presente), cache em volume.
- UI: **galeria**, **colunas**, painel de preview com todos os renderizadores.
- **Pronto quando**: abro imagem, vídeo (com seek), PDF e código sem sair do app.

### Fase 3 — Indexação e busca (≈ 1,5 semana)
- Settings do índice Meili, task `index:bucket`, remoção de órfãos, cron por conexão.
- Tabela `sync_runs` + tela de status.
- Endpoint `/search` com filtros e facets; busca global ⌘K; página de resultados.
- **Pronto quando**: bucket com 100 mil objetos indexa sem estourar memória (streaming em lotes) e a busca responde em < 100 ms.

### Fase 4 — Dashboard (≈ 1 semana)
- Agregados gerados na sync, snapshots diários, endpoints de stats.
- UI do dashboard com gráficos (Recharts).
- **Pronto quando**: dashboard reflete os números da última sync e mostra histórico.

### Fase 5 — Gestão básica e polimento (≈ 1,5 semana)
- Upload (multipart para arquivos grandes, com progresso), criar pasta, renomear (copy+delete), excluir (com confirmação, em lote), download em lote (zip streaming).
- Atualização imediata do índice nessas ações.
- Atalhos de teclado, estados vazios/erro, i18n (pt-BR/en).
- Documentação: README com quickstart, guia por provedor, screenshots.
- **Pronto quando**: release `v0.1.0` com imagens no GHCR.

**Total estimado: ~8–9 semanas** para uma pessoa em tempo integral.

---

## 10. Testes

- **Go**: unitários por pacote; integração com `testcontainers-go` (Postgres, Redis, Meili, **MinIO** como stand-in de S3/R2).
- **Front**: Vitest + Testing Library para componentes; Playwright E2E rodando contra o `docker-compose.dev.yml` com MinIO semeado.
- Teste manual de compatibilidade com R2 e S3 reais antes de cada release (checklist em `docs/`).

## 11. Segurança

- Credenciais criptografadas em repouso; secret key nunca retornada.
- Todas as rotas exigem sessão; cookies `SameSite=Lax`, `Secure` quando atrás de HTTPS.
- Preview de HTML/SVG servido com `Content-Disposition: attachment` ou `Content-Security-Policy: sandbox` para evitar XSS via arquivo do bucket.
- Rate limit no login; validação de `key`/`prefix` (sem path traversal no cache de thumbnails).
- Meilisearch e Redis não expostos fora da rede do compose.

## 12. Riscos e decisões em aberto

| Tema | Risco / dúvida | Proposta |
|---|---|---|
| Buckets muito grandes (milhões de objetos) | Full sync lento e custo de requests LIST | Sync incremental por prefixo + eventos do provedor na pós-MVP; intervalo configurável |
| Proxy vs. presigned | Proxy consome banda da API | Proxy por padrão (zero config); presigned opcional |
| Multiusuário | MVP só tem admin | Modelar `users` desde já; RBAC por conexão depois |
| Thumbnails de vídeo/PDF | ffmpeg aumenta a imagem | Imagem `-full` opcional com ffmpeg/poppler |
| Licença | Não definida | Sugestão: MIT ou Apache-2.0 |

---

## 13. Ajustes feitos na implementação

| Plano | Implementado | Motivo |
|---|---|---|
| `sqlc` para queries | SQL escrito à mão com `pgx` | poucas queries; evita etapa de geração de código |
| Thumbnails gerados pelo worker | Gerados sob demanda pela API, com cache em disco (volume `thumbs`) e `singleflight` | resposta imediata na galeria; nada a pré-processar |
| Cliente TS gerado do OpenAPI | Tipos escritos à mão a partir de [API.md](API.md) | contrato pequeno |
| MinIO oficial no compose de dev | `pgsty/minio` (build comunitário) | as imagens `minio/minio` deixaram de ser publicadas no Docker Hub |
| Proteção CSRF por Origin | Cookie `SameSite=Lax` | a API fica atrás do proxy do Next, onde o `Host` não bate com o `Origin` |

---

## 14. Foco em backups de clientes ERP (v0.2)

O produto passou a ser uma central de backups para empresas de ERP. Contrato em [API-BACKUPS.md](API-BACKUPS.md).

| Decisão | Motivo |
|---|---|
| Cliente = `conexão + bucket + prefixo` com política própria | cada cliente do ERP tem um banco e uma rotina diferentes |
| Histórico em Postgres (`client_backups`), não no Meilisearch | status, retenção e gráficos precisam de dados exatos por cliente |
| Varredura agendada (`SCAN_INTERVAL_MINUTES`) + varredura imediata após envio por token | "atrasado" depende do tempo passar, não só de eventos |
| Status: em dia, atrasado, suspeito (mínimo / queda vs. média dos 7 anteriores), sem backup, erro, aguardando, inativo | cobre os problemas reais: rotina parada, dump vazio/truncado, credencial quebrada |
| Alertas só em transições (e na recuperação) | evita spam a cada varredura |
| Token de envio por cliente, `PUT /api/ingest/...`, hash no banco | cliente não recebe credencial do storage; revogável |
| Links temporários servidos pela API (não URL pré-assinada) | o storage pode não ser acessível de fora e o download precisa ser auditado |
| Retenção com `retentionMinKeep` obrigatório ≥ 1 e modo automático desligado por padrão | apagar backup é irreversível |
| Papéis admin / suporte / leitura + auditoria | backups de ERP têm dados pessoais (LGPD) |
