"use client";
import Link from "next/link";
import type { AuditEntry } from "@/lib/backups";
import { formatDateTime } from "@/lib/format";

export const AUDIT_ACTION_LABEL: Record<string, string> = {
  login: "Login",
  "login.failed": "Falha de login",
  "object.download": "Download de arquivo",
  "object.upload": "Envio de arquivo",
  "object.delete": "Exclusão de arquivo",
  "object.rename": "Renomeação de arquivo",
  "backup.download": "Download de backup",
  "backup.share": "Link de backup criado",
  "share.download": "Download por link",
  "share.revoke": "Link revogado",
  "backup.ingest": "Backup recebido (token)",
  "retention.apply": "Retenção aplicada",
  "client.create": "Cliente criado",
  "client.update": "Cliente alterado",
  "client.delete": "Cliente excluído",
  "token.create": "Token de envio gerado",
  "token.revoke": "Token de envio revogado",
  "connection.create": "Conexão criada",
  "connection.update": "Conexão alterada",
  "connection.delete": "Conexão excluída",
  "user.create": "Usuário criado",
  "user.update": "Usuário alterado",
  "user.delete": "Usuário excluído",
  "channel.create": "Canal de alerta criado",
  "channel.update": "Canal de alerta alterado",
  "channel.delete": "Canal de alerta excluído",
};

export function actionLabel(a: string) {
  return AUDIT_ACTION_LABEL[a] ?? a;
}

function compactDetail(d: Record<string, unknown> | null | undefined): string {
  if (!d || Object.keys(d).length === 0) return "";
  return JSON.stringify(d);
}

export function AuditTable({ items, showClient = true }: { items: AuditEntry[]; showClient?: boolean }) {
  if (items.length === 0) return <p className="px-5 py-6 text-sm text-muted-foreground">Nenhum registro.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
            <th className="px-4 py-2 font-medium">Quando</th>
            <th className="px-3 py-2 font-medium">Usuário</th>
            <th className="px-3 py-2 font-medium">Ação</th>
            {showClient && <th className="px-3 py-2 font-medium">Cliente</th>}
            <th className="px-3 py-2 font-medium">Objeto</th>
            <th className="px-3 py-2 font-medium">Detalhes</th>
            <th className="px-4 py-2 font-medium">IP</th>
          </tr>
        </thead>
        <tbody>
          {items.map((e) => {
            const detail = compactDetail(e.detail);
            const obj = [e.bucket, e.key].filter(Boolean).join("/");
            return (
              <tr key={e.id} className="border-b border-border/60 align-top last:border-0">
                <td className="whitespace-nowrap px-4 py-2 tabular-nums text-muted-foreground">{formatDateTime(e.at)}</td>
                <td className="whitespace-nowrap px-3 py-2">{e.userEmail ?? <span className="text-muted-foreground">— (sistema/token)</span>}</td>
                <td className="whitespace-nowrap px-3 py-2">
                  <span className={e.action === "login.failed" || e.action.endsWith(".delete") ? "text-destructive" : undefined}>
                    {actionLabel(e.action)}
                  </span>
                </td>
                {showClient && (
                  <td className="whitespace-nowrap px-3 py-2">
                    {e.clientId ? (
                      <Link href={`/clients/${e.clientId}`} className="hover:underline">
                        {e.clientName ?? e.clientId.slice(0, 8)}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                )}
                <td className="max-w-[18rem] px-3 py-2 text-xs">
                  {obj ? (
                    <span className="block truncate font-mono" title={obj}>
                      {obj}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="max-w-[18rem] px-3 py-2">
                  {detail ? (
                    <code className="block truncate rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[11px]" title={JSON.stringify(e.detail, null, 2)}>
                      {detail}
                    </code>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-muted-foreground">{e.ip || "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
