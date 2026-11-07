"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { Plug } from "lucide-react";
import { endpoints } from "@/lib/api";
import { browseHref, parentPrefix } from "@/lib/files";
import { formatBytes, formatDateTime, formatNumber, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { FileIcon } from "@/components/browser/file-icon";
import { SyncRunsTable } from "@/components/common/sync-runs-table";
import { BucketBars, CategoryBreakdown, GrowthChart } from "@/components/dashboard/charts";

const RANGES = [
  { days: 7, label: "7 dias" },
  { days: 30, label: "30 dias" },
  { days: 90, label: "90 dias" },
];

export function DashboardView() {
  const [days, setDays] = useState(30);
  const overview = useQuery({ queryKey: ["stats", "overview"], queryFn: endpoints.statsOverview, refetchInterval: 60_000 });
  const history = useQuery({ queryKey: ["stats", "history", days], queryFn: () => endpoints.statsHistory(days) });
  const conns = useQuery({ queryKey: ["connections"], queryFn: endpoints.connections });
  const runs = useQuery({
    queryKey: ["sync-runs", "dashboard"],
    queryFn: () => endpoints.syncRuns(undefined, 8),
    refetchInterval: (q) => (q.state.data?.items.some((r) => r.status === "running") ? 3000 : 30_000),
  });

  const o = overview.data;

  if (conns.data && conns.data.items.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <Card className="max-w-md">
          <EmptyState
            icon={<Plug />}
            title="Bem-vindo ao Storage-IOH"
            description="Conecte um bucket S3, Cloudflare R2 ou MinIO para ver o dashboard, navegar e buscar seus arquivos."
            action={
              <Button asChild>
                <Link href="/connections?new=1">Adicionar conexão</Link>
              </Button>
            }
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1">
            <h1 className="text-xl font-semibold tracking-tight">Uso do storage</h1>
            <p className="text-sm text-muted-foreground">
              Dados da última indexação {o?.lastSyncAt ? `· ${formatRelative(o.lastSyncAt)}` : ""}
            </p>
          </div>
          <div role="radiogroup" aria-label="Período do histórico" className="flex rounded-md border border-border bg-surface p-0.5">
            {RANGES.map((r) => (
              <button
                key={r.days}
                type="button"
                role="radio"
                aria-checked={days === r.days}
                onClick={() => setDays(r.days)}
                className={cn(
                  "h-7 rounded px-3 text-xs",
                  days === r.days ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {overview.isError && (
          <Card className="border-destructive/40">
            <CardContent className="pt-5 text-sm text-destructive">Erro ao carregar estatísticas: {(overview.error as Error).message}</CardContent>
          </Card>
        )}

        {/* Stat tiles */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat label="Total armazenado" value={o ? formatBytes(o.totalBytes) : null} />
          <Stat label="Objetos" value={o ? formatNumber(o.objectCount) : null} />
          <Stat label="Buckets" value={o ? formatNumber(o.bucketCount) : null} />
          <Stat label="Conexões" value={o ? formatNumber(o.connectionCount) : null} hint={o ? `Última sync ${formatDateTime(o.lastSyncAt)}` : undefined} />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Crescimento do volume</CardTitle>
            <CardDescription>Total armazenado por dia, últimos {days} dias</CardDescription>
          </CardHeader>
          <CardContent>{history.data ? <GrowthChart points={history.data.points} /> : <Skeleton className="h-56" />}</CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Volume por bucket</CardTitle>
              <CardDescription>Os 10 maiores buckets</CardDescription>
            </CardHeader>
            <CardContent>{o ? <BucketBars data={o.byBucket} /> : <Skeleton className="h-64" />}</CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Volume por tipo de arquivo</CardTitle>
              <CardDescription>Participação de cada categoria no total</CardDescription>
            </CardHeader>
            <CardContent>{o ? <CategoryBreakdown data={o.byCategory} /> : <Skeleton className="h-64" />}</CardContent>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Maiores arquivos</CardTitle>
              <CardDescription>Top 10 por tamanho</CardDescription>
            </CardHeader>
            {o ? (
              o.largest.length ? (
                <ol className="pb-2">
                  {o.largest.slice(0, 10).map((h, i) => (
                    <li key={`${h.connectionId}/${h.bucket}/${h.key}`}>
                      <Link
                        href={browseHref(h.connectionId, h.bucket, parentPrefix(h.key), { preview: h.key })}
                        className="flex items-center gap-3 px-5 py-2 hover:bg-muted/60"
                      >
                        <span className="w-4 text-right text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                        <FileIcon category={h.category} ext={h.ext} className="h-4 w-4" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">{h.name}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {h.connectionName} / {h.bucket} / {parentPrefix(h.key)}
                          </span>
                        </span>
                        <span className="text-sm font-medium tabular-nums">{formatBytes(h.size)}</span>
                      </Link>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="px-5 pb-5 text-sm text-muted-foreground">Nenhum arquivo indexado.</p>
              )
            ) : (
              <CardContent>
                <Skeleton className="h-64" />
              </CardContent>
            )}
          </Card>
          <Card>
            <CardHeader className="flex-row items-start justify-between">
              <div className="space-y-1">
                <CardTitle>Sincronizações recentes</CardTitle>
                <CardDescription>Status da indexação</CardDescription>
              </div>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/connections">Gerenciar</Link>
              </Button>
            </CardHeader>
            {runs.data ? (
              <SyncRunsTable runs={runs.data.items} connections={conns.data?.items} />
            ) : (
              <CardContent>
                <Skeleton className="h-40" />
              </CardContent>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string | null; hint?: string }) {
  return (
    <Card className="p-5">
      <p className="text-xs text-muted-foreground">{label}</p>
      {value === null ? <Skeleton className="mt-2 h-8 w-24" /> : <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>}
      {hint && <p className="mt-1 truncate text-[11px] text-muted-foreground">{hint}</p>}
    </Card>
  );
}
