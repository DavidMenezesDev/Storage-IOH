"use client";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Building2, Download, Plus, Search, X } from "lucide-react";
import { backupsApi, clientsCsvUrl, CLIENT_STATUSES, type ClientFilters, type ClientStatus } from "@/lib/backups";
import { useAuth } from "@/lib/auth";
import { formatDocument } from "@/lib/document";
import { formatBytes, formatDateTime, formatNumber, formatRelative } from "@/lib/format";
import { useDebounced } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState, Spinner } from "@/components/ui/misc";
import { STATUS_META, StatusBadge } from "@/components/backups/status";

type ActiveFilter = "all" | "true" | "false";

export function ClientsView() {
  const router = useRouter();
  const params = useSearchParams();
  const { isAdmin } = useAuth();

  const statusParam = params.get("status") ?? "";
  const statuses = new Set(statusParam.split(",").filter(Boolean) as ClientStatus[]);
  const active = (params.get("active") as ActiveFilter | null) ?? "all";
  const qParam = params.get("q") ?? "";

  const [q, setQ] = useState(qParam);
  const dq = useDebounced(q, 300);

  function setParam(patch: Record<string, string | null>) {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) sp.set(k, v);
      else sp.delete(k);
    }
    const s = sp.toString();
    router.replace(s ? `/clients?${s}` : "/clients", { scroll: false });
  }

  // Sincroniza o texto digitado (debounced) com a URL
  useEffect(() => {
    if (dq !== qParam) setParam({ q: dq.trim() || null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dq]);

  const filters: ClientFilters = {
    q: qParam || undefined,
    status: statusParam || undefined,
    active: active === "all" ? undefined : active,
  };

  const clients = useQuery({
    queryKey: ["clients", filters],
    queryFn: () => backupsApi.clients(filters),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });

  function toggleStatus(s: ClientStatus) {
    const n = new Set(statuses);
    if (n.has(s)) n.delete(s);
    else n.add(s);
    setParam({ status: [...n].join(",") || null });
  }

  const hasFilters = !!(qParam || statusParam || active !== "all");

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl space-y-5 p-4 md:p-8">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1">
            <h1 className="text-xl font-semibold tracking-tight">Clientes</h1>
            <p className="text-sm text-muted-foreground">Empresas atendidas e a saúde dos backups de cada uma.</p>
          </div>
          <Button variant="outline" asChild>
            <a href={clientsCsvUrl(filters)} download>
              <Download /> Exportar CSV
            </a>
          </Button>
          {isAdmin && (
            <Button asChild>
              <Link href="/clients/new">
                <Plus /> Novo cliente
              </Link>
            </Button>
          )}
        </div>

        {/* Filtros */}
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[16rem] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar por nome, CNPJ/CPF ou tag…"
                aria-label="Buscar clientes"
                className="pl-9"
              />
            </div>
            <div role="radiogroup" aria-label="Situação do cadastro" className="flex rounded-md border border-border bg-surface p-0.5">
              {(
                [
                  ["all", "Todos"],
                  ["true", "Ativos"],
                  ["false", "Inativos"],
                ] as [ActiveFilter, string][]
              ).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={active === v}
                  onClick={() => setParam({ active: v === "all" ? null : v })}
                  className={cn("h-7 rounded px-3 text-xs", active === v ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground")}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filtrar por status">
            {CLIENT_STATUSES.map((s) => {
              const m = STATUS_META[s];
              const Icon = m.icon;
              const on = statuses.has(s);
              return (
                <button
                  key={s}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleStatus(s)}
                  className={cn(
                    "inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs transition-colors",
                    on ? cn(m.bg, m.text, m.border, "font-medium") : "border-border bg-surface text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden />
                  {m.label}
                </button>
              );
            })}
            {hasFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setQ("");
                  router.replace("/clients");
                }}
              >
                <X /> Limpar filtros
              </Button>
            )}
            {clients.isFetching && <Spinner className="ml-1 h-3.5 w-3.5" />}
          </div>
        </div>

        <Card className="overflow-hidden">
          {clients.isLoading ? (
            <div className="flex justify-center py-16">
              <Spinner className="h-6 w-6" />
            </div>
          ) : clients.isError ? (
            <EmptyState title="Erro ao carregar clientes" description={(clients.error as Error).message} />
          ) : clients.data!.items.length === 0 ? (
            <EmptyState
              icon={<Building2 />}
              title={hasFilters ? "Nenhum cliente encontrado" : "Nenhum cliente cadastrado"}
              description={hasFilters ? "Ajuste os filtros para ver outros clientes." : "Cadastre um cliente para começar a monitorar os backups dele."}
              action={
                !hasFilters && isAdmin ? (
                  <Button asChild>
                    <Link href="/clients/new">
                      <Plus /> Novo cliente
                    </Link>
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                    <th className="px-4 py-2 font-medium">Cliente</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Último backup</th>
                    <th className="px-3 py-2 text-right font-medium">Tamanho</th>
                    <th className="px-3 py-2 text-right font-medium">Backups</th>
                    <th className="px-3 py-2 font-medium">Local</th>
                    <th className="px-4 py-2 font-medium">Tags</th>
                  </tr>
                </thead>
                <tbody>
                  {clients.data!.items.map((c) => (
                    <tr
                      key={c.id}
                      className={cn("cursor-pointer border-b border-border/60 last:border-0 hover:bg-muted/40", !c.active && "text-muted-foreground")}
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest("a,button")) return;
                        router.push(`/clients/${c.id}`);
                      }}
                    >
                      <td className="px-4 py-2.5">
                        <Link href={`/clients/${c.id}`} className="font-medium hover:underline">
                          {c.name}
                        </Link>
                        <div className="text-xs text-muted-foreground">{formatDocument(c.document) || "—"}</div>
                      </td>
                      <td className="px-3 py-2.5">
                        <StatusBadge status={c.status} reason={c.statusReason} />
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5" title={formatDateTime(c.lastBackupAt)}>
                        {c.lastBackupAt ? formatRelative(c.lastBackupAt) : "nunca"}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{formatBytes(c.lastBackupSize)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{formatNumber(c.backupCount)}</td>
                      <td className="max-w-[16rem] px-3 py-2.5 text-xs text-muted-foreground">
                        <span className="block truncate" title={`${c.connectionName} / ${c.bucket} / ${c.prefix}`}>
                          {c.connectionName} / {c.bucket} / {c.prefix || "(raiz)"}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          {c.tags.map((t) => (
                            <span key={t} className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                              {t}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        {clients.data && clients.data.items.length > 0 && (
          <p className="text-xs text-muted-foreground">{formatNumber(clients.data.items.length)} cliente(s)</p>
        )}
      </div>
    </div>
  );
}
