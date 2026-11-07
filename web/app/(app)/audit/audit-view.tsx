"use client";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { X } from "lucide-react";
import { backupsApi } from "@/lib/backups";
import { useDebounced } from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { EmptyState, Spinner } from "@/components/ui/misc";
import { AUDIT_ACTION_LABEL, AuditTable } from "@/components/backups/audit-table";

const PAGE = 100;

export function AuditView() {
  const [action, setAction] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [clientId, setClientId] = useState("");
  const dUser = useDebounced(userEmail.trim(), 400);

  const clients = useQuery({ queryKey: ["clients", {}], queryFn: () => backupsApi.clients() });

  const q = useInfiniteQuery({
    queryKey: ["audit", action, dUser, clientId],
    queryFn: ({ pageParam }) =>
      backupsApi.audit({ action: action || undefined, userEmail: dUser || undefined, clientId: clientId || undefined, limit: PAGE, before: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.items.length < PAGE ? undefined : last.items[last.items.length - 1].at),
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const filtered = !!(action || dUser || clientId);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl space-y-5 p-4 md:p-8">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Auditoria</h1>
          <p className="text-sm text-muted-foreground">Quem acessou, baixou, compartilhou ou alterou o quê — registro para conformidade com a LGPD.</p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="a-action">Ação</Label>
            <Select id="a-action" value={action} onChange={(e) => setAction(e.target.value)} className="w-56">
              <option value="">Todas</option>
              {Object.entries(AUDIT_ACTION_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="a-user">Usuário</Label>
            <Input id="a-user" type="search" value={userEmail} onChange={(e) => setUserEmail(e.target.value)} placeholder="e-mail" className="w-56" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="a-client">Cliente</Label>
            <Select id="a-client" value={clientId} onChange={(e) => setClientId(e.target.value)} className="w-56">
              <option value="">Todos</option>
              {clients.data?.items.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          {filtered && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setAction("");
                setUserEmail("");
                setClientId("");
              }}
            >
              <X /> Limpar
            </Button>
          )}
          {q.isFetching && <Spinner className="mb-2" />}
        </div>

        <Card className="overflow-hidden">
          {q.isLoading ? (
            <div className="flex justify-center py-12">
              <Spinner className="h-6 w-6" />
            </div>
          ) : q.isError ? (
            <EmptyState title="Erro ao carregar auditoria" description={(q.error as Error).message} />
          ) : (
            <AuditTable items={items} />
          )}
        </Card>
        {q.hasNextPage && (
          <div className="flex justify-center">
            <Button variant="outline" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>
              {q.isFetchingNextPage && <Spinner />} Carregar mais
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
