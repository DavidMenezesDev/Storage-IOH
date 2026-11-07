"use client";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useRef } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Spinner } from "@/components/ui/misc";
import { formatBytes, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { FileIcon, FolderIcon } from "./file-icon";
import type { Entry, ViewProps } from "./types";

const ROW = 40;

export function ListView({
  entries,
  selected,
  activeId,
  onToggleSelect,
  onSelectAll,
  onOpen,
  renderMenu,
  hasMore,
  isFetchingMore,
  onLoadMore,
}: ViewProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW,
    overscan: 12,
  });
  const items = virtualizer.getVirtualItems();
  const lastIndex = items.length ? items[items.length - 1].index : -1;

  useEffect(() => {
    if (hasMore && !isFetchingMore && onLoadMore && lastIndex >= entries.length - 20) onLoadMore();
  }, [lastIndex, entries.length, hasMore, isFetchingMore, onLoadMore]);

  const allChecked = entries.length > 0 && selected.size === entries.length;
  const someChecked = selected.size > 0 && !allChecked;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        role="row"
        className="grid shrink-0 grid-cols-[2rem_minmax(0,1fr)_6rem_2rem] items-center gap-3 border-b border-border px-4 py-2 text-xs font-medium text-muted-foreground sm:grid-cols-[2rem_minmax(0,1fr)_6rem_6rem_9rem_2rem]"
      >
        <span>
          {onSelectAll && (
            <Checkbox
              checked={allChecked ? true : someChecked ? "indeterminate" : false}
              onCheckedChange={(c) => onSelectAll(c === true)}
              aria-label="Selecionar todos"
            />
          )}
        </span>
        <span>Nome</span>
        <span className="text-right">Tamanho</span>
        <span className="hidden sm:block">Tipo</span>
        <span className="hidden sm:block">Modificado</span>
        <span />
      </div>
      <div ref={parentRef} className="min-h-0 flex-1 overflow-y-auto" role="grid" aria-rowcount={entries.length}>
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {items.map((vi) => {
            const e = entries[vi.index];
            return (
              <Row
                key={e.id}
                entry={e}
                style={{ position: "absolute", top: 0, left: 0, right: 0, height: ROW, transform: `translateY(${vi.start}px)` }}
                selected={selected.has(e.id)}
                active={activeId === e.id}
                onToggle={(range) => onToggleSelect(e.id, { range })}
                onOpen={() => onOpen(e)}
                menu={renderMenu?.(e)}
              />
            );
          })}
        </div>
        {isFetchingMore && (
          <div className="flex justify-center py-3">
            <Spinner />
          </div>
        )}
      </div>
    </div>
  );
}

function Row({
  entry,
  style,
  selected,
  active,
  onToggle,
  onOpen,
  menu,
}: {
  entry: Entry;
  style: React.CSSProperties;
  selected: boolean;
  active: boolean;
  onToggle: (range: boolean) => void;
  onOpen: () => void;
  menu?: React.ReactNode;
}) {
  const isFolder = entry.kind === "folder";
  return (
    <div
      role="row"
      aria-selected={selected}
      style={style}
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(ev) => {
        if (ev.key === "Enter") onOpen();
        if (ev.key === " ") {
          ev.preventDefault();
          onToggle(ev.shiftKey);
        }
      }}
      className={cn(
        "group grid cursor-default grid-cols-[2rem_minmax(0,1fr)_6rem_2rem] items-center gap-3 border-b border-border/60 px-4 text-sm outline-none sm:grid-cols-[2rem_minmax(0,1fr)_6rem_6rem_9rem_2rem]",
        "hover:bg-muted/60 focus-visible:bg-muted",
        selected && "bg-primary/8 hover:bg-primary/10",
        active && "bg-primary/12 hover:bg-primary/12",
      )}
    >
      <span
        onClick={(ev) => {
          ev.stopPropagation();
          onToggle(ev.shiftKey);
        }}
        className="flex h-full items-center"
      >
        <Checkbox checked={selected} tabIndex={-1} aria-label={`Selecionar ${isFolder ? entry.name : entry.item.name}`} />
      </span>
      <span className="flex min-w-0 items-center gap-2.5">
        {isFolder ? <FolderIcon className="h-4 w-4" /> : <FileIcon category={entry.item.category} ext={entry.item.ext} className="h-4 w-4" />}
        <span className="min-w-0">
          <span className={cn("block truncate", isFolder && "font-medium")}>{isFolder ? entry.name : entry.item.name}</span>
          {!isFolder && entry.location && <span className="block truncate text-[11px] leading-tight text-muted-foreground">{entry.location}</span>}
        </span>
      </span>
      <span className="text-right tabular-nums text-muted-foreground">{isFolder ? "—" : formatBytes(entry.item.size)}</span>
      <span className="hidden truncate text-muted-foreground sm:block">{isFolder ? "Pasta" : entry.item.ext ? entry.item.ext.toUpperCase() : "—"}</span>
      <span className="hidden tabular-nums text-muted-foreground sm:block">{isFolder ? "—" : formatDateTime(entry.item.lastModified)}</span>
      <span onClick={(ev) => ev.stopPropagation()} className="flex justify-end opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 has-[[data-state=open]]:opacity-100">
        {menu}
      </span>
    </div>
  );
}
