"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Eye, FileText, Folder, TriangleAlert, X } from "lucide-react";
import { endpoints } from "@/lib/api";
import { backupsApi, DEFAULT_POLICY, type Client, type ClientInput, type Policy } from "@/lib/backups";
import { documentKind, maskDocument, onlyDigits } from "@/lib/document";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input, Label, Select } from "@/components/ui/input";
import { Spinner } from "@/components/ui/misc";

const FREQ_PRESETS = [
  { hours: 24, label: "Diário (24 h)" },
  { hours: 12, label: "A cada 12 h" },
  { hours: 168, label: "Semanal (168 h)" },
];

const UNITS = [
  { label: "KB", factor: 1024 },
  { label: "MB", factor: 1024 ** 2 },
  { label: "GB", factor: 1024 ** 3 },
];

function splitSize(bytes: number): { value: string; unit: number } {
  for (let i = UNITS.length - 1; i >= 0; i--) {
    if (bytes >= UNITS[i].factor && bytes % UNITS[i].factor === 0) return { value: String(bytes / UNITS[i].factor), unit: i };
  }
  return { value: String(Math.max(0, Math.round(bytes / 1024))), unit: 0 };
}

interface FormState {
  name: string;
  document: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  notes: string;
  tags: string[];
  active: boolean;
  connectionId: string;
  bucket: string;
  prefix: string;
  policy: Policy;
  minSizeValue: string;
  minSizeUnit: number;
}

function initialState(c?: Client | null): FormState {
  const policy = c?.policy ?? DEFAULT_POLICY;
  const size = splitSize(policy.minSizeBytes);
  return {
    name: c?.name ?? "",
    document: c ? maskDocument(c.document) : "",
    contactName: c?.contactName ?? "",
    contactEmail: c?.contactEmail ?? "",
    contactPhone: c?.contactPhone ?? "",
    notes: c?.notes ?? "",
    tags: c?.tags ?? [],
    active: c?.active ?? true,
    connectionId: c?.connectionId ?? "",
    bucket: c?.bucket ?? "",
    prefix: c?.prefix ?? "",
    policy: { ...policy },
    minSizeValue: size.value,
    minSizeUnit: size.unit,
  };
}

