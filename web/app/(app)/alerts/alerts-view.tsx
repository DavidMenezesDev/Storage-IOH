"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Mail, MoreHorizontal, Pencil, Plus, Send, Trash2, Webhook } from "lucide-react";
import { backupsApi, type AlertChannel, type ChannelType } from "@/lib/backups";
import { useAuth } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input, Label } from "@/components/ui/input";
import { Skeleton, Spinner } from "@/components/ui/misc";
import { ConfirmDialog } from "@/components/browser/dialogs";
import { AlertTimeline } from "@/components/backups/alert-timeline";

export function AlertsView() {
  const { isAdmin } = useAuth();
  const alerts = useQuery({ queryKey: ["alerts"], queryFn: () => backupsApi.alerts(200), refetchInterval: 60_000 });

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Alertas</h1>
          <p className="text-sm text-muted-foreground">Mudanças de status dos clientes e para onde as notificações são enviadas.</p>
        </div>

        <div className={isAdmin ? "grid gap-6 lg:grid-cols-5" : ""}>
          <Card className={isAdmin ? "lg:col-span-3" : undefined}>
            <CardHeader>
              <CardTitle>Histórico</CardTitle>
              <CardDescription>Últimas 200 mudanças de status</CardDescription>
            </CardHeader>
            {alerts.isLoading ? (
              <CardContent>
                <Skeleton className="h-40" />
              </CardContent>
            ) : alerts.isError ? (
              <p className="px-5 pb-5 text-sm text-destructive">{(alerts.error as Error).message}</p>
            ) : (
              <AlertTimeline alerts={alerts.data!.items} />
            )}
          </Card>
          {isAdmin && (
            <div className="lg:col-span-2">
              <Channels />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Channels() {
  const qc = useQueryClient();
  const channels = useQuery({ queryKey: ["alert-channels"], queryFn: backupsApi.channels });
  const settings = useQuery({ queryKey: ["settings"], queryFn: backupsApi.settings, staleTime: 5 * 60_000 });
  const [editing, setEditing] = useState<AlertChannel | "new" | null>(null);
  const [deleting, setDeleting] = useState<AlertChannel | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const smtp = settings.data?.smtpConfigured ?? false;

  async function test(c: AlertChannel) {
    setTesting(c.id);
    try {
      const r = await backupsApi.testChannel(c.id);
      if (r.ok) toast.success(`Teste enviado para “${c.name}”`);
      else toast.error(`Falha no teste: ${r.error ?? "erro desconhecido"}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setTesting(null);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="space-y-1">
          <CardTitle>Canais de notificação</CardTitle>
          <CardDescription>Webhook (Slack, Discord, Google Chat, Teams via conector…) ou e-mail.</CardDescription>
        </div>
        <Button size="sm" onClick={() => setEditing("new")}>
          <Plus /> Novo canal
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {settings.data && !smtp && (
          <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            E-mail indisponível: configure <span className="font-mono">SMTP_*</span> no <span className="font-mono">.env</span> para habilitar.
          </p>
        )}
        {channels.isLoading ? (
          <Skeleton className="h-20" />
        ) : channels.isError ? (
          <p className="text-sm text-destructive">{(channels.error as Error).message}</p>
        ) : channels.data!.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum canal. Sem canais, os alertas ficam apenas no histórico.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {channels.data!.items.map((c) => {
              const Icon = c.type === "email" ? Mail : Webhook;
              return (
                <li key={c.id} className="flex items-center gap-3 px-3 py-2.5">
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-label={c.type === "email" ? "E-mail" : "Webhook"} />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      <span className="truncate">{c.name}</span>
                      {!c.enabled && <Badge>Desativado</Badge>}
                      {c.onlyProblems && <Badge tone="info">Só problemas</Badge>}
                    </p>
                    <p className="truncate font-mono text-xs text-muted-foreground" title={c.target}>
                      {c.target}
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => test(c)} disabled={testing === c.id}>
                    {testing === c.id ? <Spinner /> : <Send />} Testar
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label={`Ações de ${c.name}`}>
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => setEditing(c)}>
                        <Pencil /> Editar
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem destructive onSelect={() => setDeleting(c)}>
                        <Trash2 /> Excluir
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      <ChannelDialog
        channel={editing === "new" ? null : editing}
        open={editing !== null}
        smtp={smtp}
        onOpenChange={(o) => !o && setEditing(null)}
        onSaved={() => {
          setEditing(null);
          qc.invalidateQueries({ queryKey: ["alert-channels"] });
        }}
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Excluir canal “${deleting?.name}”?`}
        description="As próximas mudanças de status não serão mais enviadas para este destino."
        confirmLabel="Excluir"
        destructive
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await backupsApi.deleteChannel(deleting.id);
            toast.success("Canal excluído");
            qc.invalidateQueries({ queryKey: ["alert-channels"] });
          } catch (e) {
            toast.error((e as Error).message);
          }
        }}
      />
    </Card>
  );
}

function ChannelDialog({
  channel,
  open,
  smtp,
  onOpenChange,
  onSaved,
}: {
  channel: AlertChannel | null;
  open: boolean;
  smtp: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>{open && <ChannelForm channel={channel} smtp={smtp} onCancel={() => onOpenChange(false)} onSaved={onSaved} />}</DialogContent>
    </Dialog>
  );
}

function ChannelForm({ channel, smtp, onCancel, onSaved }: { channel: AlertChannel | null; smtp: boolean; onCancel: () => void; onSaved: () => void }) {
  const [type, setType] = useState<ChannelType>(channel?.type ?? "webhook");
  const [name, setName] = useState(channel?.name ?? "");
  const [target, setTarget] = useState(channel?.target ?? "");
  const [onlyProblems, setOnlyProblems] = useState(channel?.onlyProblems ?? false);
  const [enabled, setEnabled] = useState(channel?.enabled ?? true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="grid gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        if (!name.trim() || !target.trim()) return setError("Preencha nome e destino.");
        if (type === "webhook" && !/^https?:\/\//.test(target.trim())) return setError("A URL do webhook deve começar com http:// ou https://");
        setBusy(true);
        try {
          const body = { type, name: name.trim(), target: target.trim(), onlyProblems, enabled };
          if (channel) await backupsApi.updateChannel(channel.id, body);
          else await backupsApi.createChannel(body);
          toast.success(channel ? "Canal atualizado" : "Canal criado");
          onSaved();
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <DialogHeader>
        <DialogTitle>{channel ? "Editar canal" : "Novo canal de notificação"}</DialogTitle>
        <DialogDescription>Recebe um aviso sempre que um cliente muda de status.</DialogDescription>
      </DialogHeader>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">Tipo</legend>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ["webhook", "Webhook", Webhook, true],
              ["email", "E-mail", Mail, smtp],
            ] as const
          ).map(([t, label, Icon, allowed]) => (
            <label
              key={t}
              className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                type === t ? "border-primary bg-primary/8" : "border-border"
              } ${!allowed ? "cursor-not-allowed opacity-50" : ""}`}
            >
              <input type="radio" name="ch-type" value={t} checked={type === t} disabled={!allowed} onChange={() => setType(t)} className="sr-only" />
              <Icon className="h-4 w-4" /> {label}
            </label>
          ))}
        </div>
        {!smtp && <p className="text-xs text-muted-foreground">E-mail requer SMTP: configure SMTP_* no .env.</p>}
      </fieldset>
      <div className="grid gap-1.5">
        <Label htmlFor="ch-name">Nome</Label>
        <Input id="ch-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={type === "email" ? "Equipe de suporte" : "Slack #backups"} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="ch-target">{type === "email" ? "E-mails (separados por vírgula)" : "URL do webhook"}</Label>
        <Input
          id="ch-target"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          className="font-mono text-xs"
          placeholder={type === "email" ? "suporte@empresa.com.br, plantao@empresa.com.br" : "https://hooks.slack.com/services/…"}
        />
        {type === "webhook" && (
          <p className="text-xs text-muted-foreground">
            Recebe um POST JSON com <span className="font-mono">text</span> (Slack/Google Chat/Mattermost) e <span className="font-mono">content</span> (Discord).
          </p>
        )}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={onlyProblems} onCheckedChange={(v) => setOnlyProblems(v === true)} />
        Avisar só problemas (não notificar quando voltar para “Em dia”)
      </label>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={enabled} onCheckedChange={(v) => setEnabled(v === true)} />
        Ativo
      </label>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={busy}>
          {busy && <Spinner className="text-primary-foreground" />}
          Salvar
        </Button>
      </DialogFooter>
      {channel && <p className="text-xs text-muted-foreground">Criado em {formatDateTime(channel.createdAt)}</p>}
    </form>
  );
}
