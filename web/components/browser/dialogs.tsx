"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { Spinner } from "@/components/ui/misc";

export function PromptDialog({
  open,
  onOpenChange,
  title,
  description,
  label,
  initial = "",
  confirmLabel,
  validate,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  label: string;
  initial?: string;
  confirmLabel: string;
  validate?: (v: string) => string | null;
  onConfirm: (v: string) => Promise<void>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {open && (
          <PromptForm
            title={title}
            description={description}
            label={label}
            initial={initial}
            confirmLabel={confirmLabel}
            validate={validate}
            onConfirm={onConfirm}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function PromptForm({
  title,
  description,
  label,
  initial,
  confirmLabel,
  validate,
  onConfirm,
  onDone,
}: {
  title: string;
  description?: string;
  label: string;
  initial: string;
  confirmLabel: string;
  validate?: (v: string) => string | null;
  onConfirm: (v: string) => Promise<void>;
  onDone: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="grid gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const v = value.trim();
        const err = validate?.(v) ?? (v ? null : "Informe um valor.");
        if (err) return setError(err);
        setBusy(true);
        try {
          await onConfirm(v);
          onDone();
        } catch (ex) {
          setError((ex as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        {description && <DialogDescription>{description}</DialogDescription>}
      </DialogHeader>
      <div className="grid gap-2">
        <Label htmlFor="prompt-input">{label}</Label>
        <Input
          id="prompt-input"
          autoFocus
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          onFocus={(e) => {
            const dot = e.target.value.lastIndexOf(".");
            e.target.setSelectionRange(0, dot > 0 ? dot : e.target.value.length);
          }}
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancelar
        </Button>
        <Button type="submit" disabled={busy}>
          {busy && <Spinner className="text-primary-foreground" />}
          {confirmLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription asChild>
            <div>{description}</div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                onOpenChange(false);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy && <Spinner className="text-white" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
