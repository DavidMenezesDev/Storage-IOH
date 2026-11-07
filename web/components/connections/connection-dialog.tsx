"use client";
import { useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { endpoints, type Connection, type ConnectionInput, type Provider } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Label, Select } from "@/components/ui/input";
import { Spinner } from "@/components/ui/misc";

interface Preset {
  label: string;
  endpoint: string;
  endpointHint: string;
  region: string;
  forcePathStyle: boolean;
}

export const PRESETS: Record<Provider, Preset> = {
  s3: { label: "Amazon S3", endpoint: "", endpointHint: "Deixe vazio para AWS", region: "us-east-1", forcePathStyle: false },
  r2: {
    label: "Cloudflare R2",
    endpoint: "https://<ACCOUNT_ID>.r2.cloudflarestorage.com",
    endpointHint: "https://<ACCOUNT_ID>.r2.cloudflarestorage.com",
    region: "auto",
    forcePathStyle: false,
  },
  minio: { label: "MinIO", endpoint: "http://minio:9000", endpointHint: "http://host:9000", region: "us-east-1", forcePathStyle: true },
  custom: { label: "Outro (S3-compatível)", endpoint: "", endpointHint: "https://s3.exemplo.com", region: "us-east-1", forcePathStyle: true },
};

type Form = Required<Omit<ConnectionInput, "secretAccessKey">> & { secretAccessKey: string };

function fromConnection(c?: Connection | null): Form {
  if (!c) {
    const p = PRESETS.minio;
    return {
      name: "",
      provider: "minio",
      endpoint: p.endpoint,
      region: p.region,
      forcePathStyle: p.forcePathStyle,
      accessKeyId: "",
      secretAccessKey: "",
      indexEnabled: true,
      syncIntervalMinutes: 360,
    };
  }
  return {
    name: c.name,
    provider: c.provider,
    endpoint: c.endpoint,
    region: c.region,
    forcePathStyle: c.forcePathStyle,
    accessKeyId: c.accessKeyId,
    secretAccessKey: "",
    indexEnabled: c.indexEnabled,
    syncIntervalMinutes: c.syncIntervalMinutes,
  };
}

const INTERVALS = [
  { v: 0, l: "Somente manual" },
  { v: 15, l: "A cada 15 minutos" },
  { v: 60, l: "A cada hora" },
  { v: 360, l: "A cada 6 horas" },
  { v: 1440, l: "Diariamente" },
];

export function ConnectionDialog({
  open,
  onOpenChange,
  connection,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  connection?: Connection | null;
  onSaved: (c: Connection) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        {open && <ConnectionForm key={connection?.id ?? "new"} connection={connection} onCancel={() => onOpenChange(false)} onSaved={onSaved} />}
      </DialogContent>
    </Dialog>
  );
}

