"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Eraser, TriangleAlert } from "lucide-react";
import { backupsApi, type Client } from "@/lib/backups";
import { useAuth } from "@/lib/auth";
import { formatBytes, formatDateTime, formatNumber } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/misc";
import { ConfirmDialog } from "@/components/browser/dialogs";

export function ClientRetentionTab({ client }: { client: Client }) {
  const qc = useQueryClient();
  const { isAdmin } = useAuth();
  const [confirm, setConfirm] = useState(false);
  const p = client.policy;
  const preview = useQuery({ queryKey: ["client", client.id, "retention"], queryFn: () => backupsApi.retentionPreview(client.id) });
  const items = preview.data?.items ?? [];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Política de retenção</CardTitle>
          <CardDescription>Configurada no cadastro do cliente.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground">Manter backups por</dt>
              <dd className="font-medium">{p.retentionDays === 0 ? "Para sempre (retenção desligada)" : `${formatNumber(p.retentionDays)} ${p.retentionDays === 1 ? "dia" : "dias"}`}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Sempre manter os mais recentes</dt>
              <dd className="font-medium">{formatNumber(p.retentionMinKeep)} backup(s)</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Aplicação</dt>
              <dd className="font-medium">{p.retentionAuto ? "Automática, após cada varredura" : "Manual"}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle>Prévia</CardTitle>
            <CardDescription>
              {preview.data
                ? items.length === 0
                  ? `Nada a apagar — ${formatNumber(preview.data.keep)} backup(s) mantidos.`
                  : `${formatNumber(items.length)} backup(s) serão apagados (${formatBytes(preview.data.totalBytes)}), ${formatNumber(preview.data.keep)} mantidos.`
                : "Calculando…"}
            </CardDescription>
          </div>
          {isAdmin && (
            <Button variant="destructive" disabled={!items.length} onClick={() => setConfirm(true)}>
              <Eraser /> Aplicar retenção agora
            </Button>
          )}
        </CardHeader>
        {preview.isLoading ? (
          <CardContent>
            <Skeleton className="h-24" />
          </CardContent>
        ) : preview.isError ? (
          <p className="px-5 pb-5 text-sm text-destructive">{(preview.error as Error).message}</p>
        ) : items.length > 0 ? (
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0">
                <tr className="border-y border-border bg-muted text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Arquivo</th>
                  <th className="px-3 py-2 font-medium">Data</th>
                  <th className="px-4 py-2 text-right font-medium">Tamanho</th>
                </tr>
              </thead>
              <tbody>
                {items.map((b) => (
                  <tr key={b.key} className="border-b border-border/60 last:border-0">
                    <td className="max-w-md truncate px-4 py-1.5" title={b.key}>
                      {b.name}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5">{formatDateTime(b.lastModified)}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums">{formatBytes(b.size)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Apagar ${formatNumber(items.length)} backup(s)?`}
        description={
          <span className="flex items-start gap-2">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <span>
              Os arquivos listados ({formatBytes(preview.data?.totalBytes ?? 0)}) serão apagados do storage definitivamente. Os{" "}
              {formatNumber(preview.data?.keep ?? 0)} backup(s) mais recentes/dentro do prazo são mantidos.
            </span>
          </span>
        }
        confirmLabel="Apagar backups"
        destructive
        onConfirm={async () => {
          try {
            const r = await backupsApi.retentionApply(client.id);
            toast.success(`${formatNumber(r.deleted)} backup(s) apagados (${formatBytes(r.bytes)})`);
            qc.invalidateQueries({ queryKey: ["client", client.id] });
            qc.invalidateQueries({ queryKey: ["clients"] });
            qc.invalidateQueries({ queryKey: ["backups"] });
          } catch (e) {
            toast.error((e as Error).message);
          }
        }}
      />
    </div>
  );
}
