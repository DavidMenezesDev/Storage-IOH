"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Pencil, Plus, Trash2, Users } from "lucide-react";
import type { Role, User } from "@/lib/api";
import { backupsApi } from "@/lib/backups";
import { ROLE_DESCRIPTION, ROLE_LABEL, useAuth } from "@/lib/auth";
import { formatDateTime, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { EmptyState, Spinner } from "@/components/ui/misc";
import { ConfirmDialog } from "@/components/browser/dialogs";

const ROLES: Role[] = ["viewer", "operator", "admin"];
const ROLE_TONE: Record<Role, "neutral" | "info" | "warning"> = { viewer: "neutral", operator: "info", admin: "warning" };

export function UsersView() {
  const qc = useQueryClient();
  const { user: me } = useAuth();
  const users = useQuery({ queryKey: ["users"], queryFn: backupsApi.users });
  const [editing, setEditing] = useState<User | "new" | null>(null);
  const [deleting, setDeleting] = useState<User | null>(null);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-8">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1">
            <h1 className="text-xl font-semibold tracking-tight">Usuários</h1>
            <p className="text-sm text-muted-foreground">Quem acessa o Storage-IOH e o que cada um pode fazer.</p>
          </div>
          <Button onClick={() => setEditing("new")}>
            <Plus /> Novo usuário
          </Button>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          {ROLES.map((r) => (
            <Card key={r} className="p-4">
              <Badge tone={ROLE_TONE[r]}>{ROLE_LABEL[r]}</Badge>
              <p className="mt-2 text-xs text-muted-foreground">{ROLE_DESCRIPTION[r]}</p>
            </Card>
          ))}
        </div>

        <Card className="overflow-hidden">
          {users.isLoading ? (
            <div className="flex justify-center py-12">
              <Spinner className="h-6 w-6" />
            </div>
          ) : users.isError ? (
            <EmptyState title="Erro ao carregar usuários" description={(users.error as Error).message} />
          ) : users.data!.items.length === 0 ? (
            <EmptyState icon={<Users />} title="Nenhum usuário" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                    <th className="px-4 py-2 font-medium">Usuário</th>
                    <th className="px-3 py-2 font-medium">Papel</th>
                    <th className="px-3 py-2 font-medium">Situação</th>
                    <th className="px-3 py-2 font-medium">Último acesso</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {users.data!.items.map((u) => (
                    <tr key={u.id} className={cn("border-b border-border/60 last:border-0", !u.active && "text-muted-foreground")}>
                      <td className="px-4 py-2.5">
                        <div className="font-medium">
                          {u.name || u.email}
                          {u.id === me?.id && <span className="ml-2 text-xs font-normal text-muted-foreground">(você)</span>}
                        </div>
                        {u.name && <div className="text-xs text-muted-foreground">{u.email}</div>}
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge tone={ROLE_TONE[u.role]}>{ROLE_LABEL[u.role]}</Badge>
                      </td>
                      <td className="px-3 py-2.5">{u.active ? <Badge tone="good">Ativo</Badge> : <Badge>Desativado</Badge>}</td>
                      <td className="whitespace-nowrap px-3 py-2.5" title={formatDateTime(u.lastLoginAt)}>
                        {u.lastLoginAt ? formatRelative(u.lastLoginAt) : "nunca"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-1.5 text-right">
                        <Button variant="ghost" size="sm" onClick={() => setEditing(u)}>
                          <Pencil /> Editar
                        </Button>
                        {u.id !== me?.id && (
                          <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setDeleting(u)}>
                            <Trash2 /> Excluir
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          {editing !== null && (
            <UserForm
              user={editing === "new" ? null : editing}
              isSelf={editing !== "new" && editing.id === me?.id}
              onCancel={() => setEditing(null)}
              onSaved={() => {
                setEditing(null);
                qc.invalidateQueries({ queryKey: ["users"] });
                qc.invalidateQueries({ queryKey: ["me"] });
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Excluir ${deleting?.name || deleting?.email}?`}
        description="O usuário perde o acesso imediatamente. Os registros de auditoria dele são mantidos."
        confirmLabel="Excluir"
        destructive
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await backupsApi.deleteUser(deleting.id);
            toast.success("Usuário excluído");
            qc.invalidateQueries({ queryKey: ["users"] });
          } catch (e) {
            toast.error((e as Error).message);
          }
        }}
      />
    </div>
  );
}

function UserForm({ user, isSelf, onCancel, onSaved }: { user: User | null; isSelf: boolean; onCancel: () => void; onSaved: () => void }) {
  const [email, setEmail] = useState(user?.email ?? "");
  const [name, setName] = useState(user?.name ?? "");
  const [role, setRole] = useState<Role>(user?.role ?? "operator");
  const [password, setPassword] = useState("");
  const [active, setActive] = useState(user?.active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="grid gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        if (!user && (!email.trim() || password.length < 8)) return setError("Informe o e-mail e uma senha com pelo menos 8 caracteres.");
        if (user && password && password.length < 8) return setError("A nova senha precisa ter pelo menos 8 caracteres.");
        setBusy(true);
        try {
          if (user) {
            await backupsApi.updateUser(user.id, { name: name.trim(), role, active, password: password || undefined });
            toast.success("Usuário atualizado");
          } else {
            await backupsApi.createUser({ email: email.trim(), name: name.trim(), role, password });
            toast.success("Usuário criado");
          }
          onSaved();
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <DialogHeader>
        <DialogTitle>{user ? "Editar usuário" : "Novo usuário"}</DialogTitle>
        <DialogDescription>{user ? user.email : "O usuário entra com o e-mail e a senha definidos aqui."}</DialogDescription>
      </DialogHeader>
      {!user && (
        <div className="grid gap-1.5">
          <Label htmlFor="u-email">E-mail</Label>
          <Input id="u-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" required autoFocus />
        </div>
      )}
      <div className="grid gap-1.5">
        <Label htmlFor="u-name">Nome</Label>
        <Input id="u-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus={!!user} />
      </div>
      <fieldset className="grid gap-2" disabled={isSelf}>
        <legend className="mb-1 text-sm font-medium">Papel</legend>
        {ROLES.map((r) => (
          <label
            key={r}
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2",
              role === r ? "border-primary bg-primary/8" : "border-border",
              isSelf && "cursor-not-allowed opacity-70",
            )}
          >
            <input type="radio" name="u-role" value={r} checked={role === r} onChange={() => setRole(r)} className="mt-1 accent-[var(--primary)]" />
            <span>
              <span className="block text-sm font-medium">{ROLE_LABEL[r]}</span>
              <span className="block text-xs text-muted-foreground">{ROLE_DESCRIPTION[r]}</span>
            </span>
          </label>
        ))}
        {isSelf && <p className="text-xs text-muted-foreground">Você não pode alterar o próprio papel.</p>}
      </fieldset>
      <div className="grid gap-1.5">
        <Label htmlFor="u-pass">{user ? "Nova senha (opcional)" : "Senha"}</Label>
        <Input id="u-pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" placeholder={user ? "Deixe vazio para manter" : "Mínimo 8 caracteres"} />
      </div>
      {user && !isSelf && (
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={active} onCheckedChange={(v) => setActive(v === true)} />
          Ativo (desmarque para bloquear o acesso)
        </label>
      )}
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
    </form>
  );
}
