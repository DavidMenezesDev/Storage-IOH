"use client";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Building2, CornerDownLeft, Search } from "lucide-react";
import { backupsApi, type Client } from "@/lib/backups";
import { formatDocument, onlyDigits } from "@/lib/document";
import { StatusBadge } from "@/components/backups/status";
import { endpoints, type SearchHit } from "@/lib/api";
import { browseHref, parentPrefix } from "@/lib/files";
import { formatBytes } from "@/lib/format";
import { useDebounced } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { FileIcon } from "@/components/browser/file-icon";
import { Kbd, Spinner } from "@/components/ui/misc";

export function CommandSearch({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const dq = useDebounced(q.trim(), 200);

  const { data, isFetching } = useQuery({
    queryKey: ["quick-search", dq],
    queryFn: () => endpoints.search({ q: dq, limit: 8 }),
    enabled: open && dq.length > 0,
  });
  const hits = dq ? (data?.hits ?? []) : [];
  // Clientes: filtro local sobre a lista (pequena) de clientes
  const clientsQ = useQuery({ queryKey: ["clients", {}], queryFn: () => backupsApi.clients(), enabled: open, staleTime: 60_000 });
  const needle = dq.toLowerCase();
  const digits = onlyDigits(dq);
  const clientHits: Client[] = dq
    ? (clientsQ.data?.items ?? [])
        .filter(
          (c) =>
            c.name.toLowerCase().includes(needle) ||
            (digits.length >= 3 && c.document.includes(digits)) ||
            c.tags.some((t) => t.toLowerCase().includes(needle)),
        )
        .slice(0, 5)
    : [];
  const nC = clientHits.length;

  function close() {
    onOpenChange(false);
    setQ("");
    setActive(0);
  }

  function openHit(h: SearchHit) {
    close();
    router.push(browseHref(h.connectionId, h.bucket, parentPrefix(h.key), { preview: h.key }));
  }

  function openClient(c: Client) {
    close();
    router.push(`/clients/${c.id}`);
  }

  function openAll() {
    close();
    router.push(`/search?q=${encodeURIComponent(q.trim())}`);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    // índices: [0, nC) clientes · [nC, nC+hits) arquivos · nC+hits = "ver todos os resultados"
    const max = nC + hits.length;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, max));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (active < nC) openClient(clientHits[active]);
      else if (active < nC + hits.length) openHit(hits[active - nC]);
      else if (q.trim()) openAll();
    }
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]" />
        <DialogPrimitive.Content
          className="fixed left-1/2 top-[12vh] z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-surface shadow-2xl"
          onKeyDown={onKeyDown}
        >
          <DialogPrimitive.Title className="sr-only">Buscar objetos</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">Busca indexada em todos os buckets</DialogPrimitive.Description>
          <div className="flex items-center gap-2 border-b border-border px-4">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              autoFocus
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setActive(0);
              }}
              placeholder="Buscar clientes ou arquivos…"
              className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              aria-label="Termo de busca"
            />
            {isFetching && <Spinner />}
          </div>
          <ul className="max-h-[50vh] overflow-y-auto p-1.5" role="listbox">
            {nC > 0 && <li className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground" role="presentation">Clientes</li>}
            {clientHits.map((c, i) => (
              <li key={c.id} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => openClient(c)}
                  className={cn("flex w-full items-center gap-3 rounded-md px-3 py-2 text-left", i === active && "bg-muted")}
                >
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{c.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{formatDocument(c.document) || c.prefix}</span>
                  </span>
                  <StatusBadge status={c.status} reason={c.statusReason} />
                </button>
              </li>
            ))}
            {nC > 0 && hits.length > 0 && <li className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground" role="presentation">Arquivos</li>}
            {hits.map((h, j) => {
              const i = nC + j;
              return (
              <li key={`${h.connectionId}/${h.bucket}/${h.key}`} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => openHit(h)}
                  className={cn("flex w-full items-center gap-3 rounded-md px-3 py-2 text-left", i === active && "bg-muted")}
                >
                  <FileIcon category={h.category} ext={h.ext} className="h-4 w-4" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{h.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {h.connectionName} / {h.bucket} / {h.key}
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground">{formatBytes(h.size)}</span>
                </button>
              </li>
              );
            })}
            {q.trim() && (
              <li role="option" aria-selected={active === nC + hits.length}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(nC + hits.length)}
                  onClick={openAll}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-primary",
                    active === nC + hits.length && "bg-muted",
                  )}
                >
                  <Search className="h-4 w-4" />
                  Buscar arquivos com “{q.trim()}”
                  {data && <span className="text-muted-foreground">({data.total})</span>}
                </button>
              </li>
            )}
            {!q.trim() && <li className="px-3 py-6 text-center text-sm text-muted-foreground">Digite o nome/CNPJ de um cliente ou o nome de um arquivo.</li>}
          </ul>
          <div className="flex items-center gap-3 border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd> navegar
            </span>
            <span className="flex items-center gap-1">
              <Kbd>
                <CornerDownLeft className="inline h-2.5 w-2.5" />
              </Kbd>{" "}
              abrir
            </span>
            <span className="flex items-center gap-1">
              <Kbd>esc</Kbd> fechar
            </span>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function useCommandShortcut(onOpen: () => void) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpen();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onOpen]);
}
