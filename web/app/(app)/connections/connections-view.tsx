"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { HardDrive, MoreHorizontal, Pencil, Plug, Plus, RefreshCw, Trash2 } from "lucide-react";
import { endpoints, type Connection } from "@/lib/api";
import { browseHref } from "@/lib/files";
import { useAuth } from "@/lib/auth";
import { formatDateTime, formatRelative } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { ConnectionDialog, PRESETS } from "@/components/connections/connection-dialog";
import { ConfirmDialog } from "@/components/browser/dialogs";
import { SyncRunsTable } from "@/components/common/sync-runs-table";

export function ConnectionsView() {
  const qc = useQueryClient();
  const router = useRouter();
  const { isAdmin, canOperate } = useAuth();
  const params = useSearchParams();
  const [dialogOpen, setDialogOpen] = useState(params.get("new") === "1");
  const [editing, setEditing] = useState<Connection | null>(null);
  const [deleting, setDeleting] = useState<Connection | null>(null);

  const conns = useQuery({ queryKey: ["connections"], queryFn: endpoints.connections });
  const runs = useQuery({
    queryKey: ["sync-runs"],
    queryFn: () => endpoints.syncRuns(undefined, 15),
    refetchInterval: (q) => (q.state.data?.items.some((r) => r.status === "running") ? 3000 : 30_000),
  });

  const sync = useMutation({
    mutationFn: (id: string) => endpoints.syncConnection(id),
    onSuccess: (r) => {
      toast.success(`Reindexação agendada (${r.enqueued} bucket(s))`);
      qc.invalidateQueries({ queryKey: ["sync-runs"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  function openNew() {
    setEditing(null);
    setDialogOpen(true);
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-8">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1">
            <h1 className="text-xl font-semibold tracking-tight">Conexões</h1>
            <p className="text-sm text-muted-foreground">Contas S3, Cloudflare R2 e MinIO gerenciadas pelo Storage-IOH.</p>
          </div>
          {isAdmin && (
            <Button onClick={openNew}>
              <Plus /> Nova conexão
            </Button>
          )}
        </div>

        {conns.isLoading ? (
          <div className="grid gap-4 md:grid-cols-2">
            <Skeleton className="h-36" />
            <Skeleton className="h-36" />
          </div>
        ) : conns.isError ? (
          <EmptyState title="Erro ao carregar conexões" description={(conns.error as Error).message} />
        ) : conns.data!.items.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Plug />}
              title="Nenhuma conexão ainda"
              description="Adicione um bucket S3, R2 ou MinIO para começar a navegar, buscar e visualizar arquivos."
              action={
                isAdmin ? (
                  <Button onClick={openNew}>
                    <Plus /> Adicionar conexão
                  </Button>
                ) : undefined
              }
            />
          </Card>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2">
            {conns.data!.items.map((c) => (
              <li key={c.id}>
                <ConnectionCard
                  conn={c}
                  isAdmin={isAdmin}
                  canOperate={canOperate}
                  onEdit={() => {
                    setEditing(c);
                    setDialogOpen(true);
                  }}
                  onDelete={() => setDeleting(c)}
                  onSync={() => sync.mutate(c.id)}
                  syncing={sync.isPending && sync.variables === c.id}
                />
              </li>
            ))}
          </ul>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Sincronizações recentes</CardTitle>
            <CardDescription>Indexação dos objetos para busca e dashboard.</CardDescription>
          </CardHeader>
          {runs.data ? <SyncRunsTable runs={runs.data.items} connections={conns.data?.items} /> : <CardContent><Skeleton className="h-20" /></CardContent>}
        </Card>
      </div>

      <ConnectionDialog
        open={dialogOpen && isAdmin}
        onOpenChange={(o) => {
          setDialogOpen(o);
          if (!o && params.get("new")) router.replace("/connections");
        }}
        connection={editing}
        onSaved={(c) => {
          toast.success(editing ? "Conexão atualizada" : "Conexão adicionada");
          setDialogOpen(false);
          qc.invalidateQueries({ queryKey: ["connections"] });
          qc.invalidateQueries({ queryKey: ["buckets", c.id] });
          qc.invalidateQueries({ queryKey: ["sync-runs"] });
          if (params.get("new")) router.replace("/connections");
        }}
      />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Remover “${deleting?.name}”?`}
        description="A conexão e seus dados de índice serão removidos do Storage-IOH. Nenhum objeto é apagado do provedor."
        confirmLabel="Remover"
        destructive
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await endpoints.deleteConnection(deleting.id);
            toast.success("Conexão removida");
            qc.invalidateQueries({ queryKey: ["connections"] });
            qc.invalidateQueries({ queryKey: ["stats"] });
          } catch (e) {
            toast.error((e as Error).message);
          }
        }}
      />
    </div>
  );
}

function ConnectionCard({
  conn,
  isAdmin,
  canOperate,
  onEdit,
  onDelete,
  onSync,
  syncing,
}: {
  conn: Connection;
  isAdmin: boolean;
  canOperate: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onSync: () => void;
  syncing: boolean;
}) {
  const buckets = useQuery({ queryKey: ["buckets", conn.id], queryFn: () => endpoints.buckets(conn.id), staleTime: 60_000 });
  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="flex-row items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <HardDrive className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <CardTitle className="truncate">{conn.name}</CardTitle>
          <CardDescription className="truncate">
            {PRESETS[conn.provider].label}
            {conn.endpoint ? ` · ${conn.endpoint}` : ` · ${conn.region}`}
          </CardDescription>
        </div>
        {isAdmin && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`Ações de ${conn.name}`}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil /> Editar
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onSync} disabled={!conn.indexEnabled}>
              <RefreshCw /> Reindexar agora
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onSelect={onDelete}>
              <Trash2 /> Remover
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        )}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        <div className="flex flex-wrap gap-1.5">
          {conn.indexEnabled ? <Badge tone="info">Indexação ativa</Badge> : <Badge>Sem indexação</Badge>}
          <Badge title={formatDateTime(conn.lastSyncAt)}>Última sync: {formatRelative(conn.lastSyncAt)}</Badge>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {buckets.isLoading && <Skeleton className="h-6 w-32" />}
          {buckets.isError && <span className="text-xs text-destructive">Falha ao listar buckets: {(buckets.error as Error).message}</span>}
          {buckets.data?.items.slice(0, 8).map((b) => (
            <Link
              key={b.name}
              href={browseHref(conn.id, b.name)}
              className="rounded-md border border-border px-2 py-0.5 text-xs hover:border-primary hover:text-primary"
            >
              {b.name}
            </Link>
          ))}
          {(buckets.data?.items.length ?? 0) > 8 && <span className="text-xs text-muted-foreground">+{buckets.data!.items.length - 8}</span>}
        </div>
        <div className="mt-auto flex gap-2 pt-1">
          {isAdmin && (
            <Button variant="outline" size="sm" onClick={onEdit}>
              <Pencil /> Editar
            </Button>
          )}
          {canOperate && (
            <Button variant="outline" size="sm" onClick={onSync} disabled={!conn.indexEnabled || syncing}>
              <RefreshCw className={syncing ? "animate-spin" : undefined} /> Reindexar
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
