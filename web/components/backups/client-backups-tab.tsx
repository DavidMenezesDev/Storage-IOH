"use client";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Download, FolderOpen, Link2, Share2, XCircle } from "lucide-react";
import { backupsApi, clientDownloadUrl, type Backup, type Client, type ShareLink } from "@/lib/backups";
import { useAuth } from "@/lib/auth";
import { browseHref, parentPrefix } from "@/lib/files";
import { formatBytes, formatDateTime, formatNumber, formatRelative } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Label, Select } from "@/components/ui/input";
import { Skeleton, Spinner } from "@/components/ui/misc";
import { ConfirmDialog } from "@/components/browser/dialogs";
import { BackupSizeChart } from "./charts";
import { CopyField } from "./copy-block";

const PAGE_SIZE = 50;

export function ClientBackupsTab({ client }: { client: Client }) {
  const { canOperate } = useAuth();
  const [page, setPage] = useState(1);
  const [sharing, setSharing] = useState<Backup | null>(null);

  const series = useQuery({ queryKey: ["client", client.id, "series"], queryFn: () => backupsApi.series(client.id, 60) });
  const backups = useQuery({
    queryKey: ["client", client.id, "backups", page],
    queryFn: () => backupsApi.backups(client.id, page, PAGE_SIZE),
    placeholderData: keepPreviousData,
  });

  const total = backups.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Tamanho do backup por dia</CardTitle>
          <CardDescription>Último backup de cada dia, últimos 60 dias. A linha tracejada é o tamanho mínimo da política.</CardDescription>
        </CardHeader>
        <CardContent>
          {series.data ? <BackupSizeChart points={series.data.points} minSize={client.policy.minSizeBytes} /> : <Skeleton className="h-52" />}
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader className="flex-row items-center justify-between gap-3">
          <div className="space-y-1">
            <CardTitle>Backups</CardTitle>
            <CardDescription>
              {formatNumber(total)} arquivo(s) · {formatBytes(client.totalBytes)} no total
            </CardDescription>
          </div>
          {backups.isFetching && <Spinner />}
        </CardHeader>
        {backups.isLoading ? (
          <CardContent>
            <Skeleton className="h-40" />
          </CardContent>
        ) : backups.isError ? (
          <p className="px-5 pb-5 text-sm text-destructive">{(backups.error as Error).message}</p>
        ) : backups.data!.items.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-muted-foreground">
            Nenhum backup encontrado em <span className="font-mono">{client.bucket}/{client.prefix}</span> com o padrão{" "}
            <span className="font-mono">{client.policy.filePattern}</span>.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-border bg-muted/40 text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Arquivo</th>
                  <th className="px-3 py-2 font-medium">Data</th>
                  <th className="px-3 py-2 text-right font-medium">Tamanho</th>
                  <th className="px-4 py-2 text-right font-medium">Ações</th>
                </tr>
              </thead>
              <tbody>
                {backups.data!.items.map((b) => {
                  const small = client.policy.minSizeBytes > 0 && b.size < client.policy.minSizeBytes;
                  return (
                    <tr key={b.key} className="border-b border-border/60 last:border-0">
                      <td className="max-w-md px-4 py-2">
                        <span className="block truncate font-medium" title={b.key}>
                          {b.name}
                        </span>
                        {parentPrefix(b.key) !== client.prefix && (
                          <span className="block truncate text-xs text-muted-foreground">{parentPrefix(b.key)}</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        <span>{formatDateTime(b.lastModified)}</span>
                        <span className="ml-2 text-xs text-muted-foreground">{formatRelative(b.lastModified)}</span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                        {small && (
                          <Badge tone="warning" className="mr-2" title="Abaixo do tamanho mínimo da política">
                            abaixo do mínimo
                          </Badge>
                        )}
                        {formatBytes(b.size)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-1.5 text-right">
                        <div className="inline-flex gap-1">
                          {canOperate && (
                            <>
                              <Button variant="ghost" size="sm" asChild>
                                <a href={clientDownloadUrl(client.id, b.key)} download>
                                  <Download /> Baixar
                                </a>
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => setSharing(b)}>
                                <Share2 /> Compartilhar
                              </Button>
                            </>
                          )}
                          <Button variant="ghost" size="icon-sm" asChild title="Abrir no explorador" aria-label="Abrir no explorador">
                            <Link href={browseHref(client.connectionId, client.bucket, parentPrefix(b.key), { preview: b.key })}>
                              <FolderOpen />
                            </Link>
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {pages > 1 && (
          <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-2 text-xs text-muted-foreground">
            Página {page} de {pages}
            <Button variant="outline" size="icon-sm" onClick={() => setPage((p) => p - 1)} disabled={page <= 1} aria-label="Página anterior">
              <ChevronLeft />
            </Button>
            <Button variant="outline" size="icon-sm" onClick={() => setPage((p) => p + 1)} disabled={page >= pages} aria-label="Próxima página">
              <ChevronRight />
            </Button>
          </div>
        )}
      </Card>

      {canOperate && <SharesCard clientId={client.id} />}

      <ShareDialog clientId={client.id} backup={sharing} onClose={() => setSharing(null)} />
    </div>
  );
}

// ------------------------------------------------------------------ compartilhar

const EXPIRY = [
  { hours: 1, label: "1 hora" },
  { hours: 24, label: "24 horas" },
  { hours: 72, label: "3 dias" },
  { hours: 168, label: "7 dias" },
];

function ShareDialog({ clientId, backup, onClose }: { clientId: string; backup: Backup | null; onClose: () => void }) {
  return (
    <Dialog open={!!backup} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>{backup && <ShareForm clientId={clientId} backup={backup} onClose={onClose} />}</DialogContent>
    </Dialog>
  );
}

function ShareForm({ clientId, backup, onClose }: { clientId: string; backup: Backup; onClose: () => void }) {
  const qc = useQueryClient();
  const [hours, setHours] = useState(24);
  const [max, setMax] = useState("");
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<ShareLink | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const maxN = max ? Math.max(1, Math.floor(Number(max))) : undefined;
      const res = await backupsApi.share(clientId, { key: backup.key, expiresHours: hours, maxDownloads: maxN });
      setLink(res);
      qc.invalidateQueries({ queryKey: ["client", clientId, "shares"] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Compartilhar backup</DialogTitle>
        <DialogDescription>
          Gera um link de download que funciona sem login. <span className="font-medium text-foreground">{backup.name}</span> ({formatBytes(backup.size)})
        </DialogDescription>
      </DialogHeader>
      {link ? (
        <div className="grid gap-3">
          <Label>Link de download</Label>
          <CopyField value={link.url} label="Link de download" />
          <p className="text-xs text-muted-foreground">
            Válido até {formatDateTime(link.expiresAt)}
            {link.maxDownloads ? ` · até ${link.maxDownloads} download(s)` : ""}. Os downloads ficam registrados na auditoria.
          </p>
          <DialogFooter>
            <Button onClick={onClose}>Concluir</Button>
          </DialogFooter>
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="share-exp">Validade</Label>
              <Select id="share-exp" value={hours} onChange={(e) => setHours(Number(e.target.value))}>
                {EXPIRY.map((x) => (
                  <option key={x.hours} value={x.hours}>
                    {x.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="share-max">Máximo de downloads</Label>
              <Input id="share-max" type="number" min={1} placeholder="Sem limite" value={max} onChange={(e) => setMax(e.target.value)} />
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button onClick={create} disabled={busy}>
              {busy ? <Spinner className="text-primary-foreground" /> : <Link2 />} Gerar link
            </Button>
          </DialogFooter>
        </>
      )}
    </div>
  );
}

function shareState(s: ShareLink): { label: string; tone: "good" | "neutral" | "warning" | "critical" } {
  if (s.revoked) return { label: "Revogado", tone: "critical" };
  if (new Date(s.expiresAt).getTime() < Date.now()) return { label: "Expirado", tone: "neutral" };
  if (s.maxDownloads != null && s.downloads >= s.maxDownloads) return { label: "Esgotado", tone: "warning" };
  return { label: "Ativo", tone: "good" };
}

function SharesCard({ clientId }: { clientId: string }) {
  const qc = useQueryClient();
  const shares = useQuery({ queryKey: ["client", clientId, "shares"], queryFn: () => backupsApi.shares(clientId) });
  const [revoking, setRevoking] = useState<ShareLink | null>(null);

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>Links de compartilhamento</CardTitle>
        <CardDescription>Links ativos e os expirados nos últimos 30 dias.</CardDescription>
      </CardHeader>
      {shares.isLoading ? (
        <CardContent>
          <Skeleton className="h-16" />
        </CardContent>
      ) : !shares.data || shares.data.items.length === 0 ? (
        <p className="px-5 pb-5 text-sm text-muted-foreground">Nenhum link criado.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-border bg-muted/40 text-left text-xs text-muted-foreground">
                <th className="px-4 py-2 font-medium">Arquivo</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Downloads</th>
                <th className="px-3 py-2 font-medium">Expira</th>
                <th className="px-3 py-2 font-medium">Criado por</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {shares.data.items.map((s) => {
                const st = shareState(s);
                return (
                  <tr key={s.id} className="border-b border-border/60 last:border-0">
                    <td className="max-w-xs px-4 py-2">
                      <span className="block truncate font-mono text-xs" title={s.key}>
                        {s.key.split("/").pop()}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {s.downloads}
                      {s.maxDownloads != null && <span className="text-muted-foreground"> / {s.maxDownloads}</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2" title={formatDateTime(s.expiresAt)}>
                      {formatRelative(s.expiresAt)}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {s.createdBy}
                      <br />
                      {formatDateTime(s.createdAt)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-1.5 text-right">
                      {st.label === "Ativo" && (
                        <div className="inline-flex gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => navigator.clipboard?.writeText(s.url).then(() => toast.success("Link copiado"))}
                          >
                            <Link2 /> Copiar
                          </Button>
                          <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setRevoking(s)}>
                            <XCircle /> Revogar
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <ConfirmDialog
        open={!!revoking}
        onOpenChange={(o) => !o && setRevoking(null)}
        title="Revogar link?"
        description="O link deixa de funcionar imediatamente."
        confirmLabel="Revogar"
        destructive
        onConfirm={async () => {
          if (!revoking) return;
          try {
            await backupsApi.revokeShare(revoking.id);
            toast.success("Link revogado");
            qc.invalidateQueries({ queryKey: ["client", clientId, "shares"] });
          } catch (e) {
            toast.error((e as Error).message);
          }
        }}
      />
    </Card>
  );
}
