"use client";
import { ChevronRight } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import type { ObjectItem } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import { useObjectListing } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/misc";
import { FileIcon, FolderIcon } from "./file-icon";
import { LoadMore } from "./load-more";

/**
 * Visualização em colunas (estilo Finder): uma coluna por nível do prefixo atual.
 * Clicar numa pasta navega; clicar num arquivo abre o preview.
 */
export function ColumnsView({
  connectionId,
  bucket,
  prefix,
  activeKey,
  selected,
  onNavigate,
  onPreview,
  onToggleSelect,
}: {
  connectionId: string;
  bucket: string;
  prefix: string;
  activeKey: string | null;
  selected: Set<string>;
  onNavigate: (prefix: string) => void;
  onPreview: (item: ObjectItem, siblings: ObjectItem[]) => void;
  onToggleSelect: (id: string) => void;
}) {
  const levels = useMemo(() => {
    const parts = prefix.split("/").filter(Boolean);
    const out = [""];
    let acc = "";
    for (const p of parts) {
      acc += p + "/";
      out.push(acc);
    }
    return out;
  }, [prefix]);

  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scroller.current?.scrollTo({ left: scroller.current.scrollWidth, behavior: "smooth" });
  }, [levels.length]);

  return (
    <div ref={scroller} className="flex h-full overflow-x-auto">
      {levels.map((lvl, i) => (
        <Column
          key={lvl}
          connectionId={connectionId}
          bucket={bucket}
          prefix={lvl}
          openChild={levels[i + 1] ?? null}
          isLast={i === levels.length - 1}
          activeKey={activeKey}
          selected={selected}
          onNavigate={onNavigate}
          onPreview={onPreview}
          onToggleSelect={onToggleSelect}
        />
      ))}
    </div>
  );
}

function Column({
  connectionId,
  bucket,
  prefix,
  openChild,
  isLast,
  activeKey,
  selected,
  onNavigate,
  onPreview,
  onToggleSelect,
}: {
  connectionId: string;
  bucket: string;
  prefix: string;
  openChild: string | null;
  isLast: boolean;
  activeKey: string | null;
  selected: Set<string>;
  onNavigate: (prefix: string) => void;
  onPreview: (item: ObjectItem, siblings: ObjectItem[]) => void;
  onToggleSelect: (id: string) => void;
}) {
  const q = useObjectListing(connectionId, bucket, prefix);
  const folders = q.data?.pages.flatMap((p) => p.folders) ?? [];
  const objects = q.data?.pages.flatMap((p) => p.objects) ?? [];

  return (
    <div className={cn("flex h-full w-64 shrink-0 flex-col border-r border-border", isLast && "bg-surface")}>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {q.isLoading && (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        )}
        {q.isError && <p className="px-3 py-4 text-xs text-destructive">{(q.error as Error).message}</p>}
        {!q.isLoading && folders.length === 0 && objects.length === 0 && (
          <p className="px-3 py-4 text-center text-xs text-muted-foreground">Pasta vazia</p>
        )}
        <ul>
          {folders.map((f) => (
            <li key={f.prefix}>
              <button
                type="button"
                onClick={() => onNavigate(f.prefix)}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm",
                  openChild === f.prefix ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                  selected.has(`f:${f.prefix}`) && openChild !== f.prefix && "bg-primary/10",
                )}
              >
                <FolderIcon className={cn("h-4 w-4", openChild === f.prefix && "fill-white/20 text-primary-foreground")} />
                <span className="flex-1 truncate">{f.name}</span>
                <ChevronRight className="h-3.5 w-3.5 opacity-60" />
              </button>
            </li>
          ))}
          {objects.map((o) => {
            const active = activeKey === o.key;
            return (
              <li key={o.key}>
                <button
                  type="button"
                  onClick={(ev) => (ev.metaKey || ev.ctrlKey ? onToggleSelect(`o:${o.key}`) : onPreview(o, objects))}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm",
                    active ? "bg-primary/15" : "hover:bg-muted",
                    selected.has(`o:${o.key}`) && "bg-primary/10",
                  )}
                >
                  <FileIcon category={o.category} ext={o.ext} className="h-4 w-4" />
                  <span className="flex-1 truncate">{o.name}</span>
                  <span className="text-[11px] text-muted-foreground">{formatBytes(o.size, 0)}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <LoadMore hasMore={q.hasNextPage} loading={q.isFetchingNextPage} onLoadMore={() => q.fetchNextPage()} />
      </div>
    </div>
  );
}
