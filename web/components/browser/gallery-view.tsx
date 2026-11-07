"use client";
import { Checkbox } from "@/components/ui/checkbox";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";
import { FolderIcon } from "./file-icon";
import { LoadMore } from "./load-more";
import { Thumb } from "./thumb";
import type { ViewProps } from "./types";

export function GalleryView({ entries, selected, activeId, onToggleSelect, onOpen, renderMenu, hasMore, isFetchingMore, onLoadMore }: ViewProps) {
  return (
    <div className="h-full overflow-y-auto p-4">
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
        {entries.map((e) => {
          const isSel = selected.has(e.id);
          const name = e.kind === "folder" ? e.name : e.item.name;
          return (
            <li key={e.id}>
              <div
                role="button"
                tabIndex={0}
                aria-pressed={isSel}
                onClick={() => onOpen(e)}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter") onOpen(e);
                  if (ev.key === " ") {
                    ev.preventDefault();
                    onToggleSelect(e.id, { range: ev.shiftKey });
                  }
                }}
                className={cn(
                  "group relative flex flex-col overflow-hidden rounded-lg border border-border bg-surface text-left outline-none transition-shadow",
                  "hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring",
                  (isSel || activeId === e.id) && "ring-2 ring-primary",
                )}
              >
                <div className="relative aspect-square bg-muted/60">
                  {e.kind === "folder" ? (
                    <div className="flex h-full items-center justify-center">
                      <FolderIcon className="h-14 w-14" />
                    </div>
                  ) : (
                    <Thumb connectionId={e.connectionId} bucket={e.bucket} item={e.item} className="h-full w-full" />
                  )}
                  <span
                    className={cn("absolute left-2 top-2 rounded bg-surface/90 p-0.5 opacity-0 transition-opacity group-hover:opacity-100", isSel && "opacity-100")}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      onToggleSelect(e.id, { range: ev.shiftKey });
                    }}
                  >
                    <Checkbox checked={isSel} tabIndex={-1} aria-label={`Selecionar ${name}`} />
                  </span>
                  {renderMenu && (
                    <span
                      className="absolute right-1.5 top-1.5 rounded bg-surface/90 opacity-0 transition-opacity group-hover:opacity-100 has-[[data-state=open]]:opacity-100"
                      onClick={(ev) => ev.stopPropagation()}
                    >
                      {renderMenu(e)}
                    </span>
                  )}
                </div>
                <div className="space-y-0.5 px-2.5 py-2">
                  <p className="truncate text-sm font-medium" title={name}>
                    {name}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {e.kind === "folder" ? "Pasta" : e.location ? e.location : formatBytes(e.item.size)}
                  </p>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <LoadMore hasMore={hasMore} loading={isFetchingMore} onLoadMore={onLoadMore} />
    </div>
  );
}
