"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { KeyRound, ShieldAlert, Trash2 } from "lucide-react";
import { backupsApi, type Client } from "@/lib/backups";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/misc";
import { ConfirmDialog } from "@/components/browser/dialogs";
import { CopyBlock, CopyField } from "./copy-block";

const PLACEHOLDER = "<SEU_TOKEN>";

function useOrigin() {
  return useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => "",
  );
}

export function ingestScripts(origin: string, token: string) {
  const url = `${origin}/api/ingest`;
  return {
    curl: `curl -fS --retry 3 -T backup.bak \\
  -H "Authorization: Bearer ${token}" \\
  "${url}/backup-$(date +%F).bak"`,
    linux: `#!/bin/sh
# /usr/local/bin/enviar-backup.sh — envia o backup do dia para o Storage-IOH
set -e
ARQUIVO="/var/backups/erp/base.bak"     # ajuste o caminho do backup
TOKEN="${token}"
NOME="$(date +%F)-$(basename "$ARQUIVO")"

curl -fS --retry 3 --retry-delay 30 -T "$ARQUIVO" \\
  -H "Authorization: Bearer $TOKEN" \\
  "${url}/$NOME"`,
    cron: `# crontab -e  (todos os dias às 02:00)
0 2 * * * /usr/local/bin/enviar-backup.sh >> /var/log/enviar-backup.log 2>&1`,
    powershell: `# C:\\scripts\\enviar-backup.ps1 — envia o backup do dia para o Storage-IOH
$Arquivo = "C:\\backup\\base.bak"   # ajuste o caminho do backup
$Token   = "${token}"
$Nome    = "$(Get-Date -Format yyyy-MM-dd)-$(Split-Path $Arquivo -Leaf)"

# curl.exe (Windows 10+) faz streaming e suporta arquivos grandes
curl.exe -fS --retry 3 -T "$Arquivo" -H "Authorization: Bearer $Token" "${url}/$Nome"
if ($LASTEXITCODE -ne 0) { throw "Falha no envio do backup ($LASTEXITCODE)" }

# Alternativa sem curl.exe:
# Invoke-WebRequest -Method Put -InFile $Arquivo -Headers @{Authorization="Bearer $Token"} -Uri "${url}/$Nome" -UseBasicParsing`,
    schtasks: `schtasks /Create /TN "Storage-IOH - Envio de backup" /SC DAILY /ST 02:00 /RU SYSTEM /F ^
  /TR "powershell -NoProfile -ExecutionPolicy Bypass -File C:\\scripts\\enviar-backup.ps1"`,
  };
}

function Scripts({ token }: { token: string }) {
  const origin = useOrigin();
  const s = ingestScripts(origin || "https://seu-servidor", token);
  const [os, setOs] = useState<"linux" | "windows" | "curl">("linux");
  return (
    <div className="space-y-3">
      <div role="tablist" aria-label="Sistema do servidor do cliente" className="inline-flex rounded-md border border-border bg-surface p-0.5">
        {(
          [
            ["linux", "Linux (cron)"],
            ["windows", "Windows (PowerShell)"],
            ["curl", "curl avulso"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={os === k}
            onClick={() => setOs(k)}
            className={`h-7 rounded px-3 text-xs ${os === k ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {os === "linux" && (
        <>
          <CopyBlock title="Script de envio" text={s.linux} />
          <CopyBlock title="Agendamento (crontab)" text={s.cron} />
          <p className="text-xs text-muted-foreground">
            Lembre de dar permissão de execução: <code className="rounded bg-muted px-1">chmod +x /usr/local/bin/enviar-backup.sh</code>
          </p>
        </>
      )}
      {os === "windows" && (
        <>
          <CopyBlock title="Script PowerShell" text={s.powershell} />
          <CopyBlock title="Agendamento diário às 02:00 (Prompt de Comando como administrador)" text={s.schtasks} />
        </>
      )}
      {os === "curl" && <CopyBlock title="Envio manual" text={s.curl} />}
    </div>
  );
}

export function ClientIngestTab({ client }: { client: Client }) {
  const qc = useQueryClient();
  const { isAdmin } = useAuth();
  const [confirmNew, setConfirmNew] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const hasToken = !!client.ingestTokenPrefix;

  async function generate() {
    setBusy(true);
    try {
      const res = await backupsApi.createToken(client.id);
      setNewToken(res.token);
      qc.invalidateQueries({ queryKey: ["client", client.id] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Envio automático de backups</CardTitle>
          <CardDescription>
            O servidor do cliente envia o backup direto para o Storage-IOH com um token exclusivo — sem receber credenciais do storage. Os
            arquivos são gravados em <span className="font-mono">{client.bucket}/{client.prefix}</span>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3">
            <KeyRound className="h-5 w-5 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Token de envio</p>
              <p className="text-xs text-muted-foreground">
                {hasToken ? (
                  <>
                    Ativo · começa com <span className="font-mono">{client.ingestTokenPrefix}…</span>
                  </>
                ) : (
                  "Nenhum token ativo"
                )}
              </p>
            </div>
            {isAdmin && (
              <div className="flex gap-2">
                <Button onClick={() => (hasToken ? setConfirmNew(true) : generate())} disabled={busy}>
                  {busy ? <Spinner className="text-primary-foreground" /> : <KeyRound />}
                  {hasToken ? "Gerar novo token" : "Gerar token"}
                </Button>
                {hasToken && (
                  <Button variant="outline" className="text-destructive" onClick={() => setConfirmRevoke(true)}>
                    <Trash2 /> Revogar
                  </Button>
                )}
              </div>
            )}
          </div>
          {!client.active && (
            <p className="flex items-center gap-2 text-xs text-warning">
              <ShieldAlert className="h-3.5 w-3.5" /> Cliente inativo: envios com o token serão recusados.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Scripts prontos</CardTitle>
          <CardDescription>
            Substitua <span className="font-mono">{PLACEHOLDER}</span> pelo token gerado. O token só é exibido uma vez, no momento em que é gerado.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Scripts token={PLACEHOLDER} />
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmNew}
        onOpenChange={setConfirmNew}
        title="Gerar novo token?"
        description="O token atual deixa de funcionar imediatamente. Será preciso atualizar o script no servidor do cliente."
        confirmLabel="Gerar novo token"
        destructive
        onConfirm={generate}
      />
      <ConfirmDialog
        open={confirmRevoke}
        onOpenChange={setConfirmRevoke}
        title="Revogar token de envio?"
        description="O servidor do cliente não conseguirá mais enviar backups até que um novo token seja gerado."
        confirmLabel="Revogar"
        destructive
        onConfirm={async () => {
          try {
            await backupsApi.revokeToken(client.id);
            toast.success("Token revogado");
            qc.invalidateQueries({ queryKey: ["client", client.id] });
          } catch (e) {
            toast.error((e as Error).message);
          }
        }}
      />

      <Dialog open={!!newToken} onOpenChange={(o) => !o && setNewToken(null)}>
        <DialogContent className="max-w-2xl">
          {newToken && (
            <>
              <DialogHeader>
                <DialogTitle>Token gerado</DialogTitle>
                <DialogDescription>
                  Copie e guarde agora: <strong className="text-foreground">ele não será exibido novamente</strong>. Trate-o como uma senha.
                </DialogDescription>
              </DialogHeader>
              <CopyField value={newToken} label="Token de envio" secret />
              <Scripts token={newToken} />
              <DialogFooter>
                <Button onClick={() => setNewToken(null)}>Já guardei o token</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
