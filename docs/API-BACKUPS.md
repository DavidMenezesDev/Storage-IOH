# Storage-IOH — Módulo de Backups ERP (API v1, extensão)

Complementa [API.md](API.md). Mesmas convenções: base `/api`, JSON, datas ISO-8601 UTC, erros `{"error": "..."}`.

## Conceito

Uma empresa de ERP guarda os backups dos bancos de dados dos seus clientes em object storage.
Cada **cliente** aponta para um local: `conexão + bucket + prefixo` (ex.: `backups-erp` / `clientes/12345678000199/`).
O sistema varre esse local periodicamente, guarda o histórico de backups e calcula um **status de saúde**
conforme a **política** do cliente. Mudanças de status geram **alertas** (webhook/e-mail).
Clientes podem enviar backups direto para o sistema com um **token de envio** (sem receber credenciais S3).
Backups podem ser baixados ou compartilhados por **link temporário**. Tudo que toca backup fica na **auditoria** (LGPD).

## Papéis

| Papel | Pode |
|---|---|
| `viewer` (Leitura) | ver painéis, clientes, status, listas de backups e alertas. **Não** acessa conteúdo de arquivos |
| `operator` (Suporte) | tudo de viewer + baixar/visualizar arquivos, criar links de compartilhamento, disparar varredura, enviar arquivos |
| `admin` | tudo + CRUD de clientes, conexões, canais de alerta, usuários; excluir/renomear objetos; aplicar retenção; gerar tokens; ver auditoria |

Rota sem permissão → `403 {"error":"permissão insuficiente"}`.
Rotas existentes de API.md: leitura (GET de listagem/meta/busca/stats) = viewer; `object/content` e `object/thumb` = operator;
upload/pasta = operator; delete/rename e CRUD de conexões = admin.

## Tipos

```ts
type Role = "admin" | "operator" | "viewer";
type ClientStatus = "ok" | "late" | "suspicious" | "missing" | "error" | "pending" | "inactive";
// ok: backup recente e saudável | late: último backup mais antigo que (expectedEveryHours + graceHours)
// suspicious: último backup menor que minSizeBytes ou caiu mais que sizeDropPct% vs. média dos 7 anteriores
// missing: nenhum backup encontrado após a janela esperada | error: falha ao varrer o local (credencial, bucket...)
// pending: cliente novo, ainda dentro da primeira janela / ainda não varrido | inactive: cliente desativado

interface User { id: string; email: string; name: string; role: Role; active: boolean; createdAt: string; lastLoginAt: string | null }
// GET /auth/me agora retorna {user: User}

interface Policy {
  expectedEveryHours: number;  // padrão 24
  graceHours: number;          // padrão 6
  minSizeBytes: number;        // padrão 1024
  sizeDropPct: number;         // padrão 50 (0 = desliga)
  filePattern: string;         // globs separados por vírgula, sobre o NOME do arquivo, case-insensitive. padrão "*"
  retentionDays: number;       // 0 = manter tudo
  retentionMinKeep: number;    // sempre manter os N mais recentes (mín. 1, padrão 7)
  retentionAuto: boolean;      // aplica retenção automaticamente após cada varredura (padrão false)
}

interface Client {
  id: string; name: string; document: string;        // CNPJ/CPF (só dígitos)
  contactName: string; contactEmail: string; contactPhone: string; notes: string; tags: string[];
  active: boolean;
  connectionId: string; connectionName: string; bucket: string; prefix: string;   // prefix termina com "/" ou é ""
  policy: Policy;
  status: ClientStatus; statusReason: string; statusChangedAt: string | null;
  lastBackupAt: string | null; lastBackupKey: string | null; lastBackupSize: number | null;
  backupCount: number; totalBytes: number;
  lastScanAt: string | null; lastScanError: string | null;
  ingestTokenPrefix: string | null;   // primeiros 8 chars do token ativo, p/ identificação; null = sem token
  createdAt: string; updatedAt: string;
}

interface ClientInput {   // POST: name, connectionId, bucket obrigatórios; PATCH: tudo opcional
  name?: string; document?: string; contactName?: string; contactEmail?: string; contactPhone?: string;
  notes?: string; tags?: string[]; active?: boolean;
  connectionId?: string; bucket?: string; prefix?: string;
  policy?: Partial<Policy>;
}

interface Backup { key: string; name: string; size: number; lastModified: string; etag: string }

interface ShareLink {
  id: string; clientId: string; key: string; url: string;   // url absoluta
  expiresAt: string; maxDownloads: number | null; downloads: number;
  createdBy: string; createdAt: string; revoked: boolean;
}

interface Alert {
  id: string; clientId: string; clientName: string;
  fromStatus: ClientStatus; toStatus: ClientStatus; message: string;
  createdAt: string; delivered: boolean; error: string | null;
}

interface AlertChannel {
  id: string; type: "webhook" | "email"; name: string;
  target: string;            // webhook: URL; email: lista separada por vírgula
  onlyProblems: boolean;     // true = não avisa quando volta para "ok"
  enabled: boolean; createdAt: string;
}

interface AuditEntry {
  id: string; at: string; userEmail: string | null; action: string;
  clientId: string | null; clientName: string | null;
  connectionId: string | null; bucket: string | null; key: string | null;
  detail: Record<string, unknown>; ip: string;
}
```

