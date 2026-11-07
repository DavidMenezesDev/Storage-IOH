import { toast } from "sonner";
// Tipos e cliente da API — espelha docs/API.md.

export type Provider = "s3" | "r2" | "minio" | "custom";
export type Category = "image" | "video" | "audio" | "document" | "code" | "archive" | "other";

export type Role = "admin" | "operator" | "viewer";

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  active: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface Connection {
  id: string;
  name: string;
  provider: Provider;
  endpoint: string;
  region: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  hasSecret: boolean;
  indexEnabled: boolean;
  syncIntervalMinutes: number;
  lastSyncAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectionInput {
  name: string;
  provider: Provider;
  endpoint?: string;
  region?: string;
  forcePathStyle?: boolean;
  accessKeyId: string;
  secretAccessKey: string;
  indexEnabled?: boolean;
  syncIntervalMinutes?: number;
}

export interface Bucket {
  name: string;
  createdAt: string | null;
  objectCount: number | null;
  totalBytes: number | null;
  lastSyncedAt: string | null;
}

export interface Folder { name: string; prefix: string }

export interface ObjectItem {
  key: string;
  name: string;
  size: number;
  lastModified: string;
  etag: string;
  category: Category;
  ext: string;
  contentType?: string;
}

export interface ObjectMeta extends ObjectItem {
  contentType: string;
  metadata: Record<string, string>;
}

export interface SearchHit extends ObjectItem {
  connectionId: string;
  connectionName: string;
  bucket: string;
}

export interface SyncRun {
  id: string;
  connectionId: string;
  bucket: string;
  status: "running" | "success" | "failed";
  startedAt: string;
  finishedAt: string | null;
  objectsSeen: number;
  bytesSeen: number;
  error: string | null;
}

export interface ObjectList {
  prefix: string;
  folders: Folder[];
  objects: ObjectItem[];
  nextCursor: string | null;
}

export interface SearchResult {
  hits: SearchHit[];
  total: number;
  page: number;
  limit: number;
  processingTimeMs: number;
  facets: {
    bucket: Record<string, number>;
    category: Record<string, number>;
    ext: Record<string, number>;
  };
}

export interface StatsOverview {
  totalBytes: number;
  objectCount: number;
  bucketCount: number;
  connectionCount: number;
  lastSyncAt: string | null;
  byCategory: { category: Category; bytes: number; count: number }[];
  byBucket: { connectionId: string; connectionName: string; bucket: string; bytes: number; count: number }[];
  largest: SearchHit[];
}

export interface StatsHistory { points: { date: string; bytes: number; count: number }[] }

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function redirectToLogin() {
  if (typeof window === "undefined") return;
  if (window.location.pathname.startsWith("/login")) return;
  const next = encodeURIComponent(window.location.pathname + window.location.search);
  // Fora da árvore React (cliente HTTP): recarga completa é intencional para limpar o estado.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.href = `/login?next=${next}`;
}

/** 403 → aviso único (id fixo evita toasts empilhados). */
export function notifyForbidden() {
  if (typeof window === "undefined") return;
  toast.error("Permissão insuficiente", { id: "forbidden" });
}

type Query = Record<string, string | number | boolean | null | undefined>;

export function qs(params: Query): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export async function api<T>(
  path: string,
  init: RequestInit & { json?: unknown; query?: Query; skipAuthRedirect?: boolean } = {},
): Promise<T> {
  const { json, query, skipAuthRedirect, headers, ...rest } = init;
  const res = await fetch(`/api${path}${query ? qs(query) : ""}`, {
    credentials: "same-origin",
    ...rest,
    headers: {
      ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
      Accept: "application/json",
      ...headers,
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (res.status === 401 && !skipAuthRedirect) {
    redirectToLogin();
    throw new ApiError(401, "Sessão expirada");
  }
  if (!res.ok) {
    let msg = `Erro ${res.status}`;
    if (res.status === 403) notifyForbidden();
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch {
      /* corpo não-JSON */
    }
    throw new ApiError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

const enc = encodeURIComponent;

export function bucketBase(connectionId: string, bucket: string) {
  return `/connections/${enc(connectionId)}/buckets/${enc(bucket)}`;
}

export function contentUrl(connectionId: string, bucket: string, key: string, download = false) {
  return `/api${bucketBase(connectionId, bucket)}/object/content${qs({ key, download: download ? 1 : undefined })}`;
}

export function thumbUrl(connectionId: string, bucket: string, key: string, size = 256) {
  return `/api${bucketBase(connectionId, bucket)}/object/thumb${qs({ key, size })}`;
}

export const endpoints = {
  me: () => api<{ user: User }>("/auth/me", { skipAuthRedirect: true }),
  login: (email: string, password: string) =>
    api<{ user: User }>("/auth/login", { method: "POST", json: { email, password }, skipAuthRedirect: true }),
  logout: () => api<void>("/auth/logout", { method: "POST" }),

  connections: () => api<{ items: Connection[] }>("/connections"),
  createConnection: (input: ConnectionInput) => api<Connection>("/connections", { method: "POST", json: input }),
  updateConnection: (id: string, input: Partial<ConnectionInput>) =>
    api<Connection>(`/connections/${enc(id)}`, { method: "PATCH", json: input }),
  deleteConnection: (id: string) => api<void>(`/connections/${enc(id)}`, { method: "DELETE" }),
  testConnection: (input: Partial<ConnectionInput> & { id?: string }) =>
    api<{ ok: boolean; bucketCount: number; error?: string }>("/connections/test", { method: "POST", json: input }),
  syncConnection: (id: string, bucket?: string) =>
    api<{ enqueued: number }>(`/connections/${enc(id)}/sync`, { method: "POST", json: bucket ? { bucket } : {} }),

  buckets: (id: string) => api<{ items: Bucket[] }>(`/connections/${enc(id)}/buckets`),
  objects: (id: string, bucket: string, prefix: string, cursor?: string | null, limit = 200) =>
    api<ObjectList>(`${bucketBase(id, bucket)}/objects`, { query: { prefix, cursor, limit } }),
  meta: (id: string, bucket: string, key: string) =>
    api<ObjectMeta>(`${bucketBase(id, bucket)}/object/meta`, { query: { key } }),
  createFolder: (id: string, bucket: string, prefix: string) =>
    api<{ prefix: string }>(`${bucketBase(id, bucket)}/folders`, { method: "POST", json: { prefix } }),
  deleteObjects: (id: string, bucket: string, keys: string[]) =>
    api<{ deleted: number }>(`${bucketBase(id, bucket)}/objects/delete`, { method: "POST", json: { keys } }),
  renameObject: (id: string, bucket: string, from: string, to: string) =>
    api<ObjectItem>(`${bucketBase(id, bucket)}/objects/rename`, { method: "POST", json: { from, to } }),

  search: (params: Query) => api<SearchResult>("/search", { query: params }),
  statsOverview: () => api<StatsOverview>("/stats/overview"),
  statsHistory: (days = 30) => api<StatsHistory>("/stats/history", { query: { days } }),
  syncRuns: (connection?: string, limit = 20) =>
    api<{ items: SyncRun[] }>("/sync-runs", { query: { connection, limit } }),
};

/** Upload com progresso via XHR (fetch não expõe progresso de envio). */
export function uploadFiles(
  connectionId: string,
  bucket: string,
  prefix: string,
  files: File[],
  onProgress: (fraction: number) => void,
): { promise: Promise<{ uploaded: ObjectItem[] }>; abort: () => void } {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<{ uploaded: ObjectItem[] }>((resolve, reject) => {
    const form = new FormData();
    // Em upload de pasta, o nome do arquivo carrega o caminho relativo ("pasta/sub/a.txt").
    for (const f of files) form.append("files", f, f.webkitRelativePath || f.name);
    xhr.open("POST", `/api${bucketBase(connectionId, bucket)}/objects/upload${qs({ prefix })}`);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status === 401) {
        redirectToLogin();
        reject(new ApiError(401, "Sessão expirada"));
        return;
      }
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* ignore */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as { uploaded: ObjectItem[] });
      else reject(new ApiError(xhr.status, (body as { error?: string } | null)?.error ?? `Erro ${xhr.status}`));
    };
    xhr.onerror = () => reject(new ApiError(0, "Falha de rede no upload"));
    xhr.onabort = () => reject(new ApiError(0, "Upload cancelado"));
    xhr.send(form);
  });
  return { promise, abort: () => xhr.abort() };
}
