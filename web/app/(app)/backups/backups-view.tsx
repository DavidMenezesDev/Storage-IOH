"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Building2, Plus } from "lucide-react";
import { backupsApi, type ClientStatus } from "@/lib/backups";
import { useAuth } from "@/lib/auth";
import { formatDocument } from "@/lib/document";
import { formatBytes, formatDateTime, formatNumber, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, Skeleton, Spinner } from "@/components/ui/misc";
import { DailyActivityChart } from "@/components/backups/charts";
import { STATUS_META, StatusBadge } from "@/components/backups/status";

const TILE_ORDER: ClientStatus[] = ["ok", "late", "suspicious", "missing", "error", "pending", "inactive"];

export function BackupsView() {
  const { isAdmin } = useAuth();
  const q = useQuery({ queryKey: ["backups", "overview"], queryFn: backupsApi.overview, refetchInterval: 60_000 });
  const o = q.data;

  if (o && o.totalClients === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <Card className="max-w-md">
          <EmptyState
            icon={<Building2 />}
            title="Nenhum cliente cadastrado"
            description="Cadastre seus clientes de ERP e aponte onde ficam os backups de cada um. O Storage-IOH passa a monitorar se chegam no prazo e com tamanho esperado."
            action={
              isAdmin ? (
                <Button asChild>
                  <Link href="/clients/new">
                    <Plus /> Cadastrar cliente
                  </Link>
                </Button>
              ) : undefined
            }
          />
        </Card>
      </div>
    );
  }

  const problems = o ? o.counts.late + o.counts.suspicious + o.counts.missing + o.counts.error : 0;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1">
            <h1 className="text-xl font-semibold tracking-tight">Painel de backups</h1>
            <p className="text-sm text-muted-foreground">
              {o
                ? problems === 0
                  ? "Todos os clientes ativos estão em dia."
                  : `${formatNumber(problems)} cliente(s) precisam de atenção.`
                : "Carregando…"}
              {q.isFetching && <Spinner className="ml-2 inline h-3 w-3" />}
            </p>
          </div>
          <p className="text-xs text-muted-foreground">Atualiza a cada 60 s</p>
        </div>

        {q.isError && (
          <Card className="border-destructive/40">
            <CardContent className="pt-5 text-sm text-destructive">Erro ao carregar o painel: {(q.error as Error).message}</CardContent>
          </Card>
        )}

        {/* Contadores por status */}
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7" aria-label="Clientes por status">
          {TILE_ORDER.map((s) => {
            const m = STATUS_META[s];
            const Icon = m.icon;
            const n = o?.counts[s] ?? null;
            return (
              <li key={s}>
                <Link
                  href={`/clients?status=${s}`}
                  className={cn(
                    "flex h-full flex-col gap-2 rounded-xl border bg-surface p-4 shadow-xs transition-colors hover:bg-muted/50",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    n ? m.border : "border-border",
                  )}
                >
                  <span className={cn("flex items-center gap-1.5 text-xs font-medium", n ? m.text : "text-muted-foreground")}>
                    <span className={cn("flex h-6 w-6 items-center justify-center rounded-md", n ? m.bg : "bg-muted")}>
                      <Icon className="h-3.5 w-3.5" aria-hidden />
                    </span>
                    {m.label}
                  </span>
                  {n === null ? (
                    <Skeleton className="h-8 w-12" />
                  ) : (
                    <span className={cn("text-3xl font-semibold tabular-nums tracking-tight", n === 0 && "text-muted-foreground/70")}>{formatNumber(n)}</span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>

        {/* Totais */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Total label="Clientes ativos" value={o ? `${formatNumber(o.activeClients)} de ${formatNumber(o.totalClients)}` : null} />
          <Total label="Volume total de backups" value={o ? formatBytes(o.totalBytes) : null} />
          <Total
            label="Recebidos nas últimas 24 h"
            value={o ? `${formatNumber(o.last24h.backups)} arquivo(s)` : null}
            hint={o ? formatBytes(o.last24h.bytes) : undefined}
          />
        </div>

        <Card>
          <CardHeader className="flex-row items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle>Precisa de atenção</CardTitle>
              <CardDescription>Clientes ativos atrasados, suspeitos, sem backup ou com erro — piores primeiro</CardDescription>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/clients?status=late,suspicious,missing,error">Ver todos</Link>
            </Button>
          </CardHeader>
          {!o ? (
            <CardContent>
              <Skeleton className="h-32" />
            </CardContent>
          ) : o.attention.length === 0 ? (
            <p className="px-5 pb-5 text-sm text-muted-foreground">Nenhum problema no momento.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="px-5 py-2 font-medium">Cliente</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Motivo</th>
                    <th className="px-3 py-2 font-medium">Último backup</th>
                    <th className="px-3 py-2 text-right font-medium">Tamanho</th>
                    <th className="px-5 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {o.attention.map((c) => (
                    <tr key={c.id} className="border-b border-border/60 last:border-0">
                      <td className="px-5 py-2">
                        <Link href={`/clients/${c.id}`} className="font-medium hover:underline">
                          {c.name}
                        </Link>
                        {c.document && <div className="text-xs text-muted-foreground">{formatDocument(c.document)}</div>}
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge status={c.status} reason={c.statusReason} />
                      </td>
                      <td className="max-w-xs px-3 py-2 text-xs text-muted-foreground">
                        <span className="line-clamp-2" title={c.statusReason}>
                          {c.statusReason || "—"}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2" title={formatDateTime(c.lastBackupAt)}>
                        {c.lastBackupAt ? formatRelative(c.lastBackupAt) : "nunca"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatBytes(c.lastBackupSize)}</td>
                      <td className="px-5 py-2 text-right">
                        <Button variant="outline" size="sm" asChild>
                          <Link href={`/clients/${c.id}`}>Ver</Link>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="grid gap-6 lg:grid-cols-5">
          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle>Atividade diária</CardTitle>
              <CardDescription>Backups recebidos e clientes com backup por dia, últimos 30 dias</CardDescription>
            </CardHeader>
            <CardContent>{o ? <DailyActivityChart points={o.daily} /> : <Skeleton className="h-56" />}</CardContent>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Backups recentes</CardTitle>
              <CardDescription>Os 20 arquivos mais novos de todos os clientes</CardDescription>
            </CardHeader>
            {!o ? (
              <CardContent>
                <Skeleton className="h-56" />
              </CardContent>
            ) : o.recent.length === 0 ? (
              <p className="px-5 pb-5 text-sm text-muted-foreground">Nenhum backup ainda.</p>
            ) : (
              <ol className="max-h-80 overflow-y-auto pb-2">
                {o.recent.map((b) => (
                  <li key={`${b.clientId}/${b.key}`}>
                    <Link href={`/clients/${b.clientId}`} className="flex items-center gap-3 px-5 py-2 hover:bg-muted/60">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{b.clientName}</span>
                        <span className="block truncate text-xs text-muted-foreground" title={b.key}>
                          {b.name}
                        </span>
                      </span>
                      <span className="text-right">
                        <span className="block text-sm tabular-nums">{formatBytes(b.size)}</span>
                        <span className="block text-xs text-muted-foreground" title={formatDateTime(b.lastModified)}>
                          {formatRelative(b.lastModified)}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function Total({ label, value, hint }: { label: string; value: string | null; hint?: string }) {
  return (
    <Card className="p-5">
      <p className="text-xs text-muted-foreground">{label}</p>
      {value === null ? <Skeleton className="mt-2 h-7 w-28" /> : <p className="mt-1 text-xl font-semibold tracking-tight tabular-nums">{value}</p>}
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </Card>
  );
}
