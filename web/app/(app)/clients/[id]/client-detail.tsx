"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ChevronLeft, Download, FolderOpen, Mail, Pencil, Phone, RefreshCw, Trash2, User } from "lucide-react";
import { backupsApi, clientDownloadUrl, type Client } from "@/lib/backups";
import { useAuth } from "@/lib/auth";
import { formatDocument, documentKind } from "@/lib/document";
import { browseHref } from "@/lib/files";
import { formatBytes, formatDateTime, formatNumber, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { EmptyState, Skeleton, Spinner } from "@/components/ui/misc";
import { STATUS_META, StatusBadge } from "@/components/backups/status";
import { ClientBackupsTab } from "@/components/backups/client-backups-tab";
import { ClientIngestTab } from "@/components/backups/client-ingest-tab";
import { ClientRetentionTab } from "@/components/backups/client-retention-tab";
import { AlertTimeline } from "@/components/backups/alert-timeline";
import { AuditTable } from "@/components/backups/audit-table";

type Tab = "backups" | "ingest" | "retention" | "alerts" | "audit";

export function ClientDetail({ id }: { id: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const { canOperate, isAdmin } = useAuth();
  const [deleting, setDeleting] = useState(false);
  const [scanning, setScanning] = useState(false);

  const q = useQuery({
    queryKey: ["client", id],
    queryFn: () => backupsApi.client(id),
    refetchInterval: 30_000,
  });

  const tabs: { id: Tab; label: string; show: boolean }[] = [
    { id: "backups", label: "Backups", show: true },
    { id: "ingest", label: "Envio automático", show: true },
    { id: "retention", label: "Retenção", show: true },
    { id: "alerts", label: "Alertas", show: true },
    { id: "audit", label: "Auditoria", show: isAdmin },
  ];
  const visible = tabs.filter((t) => t.show);
  const requested = params.get("tab") as Tab | null;
  const tab: Tab = visible.some((t) => t.id === requested) ? requested! : "backups";
  const setTab = (t: Tab) => {
    const sp = new URLSearchParams(params.toString());
    if (t === "backups") sp.delete("tab");
    else sp.set("tab", t);
    const s = sp.toString();
    router.replace(s ? `?${s}` : `/clients/${id}`, { scroll: false });
  };

  async function scan() {
    setScanning(true);
    try {
      await backupsApi.scan(id);
      toast.success("Varredura agendada — o status será atualizado em instantes");
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: ["client", id] });
      }, 4000);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setScanning(false);
    }
  }

  if (q.isLoading) {
    return (
      <div className="mx-auto max-w-7xl space-y-4 p-4 md:p-8">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-28" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (q.isError || !q.data) {
    return (
      <EmptyState
        title="Cliente não encontrado"
        description={(q.error as Error | null)?.message}
        action={
          <Button variant="outline" asChild>
            <Link href="/clients">Voltar para clientes</Link>
          </Button>
        }
      />
    );
  }
  const c = q.data;
  const m = STATUS_META[c.status] ?? STATUS_META.pending;
  const kind = documentKind(c.document);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
        {/* Cabeçalho */}
        <div className="space-y-3">
          <Link href="/clients" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ChevronLeft className="h-3.5 w-3.5" /> Clientes
          </Link>
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-semibold tracking-tight">{c.name}</h1>
                <StatusBadge status={c.status} reason={c.statusReason} className="text-xs" />
                {!c.active && c.status !== "inactive" && <StatusBadge status="inactive" />}
              </div>
              <p className="text-sm text-muted-foreground">
                {c.document ? `${kind ?? "Documento"} ${formatDocument(c.document)}` : "Sem documento"}
                {c.tags.length > 0 && <span className="ml-2">{c.tags.map((t) => `#${t}`).join(" ")}</span>}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {canOperate && (
                <>
                  <Button variant="outline" onClick={scan} disabled={scanning}>
                    <RefreshCw className={cn(scanning && "animate-spin")} /> Varrer agora
                  </Button>
                  {c.lastBackupKey && (
                    <Button variant="outline" asChild>
                      <a href={clientDownloadUrl(c.id, c.lastBackupKey)} download>
                        <Download /> Baixar último backup
                      </a>
                    </Button>
                  )}
                </>
              )}
              {isAdmin && (
                <>
                  <Button variant="outline" asChild>
                    <Link href={`/clients/${c.id}/edit`}>
                      <Pencil /> Editar
                    </Link>
                  </Button>
                  <Button variant="outline" className="text-destructive" onClick={() => setDeleting(true)}>
                    <Trash2 /> Excluir
                  </Button>
                </>
              )}
            </div>
          </div>

          {(c.status !== "ok" || c.lastScanError) && (c.statusReason || c.lastScanError) && (
            <div className={cn("flex items-start gap-2 rounded-lg border px-4 py-3 text-sm", m.border, m.bg)}>
              <m.icon className={cn("mt-0.5 h-4 w-4 shrink-0", m.text)} aria-hidden />
              <div>
                <p className={cn("font-medium", m.text)}>{m.label}</p>
                {c.statusReason && <p className="text-foreground/80">{c.statusReason}</p>}
                {c.lastScanError && <p className="mt-1 text-xs text-destructive">Última varredura: {c.lastScanError}</p>}
              </div>
            </div>
          )}
        </div>

        {/* Resumo */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Summary
            label="Último backup"
            value={c.lastBackupAt ? formatRelative(c.lastBackupAt) : "nunca"}
            hint={c.lastBackupAt ? `${formatDateTime(c.lastBackupAt)} · ${formatBytes(c.lastBackupSize)}` : undefined}
          />
          <Summary label="Backups guardados" value={formatNumber(c.backupCount)} hint={formatBytes(c.totalBytes)} />
          <Summary
            label="Frequência esperada"
            value={c.policy.expectedEveryHours % 24 === 0 ? `a cada ${c.policy.expectedEveryHours / 24} dia(s)` : `a cada ${c.policy.expectedEveryHours} h`}
            hint={`tolerância ${c.policy.graceHours} h · mínimo ${formatBytes(c.policy.minSizeBytes)}`}
          />
          <Summary
            label="Última varredura"
            value={c.lastScanAt ? formatRelative(c.lastScanAt) : "pendente"}
            hint={c.statusChangedAt ? `status desde ${formatDateTime(c.statusChangedAt)}` : undefined}
          />
        </div>

        <Card className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3 text-sm">
          <span className="flex min-w-0 items-center gap-2">
            <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
            <Link href={browseHref(c.connectionId, c.bucket, c.prefix)} className="truncate font-mono text-xs hover:underline">
              {c.connectionName} / {c.bucket} / {c.prefix || "(raiz)"}
            </Link>
            <span className="text-xs text-muted-foreground">padrão {c.policy.filePattern}</span>
          </span>
          {c.contactName && (
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <User className="h-4 w-4" /> {c.contactName}
            </span>
          )}
          {c.contactEmail && (
            <a href={`mailto:${c.contactEmail}`} className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
              <Mail className="h-4 w-4" /> {c.contactEmail}
            </a>
          )}
          {c.contactPhone && (
            <a href={`tel:${c.contactPhone}`} className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
              <Phone className="h-4 w-4" /> {c.contactPhone}
            </a>
          )}
        </Card>
        {c.notes && <p className="whitespace-pre-wrap rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">{c.notes}</p>}

        {/* Abas */}
        <div>
          <div role="tablist" aria-label="Seções do cliente" className="flex gap-1 overflow-x-auto border-b border-border">
            {visible.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`tab-${t.id}`}
                aria-selected={tab === t.id}
                aria-controls={`panel-${t.id}`}
                onClick={() => setTab(t.id)}
                className={cn(
                  "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors",
                  tab === t.id ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="pt-6">
            {tab === "backups" && <ClientBackupsTab client={c} />}
            {tab === "ingest" && <ClientIngestTab client={c} />}
            {tab === "retention" && <ClientRetentionTab client={c} />}
            {tab === "alerts" && <ClientAlerts clientId={c.id} />}
            {tab === "audit" && isAdmin && <ClientAudit clientId={c.id} />}
          </div>
        </div>
      </div>

      <DeleteClientDialog
        client={c}
        open={deleting}
        onOpenChange={setDeleting}
        onDeleted={() => {
          qc.invalidateQueries({ queryKey: ["clients"] });
          qc.invalidateQueries({ queryKey: ["backups"] });
          router.replace("/clients");
        }}
      />
    </div>
  );
}

function Summary({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tracking-tight">{value}</p>
      {hint && <p className="mt-0.5 truncate text-xs text-muted-foreground" title={hint}>{hint}</p>}
    </Card>
  );
}

function ClientAlerts({ clientId }: { clientId: string }) {
  const q = useQuery({ queryKey: ["client", clientId, "alerts"], queryFn: () => backupsApi.clientAlerts(clientId) });
  return (
    <Card>
      {q.isLoading ? <Skeleton className="m-5 h-24" /> : q.isError ? <p className="p-5 text-sm text-destructive">{(q.error as Error).message}</p> : <AlertTimeline alerts={q.data!.items} showClient={false} />}
    </Card>
  );
}

function ClientAudit({ clientId }: { clientId: string }) {
  const q = useQuery({ queryKey: ["client", clientId, "audit"], queryFn: () => backupsApi.clientAudit(clientId, 200) });
  return (
    <Card className="overflow-hidden">
      {q.isLoading ? <Skeleton className="m-5 h-24" /> : q.isError ? <p className="p-5 text-sm text-destructive">{(q.error as Error).message}</p> : <AuditTable items={q.data!.items} showClient={false} />}
    </Card>
  );
}

function DeleteClientDialog({
  client,
  open,
  onOpenChange,
  onDeleted,
}: {
  client: Client;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDeleted: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const ok = typed.trim() === client.name.trim();
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setTyped("");
      }}
    >
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!ok) return;
            setBusy(true);
            try {
              await backupsApi.deleteClient(client.id);
              toast.success("Cliente excluído");
              onOpenChange(false);
              onDeleted();
            } catch (err) {
              toast.error((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>Excluir cliente?</DialogTitle>
            <DialogDescription>
              O cadastro, o histórico, os links e o token de envio de <strong className="text-foreground">{client.name}</strong> serão removidos. Os
              arquivos de backup <strong className="text-foreground">não</strong> são apagados do storage.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="confirm-name">
              Digite <span className="font-mono">{client.name}</span> para confirmar
            </Label>
            <Input id="confirm-name" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoFocus />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="destructive" disabled={!ok || busy}>
              {busy && <Spinner className="text-white" />}
              Excluir cliente
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
