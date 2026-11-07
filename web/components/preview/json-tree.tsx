"use client";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export function JsonTree({ value }: { value: Json }) {
  return (
    <div className="overflow-auto p-4 font-mono text-[12.5px] leading-relaxed">
      <Node name={null} value={value} depth={0} />
    </div>
  );
}

function Node({ name, value, depth }: { name: string | null; value: Json; depth: number }) {
  const isObj = value !== null && typeof value === "object";
  const [open, setOpen] = useState(depth < 2);
  const label = name !== null && <span className="text-[var(--series-7)]">{JSON.stringify(name)}: </span>;

  if (!isObj) {
    return (
      <div className="pl-4">
        {label}
        <Primitive value={value} />
      </div>
    );
  }
  const entries: [string, Json][] = Array.isArray(value) ? value.map((v, i) => [String(i), v]) : Object.entries(value);
  const [ob, cb] = Array.isArray(value) ? ["[", "]"] : ["{", "}"];
  return (
    <div className={cn(depth > 0 && "pl-4")}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="-ml-4 inline-flex items-center hover:opacity-80">
        <ChevronRight className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", open && "rotate-90")} />
        {label}
        <span className="text-muted-foreground">
          {ob}
          {!open && ` … ${entries.length} ${Array.isArray(value) ? (entries.length === 1 ? "item" : "itens") : entries.length === 1 ? "chave" : "chaves"} ${cb}`}
        </span>
      </button>
      {open && (
        <>
          {entries.slice(0, 1000).map(([k, v]) => (
            <Node key={k} name={Array.isArray(value) ? null : k} value={v} depth={depth + 1} />
          ))}
          {entries.length > 1000 && <div className="pl-4 text-muted-foreground">… mais {entries.length - 1000}</div>}
          <div className="text-muted-foreground">{cb}</div>
        </>
      )}
    </div>
  );
}

function Primitive({ value }: { value: Json }) {
  if (value === null) return <span className="text-muted-foreground">null</span>;
  if (typeof value === "string") return <span className="break-all text-[var(--series-3)]">{JSON.stringify(value)}</span>;
  if (typeof value === "number") return <span className="text-[var(--series-1)]">{value}</span>;
  return <span className="text-[var(--series-2)]">{String(value)}</span>;
}

export type { Json };
