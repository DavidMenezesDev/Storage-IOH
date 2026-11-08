# Changelog

Todas as mudanças relevantes do projeto são registradas aqui.
Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/); versões seguem [SemVer](https://semver.org/lang/pt-BR/).

## [Não lançado]

## [0.5.0] — 2026-11-07

Primeira versão pública. O Storage-IOH é uma central de backups dos clientes para empresas de ERP, com um explorador de object storage embutido.

### Backups de clientes

- Cadastro de clientes (CNPJ/CPF, contato, tags) apontando para `conexão / bucket / pasta`.
- Política por cliente: frequência esperada, tolerância, tamanho mínimo, queda de tamanho e padrão de arquivos.
- Status automático: **Em dia**, **Atrasado**, **Suspeito**, **Sem backup**, **Erro**, **Aguardando** e **Inativo**, recalculado a cada `SCAN_INTERVAL_MINUTES`.
- Painel com clientes que precisam de atenção, backups recentes e volume diário; exportação CSV.
- Histórico de backups por cliente, com gráfico dos últimos dias.
- **Token de envio por cliente**: `PUT /api/ingest/...` via `curl` ou PowerShell, sem expor credenciais do storage; revogável.
- Download de backups e **links temporários** com validade e limite de downloads.
- **Retenção** por cliente, com pré-visualização do que seria apagado e mínimo obrigatório de backups mantidos.

### Alertas

- Canais por **webhook** (Slack, Discord, Google Chat, Mattermost, n8n…) e **e-mail** (SMTP).
- Notificação só em mudança de status, incluindo a recuperação, para evitar spam.
- Botão de teste por canal.

### Usuários e auditoria

- Papéis **Administrador**, **Suporte** e **Leitura**.
- Trilha de auditoria de logins, downloads, links, exclusões e alterações (LGPD).
- Troca de senha pelo próprio usuário; proteção contra remover o último administrador.

### Explorador de storage

- Conexões com **AWS S3**, **Cloudflare R2**, **MinIO** e serviços compatíveis, com botão "Testar conexão".
- Credenciais criptografadas em repouso (AES-256-GCM).
- Navegação em **lista**, **galeria** e **colunas**, com miniaturas (vídeo opcional com `WITH_FFMPEG=true`).
- Preview de imagem, vídeo, áudio, PDF, código, Markdown, JSON e CSV, sem sair do app.
- Busca indexada com Meilisearch, incluindo busca global (⌘K / Ctrl+K) e filtros.
- Dashboard de uso por conexão e bucket.
- Upload, nova pasta, renomear e excluir, com o índice atualizado na hora.

### Infraestrutura

- Instalação com Docker Compose: `make up` (produção) e `make dev` (com MinIO e dados de exemplo).
- Backend em Go num binário único (`api`, `worker`, `migrate`), com migrations aplicadas no start.
- Frontend em Next.js, servindo a API pelo mesmo domínio (`/api`).
- Rate limit no login e cookies `Secure` quando atrás de HTTPS.
- CI no GitHub Actions: `gofmt`, `go vet`, `go test`, lint e build do frontend.

### Limitações conhecidas

- Interface apenas em português.
- Sem download em lote (zip).
- Indexação por varredura completa do bucket; mudanças feitas fora do app aparecem na próxima sincronização.
- Imagens Docker ainda não são publicadas em registry; o build é local.

[0.5.0]: https://github.com/<org>/storage-ioh/releases/tag/v0.5.0