Ações de auditoria: `login`, `login.failed`, `object.download`, `object.upload`, `object.delete`, `object.rename`,
`backup.download`, `backup.share`, `share.download`, `share.revoke`, `backup.ingest`, `retention.apply`,
`client.create`, `client.update`, `client.delete`, `token.create`, `token.revoke`,
`connection.create`, `connection.update`, `connection.delete`, `user.create`, `user.update`, `user.delete`,
`channel.create`, `channel.update`, `channel.delete`.

## Painel

`GET /backups/overview` (viewer)
```ts
{
  counts: Record<ClientStatus, number>;        // todas as chaves presentes
  totalClients: number; activeClients: number;
  totalBytes: number;                          // soma dos backups de clientes ativos
  last24h: { backups: number; bytes: number };
  attention: Client[];                          // ativos com status late|suspicious|missing|error, piores primeiro (máx 50)
  recent: (Backup & { clientId: string; clientName: string })[];   // 20 backups mais recentes
  daily: { date: string; backups: number; bytes: number; clientsWithBackup: number }[];  // últimos 30 dias
}
```

## Clientes

| Método | Rota | Papel | Corpo / Params | Resposta |
|---|---|---|---|---|
| GET | `/clients` | viewer | `q` (nome/documento/tag), `status` (lista por vírgula), `active` (`true`/`false`) | `{items: Client[]}` |
| GET | `/clients/export.csv` | viewer | mesmos filtros | CSV (`text/csv`) |
| POST | `/clients` | admin | `ClientInput` | `201 Client` (dispara varredura) |
| GET | `/clients/{id}` | viewer | – | `Client` |
| PATCH | `/clients/{id}` | admin | `ClientInput` | `Client` (re-varre se local/política mudou) |
| DELETE | `/clients/{id}` | admin | – | `204` (não apaga arquivos do storage) |
| POST | `/clients/{id}/scan` | operator | – | `202 {enqueued: 1}` |
| GET | `/clients/{id}/backups` | viewer | `page` (1+), `limit` (≤200, padrão 50) | `{items: Backup[], total: number, page, limit}` mais recentes primeiro |
| GET | `/clients/{id}/backups/series` | viewer | `days` (padrão 60) | `{points: {date, backups, bytes, lastSize}[]}` por dia |
| GET | `/clients/{id}/backups/download` | operator | `key` | stream do arquivo (`attachment`), aceita `Range`; auditado |
| POST | `/clients/{id}/backups/share` | operator | `{key, expiresHours (1–168, padrão 24), maxDownloads?: number}` | `201 ShareLink` |
| GET | `/clients/{id}/shares` | operator | – | `{items: ShareLink[]}` (inclui expirados dos últimos 30 dias) |
| DELETE | `/shares/{id}` | operator | – | `204` |
| POST | `/clients/{id}/ingest-token` | admin | – | `201 {token: string, prefix: string}` (token só aparece aqui; gera novo e invalida o anterior) |
| DELETE | `/clients/{id}/ingest-token` | admin | – | `204` |
| GET | `/clients/{id}/retention/preview` | viewer | – | `{items: Backup[], totalBytes: number, keep: number}` o que seria apagado |
| POST | `/clients/{id}/retention/apply` | admin | – | `{deleted: number, bytes: number}` |
| GET | `/clients/{id}/alerts` | viewer | `limit` | `{items: Alert[]}` |
| GET | `/clients/{id}/audit` | admin | `limit` | `{items: AuditEntry[]}` |

