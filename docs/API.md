# Storage-IOH — Contrato da API v1

Base: `/api`. JSON em UTF-8. Datas em ISO-8601 (UTC). Autenticação por cookie httpOnly `ioh_session`.
Erros: status HTTP != 2xx com corpo `{"error": "mensagem"}`. Rotas sem sessão → `401`.

## Tipos

```ts
type Provider = "s3" | "r2" | "minio" | "custom";
type Category = "image" | "video" | "audio" | "document" | "code" | "archive" | "other";

interface User { id: string; email: string }

interface Connection {
  id: string; name: string; provider: Provider;
  endpoint: string;            // vazio para AWS S3
  region: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  hasSecret: boolean;          // secret nunca é retornada
  indexEnabled: boolean;
  syncIntervalMinutes: number; // 0 = só manual
  lastSyncAt: string | null;
  createdAt: string; updatedAt: string;
}

interface ConnectionInput {    // POST; no PATCH todos opcionais
  name: string; provider: Provider; endpoint?: string; region?: string;
  forcePathStyle?: boolean; accessKeyId: string; secretAccessKey: string;
  indexEnabled?: boolean; syncIntervalMinutes?: number;
}

interface Bucket {
  name: string; createdAt: string | null;
  objectCount: number | null; totalBytes: number | null; lastSyncedAt: string | null;
}

interface Folder { name: string; prefix: string }   // prefix termina com "/"

interface ObjectItem {
  key: string; name: string; size: number; lastModified: string;
  etag: string; category: Category; ext: string;    // ext minúsculo, sem ponto
  contentType?: string;
}

interface ObjectMeta extends ObjectItem { contentType: string; metadata: Record<string, string> }

interface SearchHit extends ObjectItem { connectionId: string; connectionName: string; bucket: string }

interface SyncRun {
  id: string; connectionId: string; bucket: string;
  status: "running" | "success" | "failed";
  startedAt: string; finishedAt: string | null;
  objectsSeen: number; bytesSeen: number; error: string | null;
}
```

## Auth
| Método | Rota | Corpo | Resposta |
|---|---|---|---|
| POST | `/auth/login` | `{email, password}` | `{user: User}` + cookie |
| POST | `/auth/logout` | – | `204` |
| GET | `/auth/me` | – | `{user: User}` |

## Conexões
| Método | Rota | Corpo | Resposta |
|---|---|---|---|
| GET | `/connections` | – | `{items: Connection[]}` |
| POST | `/connections` | `ConnectionInput` | `201 Connection` (dispara sync se indexEnabled) |
| GET | `/connections/{id}` | – | `Connection` |
| PATCH | `/connections/{id}` | `Partial<ConnectionInput>` | `Connection` |
| DELETE | `/connections/{id}` | – | `204` (remove docs do índice) |
| POST | `/connections/test` | `ConnectionInput` (ou `{id}` p/ testar salva) | `{ok: boolean, bucketCount: number, error?: string}` |
| POST | `/connections/{id}/sync` | `{bucket?: string}` | `202 {enqueued: number}` |

## Navegação
Prefixo `/connections/{id}/buckets/{bucket}`; `key` sempre em query string (URL-encoded).

| Método | Rota | Parâmetros | Resposta |
|---|---|---|---|
| GET | `/connections/{id}/buckets` | – | `{items: Bucket[]}` |
| GET | `…/objects` | `prefix`, `cursor`, `limit` (≤1000, padrão 200) | `{prefix, folders: Folder[], objects: ObjectItem[], nextCursor: string \| null}` |
| GET | `…/object/meta` | `key` | `ObjectMeta` |
| GET | `…/object/content` | `key`, `download=1` opcional | bytes do objeto; aceita `Range` (206) |
| GET | `…/object/thumb` | `key`, `size` (64–1024, padrão 256) | `image/jpeg`; `404` se não suportado |
| POST | `…/objects/upload` | `prefix`; multipart campo `files` (vários) | `{uploaded: ObjectItem[]}` |
| POST | `…/folders` | `{prefix: "a/b/"}` | `201 {prefix}` |
| POST | `…/objects/delete` | `{keys: string[]}` (chave terminada em `/` apaga recursivo) | `{deleted: number}` |
| POST | `…/objects/rename` | `{from, to}` | `ObjectItem` |

## Busca
`GET /search` — parâmetros: `q`, `connection`, `bucket`, `category`, `ext`, `minSize`, `maxSize`,
`from`, `to` (ISO), `sort` (`name:asc`, `size:desc`, `lastModified:desc`…), `page` (1+), `limit` (≤100, padrão 50).

```ts
{ hits: SearchHit[]; total: number; page: number; limit: number; processingTimeMs: number;
  facets: { bucket: Record<string, number>; category: Record<string, number>; ext: Record<string, number> } }
```

## Dashboard
`GET /stats/overview`
```ts
{ totalBytes: number; objectCount: number; bucketCount: number; connectionCount: number;
  lastSyncAt: string | null;
  byCategory: { category: Category; bytes: number; count: number }[];
  byBucket: { connectionId: string; connectionName: string; bucket: string; bytes: number; count: number }[];
  largest: SearchHit[] }
```
`GET /stats/history?days=30` → `{points: {date: "YYYY-MM-DD", bytes: number, count: number}[]}`

`GET /sync-runs?connection=&limit=` → `{items: SyncRun[]}`

## Saúde
`GET /healthz` (vivo) e `GET /readyz` (dependências OK) — fora de `/api`, na porta da API.
