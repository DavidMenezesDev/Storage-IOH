"use client";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import type { Connection, SyncRun } from "@/lib/api";
import { formatBytes, formatDateTime, formatNumber, formatRelative } from "@/lib/format";
import { Badge } from "@/components/ui/badge";

function duration(r: SyncRun) {
  if (!r.finishedAt) return "—";
  const s = Math.max(0, (new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime()) / 1000);
  return s < 60 ? `${s.toFixed(1)} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
}

export function SyncStatus({ status }: { status: SyncRun["status"] }) {
  if (status === "running")
    return (
      <Badge tone="info">
        <Loader2 className="animate-spin" /> Em execução
      </Badge>
    );
  if (status === "success")
    return (
      <Badge tone="good">
        <CheckCircle2 /> Concluída
      </Badge>
    );
  return (
    <Badge tone="critical">
      <AlertTriangle /> Falhou
    </Badge>
  );
}

export function SyncRunsTable({ runs, connections }: { runs: SyncRun[]; connections?: Connection[] }) {
  const name = (id: string) => connections?.find((c) => c.id === id)?.name ?? id.slice(0, 8);
  if (runs.length === 0) return <p className="px-5 pb-5 text-sm text-muted-foreground">Nenhuma sincronização registrada ainda.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="px-5 py-2 font-medium">Bucket</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 text-right font-medium">Objetos</th>
            <th className="px-3 py-2 text-right font-medium">Volume</th>
            <th className="px-3 py-2 font-medium">Início</th>
            <th className="px-5 py-2 text-right font-medium">Duração</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id} className="border-b border-border/60 last:border-0">
              <td className="px-5 py-2">
                <div className="font-medium">{r.bucket}</div>
                <div className="text-xs text-muted-foreground">{name(r.connectionId)}</div>
              </td>
              <td className="px-3 py-2">
                <SyncStatus status={r.status} />
                {r.error && (
                  <p className="mt-1 max-w-xs truncate text-xs text-destructive" title={r.error}>
                    {r.error}
                  </p>
                )}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{formatNumber(r.objectsSeen)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatBytes(r.bytesSeen)}</td>
              <td className="px-3 py-2 text-muted-foreground" title={formatDateTime(r.startedAt)}>
                {formatRelative(r.startedAt)}
              </td>
              <td className="px-5 py-2 text-right tabular-nums text-muted-foreground">{duration(r)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
