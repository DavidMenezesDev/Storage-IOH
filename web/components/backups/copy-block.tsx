"use client";
import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export async function copyText(text: string, okMsg = "Copiado") {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(okMsg);
    return true;
  } catch {
    toast.error("Não foi possível copiar — selecione e copie manualmente.");
    return false;
  }
}

export function CopyButton({ text, label = "Copiar", className }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={className}
      onClick={async () => {
        if (await copyText(text)) {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        }
      }}
    >
      {done ? <Check /> : <Copy />} {label}
    </Button>
  );
}

/** Bloco de código/texto com botão de copiar. */
export function CopyBlock({ title, text, className }: { title?: string; text: string; className?: string }) {
  return (
    <div className={cn("overflow-hidden rounded-lg border border-border", className)}>
      <div className="flex items-center gap-2 border-b border-border bg-muted/50 px-3 py-1.5">
        {title && <span className="text-xs font-medium">{title}</span>}
        <CopyButton text={text} className="ml-auto h-7" />
      </div>
      <pre className="overflow-x-auto bg-surface p-3 font-mono text-[12px] leading-relaxed">
        <code>{text}</code>
      </pre>
    </div>
  );
}

/** Campo somente-leitura com valor copiável (ex.: URL, token). */
export function CopyField({ value, label, secret }: { value: string; label: string; secret?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <input
        readOnly
        value={value}
        aria-label={label}
        onFocus={(e) => e.target.select()}
        className={cn(
          "h-9 min-w-0 flex-1 rounded-md border border-border bg-muted/40 px-3 font-mono text-xs",
          secret && "tracking-tight",
        )}
      />
      <CopyButton text={value} />
    </div>
  );
}
