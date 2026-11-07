"use client";
import { useState } from "react";
import { toast } from "sonner";
import { backupsApi } from "@/lib/backups";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { Spinner } from "@/components/ui/misc";

export function ChangePasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>{open && <Form onDone={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  );
}

function Form({ onDone }: { onDone: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="grid gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (next.length < 8) return setError("A nova senha precisa ter pelo menos 8 caracteres.");
        if (next !== confirm) return setError("A confirmação não confere.");
        setBusy(true);
        setError(null);
        try {
          await backupsApi.changePassword(current, next);
          toast.success("Senha alterada");
          onDone();
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <DialogHeader>
        <DialogTitle>Alterar senha</DialogTitle>
        <DialogDescription>Use pelo menos 8 caracteres.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-2">
        <Label htmlFor="pw-current">Senha atual</Label>
        <Input id="pw-current" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="pw-new">Nova senha</Label>
        <Input id="pw-new" type="password" autoComplete="new-password" required value={next} onChange={(e) => setNext(e.target.value)} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="pw-confirm">Confirmar nova senha</Label>
        <Input id="pw-confirm" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
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
