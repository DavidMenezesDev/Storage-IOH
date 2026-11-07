# Storage-IOH

Central de backups dos clientes para empresas de ERP. Os clientes enviam os backups para um object storage (**AWS S3**, **Cloudflare R2**, **MinIO** ou compatível) e o Storage-IOH acompanha cada um, avisa quando algo falha e facilita a restauração.

- **Monitoramento**: status por cliente (Em dia, Atrasado, Suspeito, Sem backup, Erro) com alertas por webhook e e-mail
- **Envio sem credenciais**: cada cliente recebe um token e envia o backup com `curl` ou PowerShell
- **Restauração**: download direto ou link temporário com validade e limite de downloads
- **Conformidade**: retenção por cliente, usuários com papéis e trilha de auditoria (LGPD)
- **Explorador de storage**: navegação, busca indexada e preview de arquivos

Stack: Go · Next.js · PostgreSQL · Redis · Meilisearch · Docker Compose.

---

## Setup em produção

**Requisitos:** um servidor Linux com Docker (Compose v2), `make` e `openssl`, e um domínio apontando para ele.

### 1. Baixar e configurar

```bash
git clone <repo> storage-ioh && cd storage-ioh
make env
```

O `make env` cria o `.env` com segredos aleatórios e mostra o login inicial. Edite o `.env` e ajuste:

```ini
PUBLIC_URL=https://backup.suaempresa.com.br
COOKIE_SECURE=true
POSTGRES_PASSWORD=<uma-senha-forte>

# opcional: alertas por e-mail
SMTP_HOST=smtp.suaempresa.com.br
SMTP_USER=...
SMTP_PASSWORD=...
```

> **Guarde o `APP_SECRET`.** Ele criptografa as credenciais dos storages. Se ele mudar, as conexões precisam ser recadastradas.

### 2. Subir

```bash
make up        # docker compose up -d --build
make logs      # acompanhar a inicialização
```

A interface fica em `http://127.0.0.1:3000` (porta definida em `WEB_PORT`). As migrations rodam sozinhas e o admin é criado no primeiro start.

### 3. HTTPS

Coloque um proxy reverso na frente da porta 3000. Exemplo com Caddy (o certificado é emitido automaticamente):

```caddy
backup.suaempresa.com.br {
    reverse_proxy 127.0.0.1:3000
}
```

Com Nginx, aumente `client_max_body_size` (ex.: `0`) e desligue o buffering (`proxy_request_buffering off`) para aceitar backups grandes.

### 4. Primeiro uso

1. Entre com `ADMIN_EMAIL` / `ADMIN_PASSWORD` e troque a senha.
2. **Conexões → Nova conexão**: cadastre o bucket onde ficam os backups.
3. **Clientes → Novo cliente**: informe a pasta (ex.: `clientes/<CNPJ>/`) e a política esperada.
4. **Alertas**: configure webhook e/ou e-mail.
5. Gere o token do cliente e agende o envio no servidor dele:

```bash
# Linux (cron): 0 2 * * * /opt/erp/enviar-backup.sh
curl -fS -T /var/backups/base.bak -H "Authorization: Bearer <TOKEN>" \
  "https://backup.suaempresa.com.br/api/ingest/base-$(date +%F).bak"
```

```powershell
# Windows (Agendador de Tarefas)
Invoke-WebRequest -Method Put -InFile "C:\Backup\base.fbk" -Headers @{Authorization="Bearer <TOKEN>"} `
  -Uri "https://backup.suaempresa.com.br/api/ingest/base-$(Get-Date -Format yyyy-MM-dd).fbk"
