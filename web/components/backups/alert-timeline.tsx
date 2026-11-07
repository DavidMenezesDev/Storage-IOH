"use client";
import Link from "next/link";
import { ArrowRight, CheckCircle2, XCircle } from "lucide-react";
import type { Alert } from "@/lib/backups";
import { formatDateTime, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { STATUS_META, StatusBadge } from "./status";

export function AlertTimeline({ alerts, showClient = true }: { alerts: Alert[]; showClient?: boolean }) {
  if (alerts.length === 0) return <p className="px-5 py-6 text-sm text-muted-foreground">Nenhum alerta registrado.</p>;
  return (
    <ol className="relative px-5 py-2">
      {alerts.map((a, i) => {
        const m = STATUS_META[a.toStatus] ?? STATUS_META.pending;
        const Icon = m.icon;
        return (
          <li key={a.id} className="relative flex gap-3 pb-5 last:pb-1">
            {i < alerts.length - 1 && <span className="absolute bottom-0 left-[13px] top-7 w-px bg-border" aria-hidden />}
            <span className={cn("relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full", m.bg, m.text)}>
              <Icon className="h-3.5 w-3.5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-1.5 text-sm">
                {showClient && (
                  <Link href={`/clients/${a.clientId}`} className="font-medium hover:underline">
                    {a.clientName}
                  </Link>
                )}
                <StatusBadge status={a.fromStatus} />
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" aria-label="para" />
                <StatusBadge status={a.toStatus} />
                <span className="ml-auto text-xs text-muted-foreground" title={formatDateTime(a.createdAt)}>
                  {formatRelative(a.createdAt)}
                </span>
              </div>
              {a.message && <p className="text-sm text-muted-foreground">{a.message}</p>}
              <p className="flex items-start gap-1 text-xs text-muted-foreground">
                {a.delivered ? (
                  <>
                    <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-good" aria-hidden /> Notificação enviada
                  </>
                ) : a.error ? (
                  <>
                    <XCircle className="mt-0.5 h-3 w-3 shrink-0 text-destructive" aria-hidden />
                    <span className="text-destructive">Falha ao notificar: {a.error}</span>
                  </>
                ) : (
                  <>Sem canal de notificação ativo</>
                )}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
