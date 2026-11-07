"use client";
import { Columns3, LayoutGrid, List } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ViewMode } from "./types";

const OPTIONS: { value: ViewMode; label: string; icon: typeof List }[] = [
  { value: "list", label: "Lista", icon: List },
  { value: "gallery", label: "Galeria", icon: LayoutGrid },
  { value: "columns", label: "Colunas", icon: Columns3 },
];

export function ViewSwitcher({ value, onChange }: { value: ViewMode; onChange: (v: ViewMode) => void }) {
  return (
    <div role="radiogroup" aria-label="Modo de visualização" className="flex rounded-md border border-border bg-surface p-0.5">
      {OPTIONS.map(({ value: v, label, icon: Icon }) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          title={label}
          onClick={() => onChange(v)}
          className={cn(
            "flex h-7 items-center gap-1.5 rounded px-2 text-xs transition-colors",
            value === v ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon className="h-3.5 w-3.5" />
          <span className="hidden lg:inline">{label}</span>
        </button>
      ))}
    </div>
  );
}

const STORAGE_KEY = "ioh-view";

export function readStoredView(): ViewMode | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "list" || v === "gallery" || v === "columns" ? v : null;
  } catch {
    return null;
  }
}

export function storeView(v: ViewMode) {
  try {
    localStorage.setItem(STORAGE_KEY, v);
  } catch {
    /* ignore */
  }
}

export function parseView(v: string | null): ViewMode | null {
  return v === "list" || v === "gallery" || v === "columns" ? v : null;
}
