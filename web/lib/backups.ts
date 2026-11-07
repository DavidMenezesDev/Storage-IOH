// Tipos e endpoints do módulo de Backups ERP — espelha docs/API-BACKUPS.md.
import { api, qs, type Role, type User } from "./api";

export type ClientStatus = "ok" | "late" | "suspicious" | "missing" | "error" | "pending" | "inactive";

export const CLIENT_STATUSES: ClientStatus[] = ["ok", "late", "suspicious", "missing", "error", "pending", "inactive"];

export interface Policy {
  expectedEveryHours: number;
  graceHours: number;
  minSizeBytes: number;
  sizeDropPct: number;
  filePattern: string;
  retentionDays: number;
  retentionMinKeep: number;
  retentionAuto: boolean;
}

export const DEFAULT_POLICY: Policy = {
  expectedEveryHours: 24,
  graceHours: 6,
  minSizeBytes: 1024,
  sizeDropPct: 50,
  filePattern: "*",
  retentionDays: 0,
  retentionMinKeep: 7,
  retentionAuto: false,
};

export interface Client {
  id: string;
  name: string;
  document: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  notes: string;
  tags: string[];
  active: boolean;
  connectionId: string;
  connectionName: string;
  bucket: string;
  prefix: string;
  policy: Policy;
  status: ClientStatus;
  statusReason: string;
  statusChangedAt: string | null;
  lastBackupAt: string | null;
  lastBackupKey: string | null;
  lastBackupSize: number | null;
  backupCount: number;
  totalBytes: number;
  lastScanAt: string | null;
  lastScanError: string | null;
  ingestTokenPrefix: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ClientInput {
  name?: string;
  document?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  notes?: string;
  tags?: string[];
  active?: boolean;
  connectionId?: string;
  bucket?: string;
  prefix?: string;
  policy?: Partial<Policy>;
}

export interface Backup {
  key: string;
  name: string;
  size: number;
  lastModified: string;
  etag: string;
}

export interface ShareLink {
  id: string;
  clientId: string;
  key: string;
  url: string;
  expiresAt: string;
  maxDownloads: number | null;
  downloads: number;
  createdBy: string;
  createdAt: string;
  revoked: boolean;
}

export interface Alert {
  id: string;
  clientId: string;
  clientName: string;
  fromStatus: ClientStatus;
  toStatus: ClientStatus;
  message: string;
  createdAt: string;
  delivered: boolean;
  error: string | null;
}

export type ChannelType = "webhook" | "email";

export interface AlertChannel {
  id: string;
  type: ChannelType;
  name: string;
  target: string;
  onlyProblems: boolean;
  enabled: boolean;
  createdAt: string;
}

export interface AuditEntry {
  id: string;
  at: string;
  userEmail: string | null;
  action: string;
  clientId: string | null;
  clientName: string | null;
  connectionId: string | null;
  bucket: string | null;
  key: string | null;
  detail: Record<string, unknown>;
  ip: string;
}

export interface BackupsOverview {
  counts: Record<ClientStatus, number>;
  totalClients: number;
  activeClients: number;
  totalBytes: number;
  last24h: { backups: number; bytes: number };
  attention: Client[];
  recent: (Backup & { clientId: string; clientName: string })[];
  daily: { date: string; backups: number; bytes: number; clientsWithBackup: number }[];
}

export interface Settings {
  smtpConfigured: boolean;
  publicUrl: string;
  scanIntervalMinutes: number;
}

export interface ClientFilters {
  q?: string;
  status?: string;
  active?: string;
}

const enc = encodeURIComponent;

export function clientDownloadUrl(clientId: string, key: string) {
  return `/api/clients/${enc(clientId)}/backups/download${qs({ key })}`;
}

export function clientsCsvUrl(filters: ClientFilters) {
  return `/api/clients/export.csv${qs({ ...filters })}`;
}

export const backupsApi = {
  overview: () => api<BackupsOverview>("/backups/overview"),
  settings: () => api<Settings>("/settings"),

  clients: (filters: ClientFilters = {}) => api<{ items: Client[] }>("/clients", { query: { ...filters } }),
  client: (id: string) => api<Client>(`/clients/${enc(id)}`),
  createClient: (input: ClientInput) => api<Client>("/clients", { method: "POST", json: input }),
  updateClient: (id: string, input: ClientInput) => api<Client>(`/clients/${enc(id)}`, { method: "PATCH", json: input }),
  deleteClient: (id: string) => api<void>(`/clients/${enc(id)}`, { method: "DELETE" }),
  scan: (id: string) => api<{ enqueued: number }>(`/clients/${enc(id)}/scan`, { method: "POST" }),

  backups: (id: string, page = 1, limit = 50) =>
    api<{ items: Backup[]; total: number; page: number; limit: number }>(`/clients/${enc(id)}/backups`, { query: { page, limit } }),
  series: (id: string, days = 60) =>
    api<{ points: { date: string; backups: number; bytes: number; lastSize: number }[] }>(`/clients/${enc(id)}/backups/series`, {
      query: { days },
    }),
  share: (id: string, body: { key: string; expiresHours: number; maxDownloads?: number }) =>
    api<ShareLink>(`/clients/${enc(id)}/backups/share`, { method: "POST", json: body }),
  shares: (id: string) => api<{ items: ShareLink[] }>(`/clients/${enc(id)}/shares`),
  revokeShare: (shareId: string) => api<void>(`/shares/${enc(shareId)}`, { method: "DELETE" }),

  createToken: (id: string) => api<{ token: string; prefix: string }>(`/clients/${enc(id)}/ingest-token`, { method: "POST" }),
  revokeToken: (id: string) => api<void>(`/clients/${enc(id)}/ingest-token`, { method: "DELETE" }),

  retentionPreview: (id: string) => api<{ items: Backup[]; totalBytes: number; keep: number }>(`/clients/${enc(id)}/retention/preview`),
  retentionApply: (id: string) => api<{ deleted: number; bytes: number }>(`/clients/${enc(id)}/retention/apply`, { method: "POST" }),

  clientAlerts: (id: string, limit = 100) => api<{ items: Alert[] }>(`/clients/${enc(id)}/alerts`, { query: { limit } }),
  clientAudit: (id: string, limit = 100) => api<{ items: AuditEntry[] }>(`/clients/${enc(id)}/audit`, { query: { limit } }),

  alerts: (limit = 100) => api<{ items: Alert[] }>("/alerts", { query: { limit } }),
  channels: () => api<{ items: AlertChannel[] }>("/alert-channels"),
  createChannel: (body: Omit<AlertChannel, "id" | "createdAt">) => api<AlertChannel>("/alert-channels", { method: "POST", json: body }),
  updateChannel: (id: string, body: Partial<Omit<AlertChannel, "id" | "createdAt">>) =>
    api<AlertChannel>(`/alert-channels/${enc(id)}`, { method: "PATCH", json: body }),
  deleteChannel: (id: string) => api<void>(`/alert-channels/${enc(id)}`, { method: "DELETE" }),
  testChannel: (id: string) => api<{ ok: boolean; error?: string }>(`/alert-channels/${enc(id)}/test`, { method: "POST" }),

  users: () => api<{ items: User[] }>("/users"),
  createUser: (body: { email: string; name: string; role: Role; password: string }) => api<User>("/users", { method: "POST", json: body }),
  updateUser: (id: string, body: { name?: string; role?: Role; active?: boolean; password?: string }) =>
    api<User>(`/users/${enc(id)}`, { method: "PATCH", json: body }),
  deleteUser: (id: string) => api<void>(`/users/${enc(id)}`, { method: "DELETE" }),
  changePassword: (currentPassword: string, newPassword: string) =>
    api<void>("/auth/password", { method: "POST", json: { currentPassword, newPassword } }),

  audit: (params: { action?: string; clientId?: string; userEmail?: string; limit?: number; before?: string }) =>
    api<{ items: AuditEntry[] }>("/audit", { query: params }),
};