export function ClientForm({ client }: { client?: Client | null }) {
  const router = useRouter();
  const qc = useQueryClient();
  const editing = !!client;
  const [f, setF] = useState<FormState>(() => initialState(client));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));
  const setPolicy = <K extends keyof Policy>(k: K, v: Policy[K]) => setF((s) => ({ ...s, policy: { ...s.policy, [k]: v } }));

  const conns = useQuery({ queryKey: ["connections"], queryFn: endpoints.connections });
  const connectionId = f.connectionId || (conns.data?.items.length === 1 ? conns.data.items[0].id : "");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const doc = onlyDigits(f.document);
    if (!f.name.trim()) return setError("Informe o nome do cliente.");
    if (doc && doc.length !== 11 && doc.length !== 14) return setError("CNPJ deve ter 14 dígitos e CPF 11.");
    if (!connectionId || !f.bucket) return setError("Escolha a conexão e o bucket onde ficam os backups.");
    const minSize = Math.round(Number(f.minSizeValue || 0) * UNITS[f.minSizeUnit].factor);
    let prefix = f.prefix.trim().replace(/^\/+/, "");
    if (prefix && !prefix.endsWith("/")) prefix += "/";
    const input: ClientInput = {
      name: f.name.trim(),
      document: doc,
      contactName: f.contactName.trim(),
      contactEmail: f.contactEmail.trim(),
      contactPhone: f.contactPhone.trim(),
      notes: f.notes,
      tags: f.tags,
      active: f.active,
      connectionId,
      bucket: f.bucket,
      prefix,
      policy: {
        ...f.policy,
        minSizeBytes: Number.isFinite(minSize) ? minSize : 0,
        retentionMinKeep: Math.max(1, f.policy.retentionMinKeep),
        filePattern: f.policy.filePattern.trim() || "*",
      },
    };
    setBusy(true);
    try {
      const saved = editing ? await backupsApi.updateClient(client!.id, input) : await backupsApi.createClient(input);
      toast.success(editing ? "Cliente atualizado" : "Cliente cadastrado — a primeira varredura foi agendada");
      qc.invalidateQueries({ queryKey: ["clients"] });
      qc.invalidateQueries({ queryKey: ["client", saved.id] });
      qc.invalidateQueries({ queryKey: ["backups"] });
      router.push(`/clients/${saved.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const freqPreset = FREQ_PRESETS.some((p) => p.hours === f.policy.expectedEveryHours) ? String(f.policy.expectedEveryHours) : "custom";
  const docDigits = onlyDigits(f.document);

  return (
    <form onSubmit={submit} className="space-y-6" noValidate>
      {/* ---------------------------------------------------------------- Dados */}
      <Card>
        <CardHeader>
          <CardTitle>Dados do cliente</CardTitle>
          <CardDescription>Identificação e contato responsável pelo backup.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <Field id="c-name" label="Nome / razão social" className="md:col-span-2">
            <Input id="c-name" value={f.name} onChange={(e) => set("name", e.target.value)} required autoFocus={!editing} />
          </Field>
          <Field id="c-doc" label="CNPJ / CPF" hint={documentKind(docDigits) ?? (docDigits ? "Incompleto" : "Opcional")}>
            <Input
              id="c-doc"
              inputMode="numeric"
              value={f.document}
              onChange={(e) => set("document", maskDocument(e.target.value))}
              placeholder="00.000.000/0000-00"
            />
          </Field>
          <Field id="c-contact" label="Contato">
            <Input id="c-contact" value={f.contactName} onChange={(e) => set("contactName", e.target.value)} placeholder="Nome do responsável" />
          </Field>
          <Field id="c-email" label="E-mail do contato">
            <Input id="c-email" type="email" value={f.contactEmail} onChange={(e) => set("contactEmail", e.target.value)} />
          </Field>
          <Field id="c-phone" label="Telefone">
            <Input id="c-phone" type="tel" value={f.contactPhone} onChange={(e) => set("contactPhone", e.target.value)} placeholder="(00) 00000-0000" />
          </Field>
          <Field id="c-tags" label="Tags" className="md:col-span-2" hint="Enter ou vírgula para adicionar (ex.: plano-ouro, firebird, filial-sp)">
            <TagsInput id="c-tags" value={f.tags} onChange={(t) => set("tags", t)} />
          </Field>
          <Field id="c-notes" label="Observações" className="md:col-span-2">
            <textarea
              id="c-notes"
              value={f.notes}
              onChange={(e) => set("notes", e.target.value)}
              rows={3}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </Field>
          <label className="flex items-center gap-2 text-sm md:col-span-2">
            <Checkbox checked={f.active} onCheckedChange={(v) => set("active", v === true)} />
            Cliente ativo (monitorar backups e enviar alertas)
          </label>
        </CardContent>
      </Card>

      {/* ---------------------------------------------------------------- Local */}
      <Card>
        <CardHeader>
          <CardTitle>Local do backup</CardTitle>
          <CardDescription>Onde os arquivos de backup deste cliente ficam no storage.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <Field id="c-conn" label="Conexão">
            <Select
              id="c-conn"
              value={connectionId}
              onChange={(e) => setF((s) => ({ ...s, connectionId: e.target.value, bucket: "" }))}
              disabled={conns.isLoading}
            >
              <option value="">{conns.isLoading ? "Carregando…" : "Selecione…"}</option>
              {conns.data?.items.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            {conns.data?.items.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Nenhuma conexão.{" "}
                <Link href="/connections?new=1" className="text-primary hover:underline">
                  Adicionar conexão
                </Link>
              </p>
            )}
          </Field>
          <BucketField connectionId={connectionId} value={f.bucket} onChange={(b) => set("bucket", b)} />
          <Field
            id="c-prefix"
            label="Prefixo (pasta)"
            className="md:col-span-2"
            hint="Pasta dentro do bucket. Deixe vazio para usar a raiz."
          >
            <div className="flex flex-wrap gap-2">
              <Input
                id="c-prefix"
                value={f.prefix}
                onChange={(e) => set("prefix", e.target.value)}
                placeholder="clientes/12345678000199/"
                className="min-w-[14rem] flex-1 font-mono text-xs"
              />
              <Button
                type="button"
                variant="outline"
                size="md"
                disabled={!docDigits}
                onClick={() => set("prefix", `clientes/${docDigits}/`)}
                title={docDigits ? undefined : "Preencha o CNPJ/CPF primeiro"}
              >
                Sugestão: clientes/{docDigits || "<documento>"}/
              </Button>
            </div>
          </Field>
          <div className="md:col-span-2">
            <PrefixPreview connectionId={connectionId} bucket={f.bucket} prefix={f.prefix} />
          </div>
        </CardContent>
      </Card>

      {/* ---------------------------------------------------------------- Política */}
      <Card>
        <CardHeader>
          <CardTitle>Política de backup</CardTitle>
          <CardDescription>Define quando o cliente fica atrasado ou suspeito, e por quanto tempo os backups são mantidos.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <Field id="p-freq" label="Frequência esperada">
            <div className="flex gap-2">
              <Select
                id="p-freq"
                value={freqPreset}
                onChange={(e) => {
                  if (e.target.value !== "custom") setPolicy("expectedEveryHours", Number(e.target.value));
                }}
                className="flex-1"
              >
                {FREQ_PRESETS.map((p) => (
                  <option key={p.hours} value={p.hours}>
                    {p.label}
                  </option>
                ))}
                <option value="custom">Personalizada</option>
              </Select>
              <div className="relative w-28">
                <Input
                  type="number"
                  min={1}
                  aria-label="Horas entre backups"
                  value={f.policy.expectedEveryHours}
                  onChange={(e) => setPolicy("expectedEveryHours", Math.max(1, Number(e.target.value) || 1))}
                  className="pr-7"
                />
                <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">h</span>
              </div>
            </div>
          </Field>
          <Field id="p-grace" label="Tolerância" hint="Horas extras antes de marcar como atrasado.">
            <NumberWithSuffix id="p-grace" value={f.policy.graceHours} min={0} suffix="h" onChange={(v) => setPolicy("graceHours", v)} />
          </Field>
          <Field id="p-min" label="Tamanho mínimo" hint="Backups menores que isso ficam suspeitos.">
            <div className="flex gap-2">
              <Input
                id="p-min"
                type="number"
                min={0}
                step="any"
                value={f.minSizeValue}
                onChange={(e) => set("minSizeValue", e.target.value)}
                className="flex-1"
              />
              <Select aria-label="Unidade" value={f.minSizeUnit} onChange={(e) => set("minSizeUnit", Number(e.target.value))} className="w-20">
                {UNITS.map((u, i) => (
                  <option key={u.label} value={i}>
                    {u.label}
                  </option>
                ))}
              </Select>
            </div>
          </Field>
          <Field id="p-drop" label="Queda de tamanho" hint="Alerta se o último backup for X% menor que a média dos 7 anteriores. 0 desliga.">
            <NumberWithSuffix id="p-drop" value={f.policy.sizeDropPct} min={0} max={100} suffix="%" onChange={(v) => setPolicy("sizeDropPct", v)} />
          </Field>
          <Field
            id="p-pattern"
            label="Padrão de arquivos"
            className="md:col-span-2"
            hint="Globs separados por vírgula, aplicados ao nome do arquivo (sem diferenciar maiúsculas). Exemplos: *.bak, *.fbk, *.zip, *.7z, *.sql.gz"
          >
            <Input
              id="p-pattern"
              value={f.policy.filePattern}
              onChange={(e) => setPolicy("filePattern", e.target.value)}
              placeholder="*"
              className="font-mono text-xs"
            />
            <div className="flex flex-wrap gap-1">
              {["*.bak", "*.fbk", "*.zip", "*.7z", "*.sql.gz"].map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => {
                    const cur = f.policy.filePattern.split(",").map((s) => s.trim()).filter((s) => s && s !== "*");
                    if (!cur.includes(g)) setPolicy("filePattern", [...cur, g].join(", "));
                  }}
                  className="rounded border border-border px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground hover:border-primary hover:text-primary"
                >
                  + {g}
                </button>
              ))}
            </div>
          </Field>

          <div className="border-t border-border pt-4 md:col-span-2">
            <p className="text-sm font-medium">Retenção</p>
          </div>
          <Field id="p-ret" label="Manter backups por" hint="0 = manter tudo.">
            <NumberWithSuffix id="p-ret" value={f.policy.retentionDays} min={0} suffix="dias" onChange={(v) => setPolicy("retentionDays", v)} />
          </Field>
          <Field id="p-keep" label="Manter sempre os mais recentes" hint="Nunca apaga os N últimos, mesmo se antigos (mínimo 1).">
            <NumberWithSuffix
              id="p-keep"
              value={f.policy.retentionMinKeep}
              min={1}
              suffix="backups"
              onChange={(v) => setPolicy("retentionMinKeep", Math.max(1, v))}
            />
          </Field>
          <div className="md:col-span-2">
            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                className="mt-0.5"
                checked={f.policy.retentionAuto}
                onCheckedChange={(v) => setPolicy("retentionAuto", v === true)}
                disabled={f.policy.retentionDays === 0}
              />
              <span>
                Aplicar retenção automaticamente após cada varredura
                {f.policy.retentionDays === 0 && <span className="block text-xs text-muted-foreground">Defina os dias de retenção para habilitar.</span>}
              </span>
            </label>
            {f.policy.retentionAuto && f.policy.retentionDays > 0 && (
              <p className="mt-2 flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Atenção: arquivos de backup com mais de {f.policy.retentionDays} dias serão <strong>apagados do storage</strong> automaticamente,
                  mantendo sempre os {Math.max(1, f.policy.retentionMinKeep)} mais recentes. Essa ação não pode ser desfeita.
                </span>
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancelar
        </Button>
        <Button type="submit" disabled={busy}>
          {busy && <Spinner className="text-primary-foreground" />}
          {editing ? "Salvar alterações" : "Cadastrar cliente"}
        </Button>
      </div>
    </form>
  );
}

function Field({
  id,
  label,
  hint,
  className,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("grid content-start gap-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function NumberWithSuffix({
  id,
  value,
  onChange,
  min,
  max,
  suffix,
}: {
  id: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  suffix: string;
}) {
  return (
    <div className="relative">
      <Input
        id={id}
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          let v = Number(e.target.value);
          if (!Number.isFinite(v)) v = 0;
          if (min !== undefined) v = Math.max(min, v);
          if (max !== undefined) v = Math.min(max, v);
          onChange(Math.round(v));
        }}
        className="pr-16"
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{suffix}</span>
    </div>
  );
}

function TagsInput({ id, value, onChange }: { id: string; value: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState("");
  function add(raw: string) {
    const parts = raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (!parts.length) return;
    onChange([...new Set([...value, ...parts])]);
    setText("");
  }
  return (
    <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1 shadow-xs focus-within:ring-2 focus-within:ring-ring">
      {value.map((t) => (
        <span key={t} className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs">
          {t}
          <button type="button" onClick={() => onChange(value.filter((x) => x !== t))} aria-label={`Remover tag ${t}`} className="opacity-60 hover:opacity-100">
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        id={id}
        value={text}
        onChange={(e) => {
          if (e.target.value.endsWith(",")) add(e.target.value);
          else setText(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add(text);
          } else if (e.key === "Backspace" && !text && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={() => add(text)}
        className="min-w-[8rem] flex-1 bg-transparent py-0.5 text-sm outline-none"
      />
    </div>
  );
}

function BucketField({ connectionId, value, onChange }: { connectionId: string; value: string; onChange: (b: string) => void }) {
  const buckets = useQuery({
    queryKey: ["buckets", connectionId],
    queryFn: () => endpoints.buckets(connectionId),
    enabled: !!connectionId,
    staleTime: 60_000,
  });
  const names = buckets.data?.items.map((b) => b.name) ?? [];
  const missing = value && buckets.data && !names.includes(value);
  return (
    <Field id="c-bucket" label="Bucket">
      <Select id="c-bucket" value={value} onChange={(e) => onChange(e.target.value)} disabled={!connectionId || buckets.isLoading}>
        <option value="">{!connectionId ? "Escolha a conexão primeiro" : buckets.isLoading ? "Carregando…" : "Selecione…"}</option>
        {missing && <option value={value}>{value} (não encontrado)</option>}
        {names.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </Select>
      {buckets.isError && <p className="text-xs text-destructive">Falha ao listar buckets: {(buckets.error as Error).message}</p>}
    </Field>
  );
}

function PrefixPreview({ connectionId, bucket, prefix }: { connectionId: string; bucket: string; prefix: string }) {
  const [requested, setRequested] = useState<string | null>(null);
  let p = prefix.trim().replace(/^\/+/, "");
  if (p && !p.endsWith("/")) p += "/";
  const key = `${connectionId}|${bucket}|${p}`;
  const q = useQuery({
    queryKey: ["prefix-preview", connectionId, bucket, p],
    queryFn: () => endpoints.objects(connectionId, bucket, p, null, 20),
    enabled: requested === key && !!connectionId && !!bucket,
  });
  const canPreview = !!connectionId && !!bucket;
  return (
    <div className="space-y-2">
      <Button type="button" variant="outline" size="sm" disabled={!canPreview} onClick={() => setRequested(key)}>
        <Eye /> Pré-visualizar conteúdo
      </Button>
      {requested === key && (
        <div className="rounded-md border border-border bg-muted/30 p-3 text-xs">
          {q.isLoading ? (
            <Spinner />
          ) : q.isError ? (
            <p className="text-destructive">{(q.error as Error).message}</p>
          ) : q.data && q.data.folders.length + q.data.objects.length === 0 ? (
            <p className="text-muted-foreground">Nenhum arquivo neste local ainda. Tudo bem — o cliente pode começar a enviar depois.</p>
          ) : (
            <ul className="space-y-1">
              {q.data?.folders.map((fo) => (
                <li key={fo.prefix} className="flex items-center gap-2">
                  <Folder className="h-3.5 w-3.5 text-muted-foreground" /> {fo.name}/
                </li>
              ))}
              {q.data?.objects.map((o) => (
                <li key={o.key} className="flex items-center gap-2">
                  <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{o.name}</span>
                  <span className="tabular-nums text-muted-foreground">{formatBytes(o.size)}</span>
                </li>
              ))}
              {q.data?.nextCursor && <li className="text-muted-foreground">… e mais</li>}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