```

### Manutenção

```bash
git pull && make up                                                   # atualizar
docker compose exec -T postgres pg_dump -U ioh ioh > ioh-$(date +%F).sql   # backup do banco do app
make down                                                             # parar
```

Os dados ficam nos volumes Docker `pgdata`, `redisdata`, `meilidata` e `thumbs`. O índice de busca (Meilisearch) pode ser reconstruído a qualquer momento pelo botão **Reindexar**; o que importa preservar é o Postgres e o `.env`.

---

## Setup de teste / desenvolvimento

**Requisitos:** Docker (Compose v2) e `make`. Para rodar os testes fora do Docker: Go 1.26+, Node 22 e pnpm.

### Ambiente de demonstração

```bash
make dev
```

Sobe a stack completa mais um **MinIO local já populado** com arquivos de exemplo e backups de três clientes fictícios (um saudável, um suspeito, um abaixo do mínimo).

| Serviço | Endereço |
|---|---|
| Interface | http://localhost:3000 |
| API | http://127.0.0.1:8080 |
| Console do MinIO | http://127.0.0.1:9001 (`minioadmin` / `minioadmin`) |

No app, cadastre a conexão de exemplo em **Conexões → Nova conexão**:

| Campo | Valor |
|---|---|
| Provedor | MinIO |
| Endpoint | `http://minio:9000` |
| Access key / Secret key | `minioadmin` / `minioadmin` |

Depois crie clientes apontando para `backups-erp` → `clientes/<CNPJ>/` para ver os status em ação.

### Front com hot reload

```bash
make dev                                   # backend + dependências
cd web && pnpm install
API_URL=http://localhost:8080 pnpm dev     # http://localhost:3000
```

Se a porta 3000 estiver ocupada pelo container `web`, pare-o (`docker compose stop web`) ou use `pnpm dev -p 3001`.

### Testes

```bash
make test        # tudo
make test-go     # go vet + go test (backend)
make test-web    # lint + build (frontend)
```

O mesmo roda no CI a cada push/PR ([.github/workflows/ci.yml](.github/workflows/ci.yml)).

### Limpar

```bash
make dev-down                                                  # parar
docker compose -f docker-compose.yml -f docker-compose.dev.yml down -v   # parar e apagar os dados
```

---

## Configuração

Principais variáveis do `.env` (lista completa em [.env.example](.env.example)):

| Variável | Padrão | Descrição |
|---|---|---|
| `APP_SECRET` | — | obrigatório, ≥ 16 caracteres |
| `MEILI_MASTER_KEY` | — | obrigatório |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | `admin@local` / — | admin criado no primeiro start |
| `PUBLIC_URL` | *(deduzida)* | URL pública, usada em links, scripts de envio e alertas |
| `COOKIE_SECURE` | `false` | `true` atrás de HTTPS |
| `WEB_PORT` | `3000` | porta da interface |
| `SCAN_INTERVAL_MINUTES` | `15` | intervalo de verificação dos backups |
| `INGEST_MAX_GB` | `500` | tamanho máximo de um backup enviado por token |
| `SMTP_*` | — | e-mail para alertas (465 = TLS, 587 = STARTTLS) |
| `PREVIEW_MODE` | `proxy` | `presigned` baixa direto do provedor (exige CORS no bucket) |
| `WITH_FFMPEG` | `false` | `true` habilita miniaturas de vídeo |

## Provedores

| Provedor | Endpoint | Região |
|---|---|---|
| AWS S3 | *(vazio)* | ex.: `us-east-1` |
| Cloudflare R2 | `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` | `auto` |
| MinIO | `http://host:9000` | `us-east-1` |
| Outros (Wasabi, B2…) | URL do serviço | conforme o serviço (marque path-style se necessário) |

Permissões mínimas: `s3:ListAllMyBuckets`, `s3:ListBucket`, `s3:GetObject`, `s3:GetBucketLocation`. Para upload, retenção e exclusão: `s3:PutObject` e `s3:DeleteObject`.

## Papéis

| Papel | Pode |
|---|---|
| Leitura | ver painéis, clientes e status, sem acesso ao conteúdo dos arquivos |
| Suporte | + baixar e visualizar arquivos, criar links temporários, enviar arquivos |
| Administrador | + clientes, conexões, tokens, retenção, exclusões, usuários, alertas e auditoria |

## Estrutura

```
backend/   API + worker em Go (binário único: storage-ioh api | worker | migrate)
web/       interface em Next.js
docs/      contrato da API e plano de implementação
dev/       dados de exemplo para o MinIO local
```

Documentação da API: [docs/API.md](docs/API.md) e [docs/API-BACKUPS.md](docs/API-BACKUPS.md).