function ConnectionForm({
  connection,
  onCancel,
  onSaved,
}: {
  connection?: Connection | null;
  onCancel: () => void;
  onSaved: (c: Connection) => void;
}) {
  const editing = !!connection;
  const [f, setF] = useState<Form>(() => fromConnection(connection));
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; msg: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setF((prev) => ({ ...prev, [k]: v }));
    setTest(null);
  };

  function pickProvider(p: Provider) {
    const preset = PRESETS[p];
    setF((prev) => ({ ...prev, provider: p, endpoint: preset.endpoint, region: preset.region, forcePathStyle: preset.forcePathStyle }));
    setTest(null);
  }

  function payload(): Partial<ConnectionInput> {
    const body: Partial<ConnectionInput> = { ...f, endpoint: f.endpoint.trim(), name: f.name.trim(), accessKeyId: f.accessKeyId.trim() };
    if (editing && !f.secretAccessKey) delete body.secretAccessKey;
    return body;
  }

  async function runTest() {
    setTesting(true);
    setTest(null);
    try {
      const body = editing && !f.secretAccessKey ? { ...payload(), id: connection!.id } : payload();
      const r = await endpoints.testConnection(body);
      setTest(r.ok ? { ok: true, msg: `Conexão OK — ${r.bucketCount} bucket(s) encontrados.` } : { ok: false, msg: r.error ?? "Falha na conexão." });
    } catch (err) {
      setTest({ ok: false, msg: (err as Error).message });
    } finally {
      setTesting(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!f.name.trim()) return setError("Informe um nome.");
    if (!f.accessKeyId.trim()) return setError("Informe o Access Key ID.");
    if (!editing && !f.secretAccessKey) return setError("Informe a Secret Access Key.");
    if (f.endpoint.includes("<ACCOUNT_ID>")) return setError("Substitua <ACCOUNT_ID> pelo ID da sua conta Cloudflare.");
    setSaving(true);
    try {
      const saved = editing
        ? await endpoints.updateConnection(connection!.id, payload())
        : await endpoints.createConnection(payload() as ConnectionInput);
      onSaved(saved);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const preset = PRESETS[f.provider];

  return (
    <form onSubmit={submit} className="grid gap-5">
      <DialogHeader>
        <DialogTitle>{editing ? "Editar conexão" : "Nova conexão"}</DialogTitle>
        <DialogDescription>As credenciais são criptografadas no servidor e nunca retornam para o navegador.</DialogDescription>
      </DialogHeader>

      <div role="radiogroup" aria-label="Provedor" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(Object.keys(PRESETS) as Provider[]).map((p) => (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={f.provider === p}
            onClick={() => pickProvider(p)}
            className={cn(
              "rounded-lg border px-3 py-2 text-left text-xs transition-colors",
              f.provider === p ? "border-primary bg-primary/8 font-medium" : "border-border hover:bg-muted",
            )}
          >
            {PRESETS[p].label}
          </button>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome" id="c-name" className="sm:col-span-2">
          <Input id="c-name" value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Ex.: Produção" autoFocus />
        </Field>
        <Field label="Endpoint" id="c-endpoint" className="sm:col-span-2" hint={preset.endpointHint}>
          <Input id="c-endpoint" value={f.endpoint} onChange={(e) => set("endpoint", e.target.value)} placeholder={preset.endpointHint} />
        </Field>
        <Field label="Região" id="c-region">
          <Input id="c-region" value={f.region} onChange={(e) => set("region", e.target.value)} />
        </Field>
        <div className="flex items-end pb-2">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={f.forcePathStyle} onCheckedChange={(c) => set("forcePathStyle", c === true)} />
            Path-style (MinIO e afins)
          </label>
        </div>
        <Field label="Access Key ID" id="c-ak">
          <Input id="c-ak" value={f.accessKeyId} onChange={(e) => set("accessKeyId", e.target.value)} autoComplete="off" spellCheck={false} />
        </Field>
        <Field label="Secret Access Key" id="c-sk" hint={editing ? "Deixe vazio para manter a atual" : undefined}>
          <Input
            id="c-sk"
            type="password"
            value={f.secretAccessKey}
            onChange={(e) => set("secretAccessKey", e.target.value)}
            autoComplete="new-password"
            placeholder={editing ? "••••••••" : ""}
          />
        </Field>
      </div>

      <div className="grid gap-4 rounded-lg border border-border p-4 sm:grid-cols-2">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={f.indexEnabled} onCheckedChange={(c) => set("indexEnabled", c === true)} />
          Indexar para busca e dashboard
        </label>
        <Field label="Sincronização automática" id="c-int">
          <Select
            id="c-int"
            value={f.syncIntervalMinutes}
            disabled={!f.indexEnabled}
            onChange={(e) => set("syncIntervalMinutes", Number(e.target.value))}
          >
            {INTERVALS.map((i) => (
              <option key={i.v} value={i.v}>
                {i.l}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {test && (
        <p
          role="status"
          className={cn(
            "flex items-start gap-2 rounded-md px-3 py-2 text-sm",
            test.ok ? "bg-good/10 text-good" : "bg-destructive/10 text-destructive",
          )}
        >
          {test.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" />}
          {test.msg}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <DialogFooter className="sm:justify-between">
        <Button type="button" variant="outline" onClick={runTest} disabled={testing}>
          {testing && <Spinner />}
          Testar conexão
        </Button>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="submit" disabled={saving}>
            {saving && <Spinner className="text-primary-foreground" />}
            {editing ? "Salvar" : "Adicionar"}
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}

function Field({
  label,
  id,
  hint,
  className,
  children,
}: {
  label: string;
  id: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