`key` em download/share deve estar dentro do prefixo do cliente (senão `403`).

## Envio de backups pelo cliente (sem login)

`PUT /ingest/{nome-do-arquivo}` — cabeçalho `Authorization: Bearer <token>`, corpo = bytes do arquivo (stream).
O nome pode conter subpastas (`2026/11/base.bak`); é gravado em `prefix-do-cliente + nome`. Sem `..`.
Resposta `201 {key, size}`. Token inválido → `401`. Cliente inativo → `403`.
Exemplos que a UI deve mostrar (com `<URL>` = origem do app):
```bash
curl -fS -T backup.bak -H "Authorization: Bearer <TOKEN>" "<URL>/api/ingest/backup-$(date +%F).bak"
```
```powershell
Invoke-WebRequest -Method Put -InFile "C:\backup\base.bak" -Headers @{Authorization="Bearer <TOKEN>"} -Uri "<URL>/api/ingest/base-$(Get-Date -Format yyyy-MM-dd).bak"
```

## Link público

`GET /public/share/{token}` — sem login. Faz o download (`attachment`), conta o download e audita.
Expirado/revogado/esgotado → `410 {"error": "..."}`.

## Alertas

| Método | Rota | Papel | Corpo | Resposta |
|---|---|---|---|---|
| GET | `/alerts` | viewer | `limit` (padrão 100) | `{items: Alert[]}` |
| GET | `/alert-channels` | admin | – | `{items: AlertChannel[]}` |
| POST | `/alert-channels` | admin | `{type, name, target, onlyProblems?, enabled?}` | `201 AlertChannel` |
| PATCH | `/alert-channels/{id}` | admin | parcial | `AlertChannel` |
| DELETE | `/alert-channels/{id}` | admin | – | `204` |
| POST | `/alert-channels/{id}/test` | admin | – | `{ok: boolean, error?: string}` |

Webhook: `POST` JSON `{text, content, event: "client.status", client: {id, name, document}, fromStatus, toStatus, message, at}`
(`text` serve para Slack/Google Chat/Mattermost; `content` para Discord).
E-mail requer `SMTP_*` no `.env`.

## Usuários, conta e configurações

| Método | Rota | Papel | Corpo | Resposta |
|---|---|---|---|---|
| GET | `/users` | admin | – | `{items: User[]}` |
| POST | `/users` | admin | `{email, name, role, password}` | `201 User` |
| PATCH | `/users/{id}` | admin | `{name?, role?, active?, password?}` | `User` (não pode rebaixar/desativar o último admin) |
| DELETE | `/users/{id}` | admin | – | `204` (não pode apagar a si mesmo) |
| POST | `/auth/password` | qualquer | `{currentPassword, newPassword}` | `204` |
| GET | `/audit` | admin | `action`, `clientId`, `userEmail`, `limit` (≤500, padrão 100), `before` (ISO) | `{items: AuditEntry[]}` |
| GET | `/settings` | viewer | – | `{smtpConfigured: boolean, publicUrl: string, scanIntervalMinutes: number}` |
