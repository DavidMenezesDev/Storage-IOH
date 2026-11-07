"use client";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Download, Eye, FolderOpen, MoreHorizontal, Search, SearchX, X } from "lucide-react";
import { contentUrl, endpoints, type Category, type SearchHit } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { CATEGORY_LABEL, CATEGORY_ORDER, browseHref, parentPrefix } from "@/lib/files";
import { formatBytes, formatNumber } from "@/lib/format";
import { useDebounced } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState, Spinner } from "@/components/ui/misc";
import { FileIcon } from "@/components/browser/file-icon";
import { GalleryView } from "@/components/browser/gallery-view";
import { ListView } from "@/components/browser/list-view";
import { LoadMore } from "@/components/browser/load-more";
import type { Entry, ViewMode } from "@/components/browser/types";
import { ViewSwitcher, parseView, readStoredView, storeView } from "@/components/browser/view-switcher";
import { PreviewPanel, ResizableAside } from "@/components/preview/preview-panel";

const PAGE = 50;
const MB = 1024 * 1024;
const SIZE_OPTIONS = [
  { v: "", l: "Qualquer" },
  { v: String(1 * MB), l: "1 MB" },
  { v: String(10 * MB), l: "10 MB" },
  { v: String(100 * MB), l: "100 MB" },
  { v: String(1024 * MB), l: "1 GB" },
];
const SORTS = [
  { v: "", l: "Relevância" },
  { v: "lastModified:desc", l: "Mais recentes" },
  { v: "lastModified:asc", l: "Mais antigos" },
  { v: "size:desc", l: "Maiores" },
  { v: "size:asc", l: "Menores" },
  { v: "name:asc", l: "Nome (A–Z)" },
  { v: "name:desc", l: "Nome (Z–A)" },
];
const FILTER_KEYS = ["connection", "bucket", "category", "ext", "minSize", "maxSize", "from", "to", "sort"] as const;

const hitId = (h: SearchHit) => `${h.connectionId}|${h.bucket}|${h.key}`;

export function SearchView() {
  const router = useRouter();
  const { canOperate } = useAuth();
  const params = useSearchParams();

  const urlQ = params.get("q") ?? "";
  const [q, setQ] = useState(urlQ);
  const dq = useDebounced(q, 300);
  const [prevUrlQ, setPrevUrlQ] = useState(urlQ);
  if (urlQ !== prevUrlQ) {
    // Só adota mudanças externas da URL (ex.: ⌘K); não sobrescreve o que está sendo digitado.
    setPrevUrlQ(urlQ);
    if (urlQ !== dq) setQ(urlQ);
  }

  const setParam = (updates: Record<string, string | null>) => {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v) sp.set(k, v);
      else sp.delete(k);
    }
    router.replace(`/search?${sp.toString()}`, { scroll: false });
  };

  useEffect(() => {
    if (dq !== (params.get("q") ?? "")) setParam({ q: dq || null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dq]);

  const filters = Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) ?? ""])) as Record<(typeof FILTER_KEYS)[number], string>;
  const activeFilterCount = FILTER_KEYS.filter((k) => k !== "sort" && filters[k]).length;

  const [storedView] = useState<ViewMode | null>(() => (typeof window === "undefined" ? null : readStoredView()));
  const view: ViewMode = parseView(params.get("view")) ?? storedView ?? "list";

  const conns = useQuery({ queryKey: ["connections"], queryFn: endpoints.connections });

  const query = useInfiniteQuery({
    queryKey: ["search", urlQ, filters],
    queryFn: ({ pageParam }) =>
      endpoints.search({
        q: urlQ,
        ...filters,
        from: filters.from ? new Date(filters.from + "T00:00:00").toISOString() : undefined,
        to: filters.to ? new Date(filters.to + "T23:59:59").toISOString() : undefined,
        page: pageParam,
        limit: PAGE,
      }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.limit < last.total ? last.page + 1 : undefined),
  });

  const hits = useMemo(() => query.data?.pages.flatMap((p) => p.hits) ?? [], [query.data]);
  const first = query.data?.pages[0];

  const entries: Entry[] = useMemo(
    () =>
      hits.map((h) => ({
        kind: "object",
        id: hitId(h),
        item: h,
        connectionId: h.connectionId,
        bucket: h.bucket,
        location: `${h.connectionName} / ${h.bucket} / ${parentPrefix(h.key) || ""}`,
      })),
    [hits],
  );

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [previewId, setPreviewId] = useState<string | null>(null);
  const previewIndex = previewId ? hits.findIndex((h) => hitId(h) === previewId) : -1;
  const previewHit = previewIndex >= 0 ? hits[previewIndex] : null;

  const [colGroup, setColGroup] = useState<string | null>(null);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const downloadSelected = () => {
    hits
      .filter((h) => selected.has(hitId(h)))
      .forEach((h, i) =>
        setTimeout(() => {
          const a = document.createElement("a");
          a.href = contentUrl(h.connectionId, h.bucket, h.key, true);
          a.download = "";
          document.body.appendChild(a);
          a.click();
          a.remove();
        }, i * 300),
      );
  };

  const renderMenu = (e: Entry) => {
    if (e.kind !== "object") return null;
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Ações">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setPreviewId(e.id)}>
            <Eye /> Visualizar
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => router.push(browseHref(e.connectionId, e.bucket, parentPrefix(e.item.key), { preview: e.item.key }))}>
            <FolderOpen /> Abrir pasta
          </DropdownMenuItem>
          {canOperate && (
            <DropdownMenuItem asChild>
              <a href={contentUrl(e.connectionId, e.bucket, e.item.key, true)}>
                <Download /> Baixar
              </a>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  const viewProps = {
    entries,
    selected,
    activeId: previewId,
    onToggleSelect: toggle,
    onSelectAll: (c: boolean) => setSelected(c ? new Set(entries.map((e) => e.id)) : new Set()),
    onOpen: (e: Entry) => setPreviewId(e.id),
    renderMenu,
    hasMore: query.hasNextPage,
    isFetchingMore: query.isFetchingNextPage,
    onLoadMore: () => query.fetchNextPage(),
  };

  const bucketOptions = useMemo(() => Object.entries(first?.facets.bucket ?? {}).sort((a, b) => b[1] - a[1]), [first]);
  const extOptions = useMemo(() => Object.entries(first?.facets.ext ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 14), [first]);

  return (
    <div className="flex h-full min-h-0">
      {/* Facets */}
      <aside className="hidden w-60 shrink-0 overflow-y-auto border-r border-border bg-surface p-4 lg:block" aria-label="Filtros">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Filtros</h2>
          {activeFilterCount > 0 && (
            <button
              type="button"
              className="text-xs text-primary hover:underline"
              onClick={() => setParam(Object.fromEntries(FILTER_KEYS.filter((k) => k !== "sort").map((k) => [k, null])))}
            >
              Limpar ({activeFilterCount})
            </button>
          )}
        </div>
        <div className="space-y-5">
          <Facet title="Conexão">
            <Select value={filters.connection} onChange={(e) => setParam({ connection: e.target.value || null, bucket: null })} aria-label="Conexão">
              <option value="">Todas</option>
              {conns.data?.items.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Facet>
          <Facet title="Categoria">
            <FacetList
              items={CATEGORY_ORDER.filter((c) => first?.facets.category[c] || filters.category === c).map((c) => [c, first?.facets.category[c] ?? 0])}
              active={filters.category}
              label={(k) => CATEGORY_LABEL[k as Category]}
              icon={(k) => <FileIcon category={k as Category} className="h-3.5 w-3.5" />}
              onPick={(k) => setParam({ category: filters.category === k ? null : k })}
            />
          </Facet>
          <Facet title="Bucket">
            <FacetList
              items={bucketOptions}
              active={filters.bucket}
              onPick={(k) => setParam({ bucket: filters.bucket === k ? null : k })}
            />
          </Facet>
          <Facet title="Extensão">
            <FacetList
              items={extOptions}
              active={filters.ext}
              label={(k) => (k ? `.${k}` : "(sem extensão)")}
              onPick={(k) => setParam({ ext: filters.ext === k ? null : k })}
            />
          </Facet>
          <Facet title="Tamanho">
            <div className="grid grid-cols-2 gap-2">
              <div className="grid gap-1">
                <Label className="text-[11px] font-normal text-muted-foreground" htmlFor="f-min">
                  Mínimo
                </Label>
                <Select id="f-min" value={filters.minSize} onChange={(e) => setParam({ minSize: e.target.value || null })}>
                  {SIZE_OPTIONS.map((o) => (
                    <option key={o.v} value={o.v}>
                      {o.l}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="grid gap-1">
                <Label className="text-[11px] font-normal text-muted-foreground" htmlFor="f-max">
                  Máximo
                </Label>
                <Select id="f-max" value={filters.maxSize} onChange={(e) => setParam({ maxSize: e.target.value || null })}>
                  {SIZE_OPTIONS.map((o) => (
                    <option key={o.v} value={o.v}>
                      {o.l}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          </Facet>
          <Facet title="Modificado entre">
            <div className="grid gap-2">
              <Input type="date" value={filters.from} onChange={(e) => setParam({ from: e.target.value || null })} aria-label="De" />
              <Input type="date" value={filters.to} onChange={(e) => setParam({ to: e.target.value || null })} aria-label="Até" />
            </div>
          </Facet>
        </div>
      </aside>

      {/* Resultados */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface px-3 py-2 md:px-4">
          <div className="relative min-w-[12rem] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nome ou caminho…" className="pl-8" aria-label="Busca" autoFocus />
          </div>
          <Select value={filters.sort} onChange={(e) => setParam({ sort: e.target.value || null })} className="w-40" aria-label="Ordenar">
            {SORTS.map((s) => (
              <option key={s.v} value={s.v}>
                {s.l}
              </option>
            ))}
          </Select>
          <ViewSwitcher
            value={view}
            onChange={(v) => {
              storeView(v);
              setParam({ view: v });
            }}
          />
        </div>
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-1.5 text-xs text-muted-foreground">
          {first ? (
            <span>
              {formatNumber(first.total)} resultado(s) · {first.processingTimeMs} ms
            </span>
          ) : (
            <span>&nbsp;</span>
          )}
          {query.isFetching && !query.isFetchingNextPage && <Spinner className="h-3 w-3" />}
          {selected.size > 0 && (
            <span className="ml-auto flex items-center gap-1">
              <span className="font-medium text-foreground">{selected.size} selecionado(s)</span>
              {canOperate && (
                <Button variant="ghost" size="sm" onClick={downloadSelected}>
                  <Download /> Baixar
                </Button>
              )}
              <Button variant="ghost" size="icon-sm" onClick={() => setSelected(new Set())} aria-label="Limpar seleção">
                <X />
              </Button>
            </span>
          )}
        </div>

        <div className="min-h-0 flex-1">
          {query.isLoading ? (
            <div className="flex h-full items-center justify-center">
              <Spinner className="h-6 w-6" />
            </div>
          ) : query.isError ? (
            <EmptyState title="A busca falhou" description={(query.error as Error).message} />
          ) : hits.length === 0 ? (
            <EmptyState
              icon={<SearchX />}
              title="Nada encontrado"
              description={
                urlQ || activeFilterCount
                  ? "Tente outros termos ou remova filtros."
                  : "Nenhum objeto indexado ainda. Ative a indexação nas conexões e aguarde a sincronização."
              }
            />
          ) : view === "gallery" ? (
            <GalleryView {...viewProps} />
          ) : view === "columns" ? (
            <SearchColumns
              hits={hits}
              group={colGroup}
              onGroup={setColGroup}
              activeId={previewId}
              onPreview={(h) => setPreviewId(hitId(h))}
              hasMore={query.hasNextPage}
              loadingMore={query.isFetchingNextPage}
              onLoadMore={() => query.fetchNextPage()}
            />
          ) : (
            <ListView {...viewProps} />
          )}
        </div>
      </div>

      {previewHit && (
        <ResizableAside>
          <PreviewPanel
            target={{ connectionId: previewHit.connectionId, bucket: previewHit.bucket, item: previewHit }}
            onClose={() => setPreviewId(null)}
            onPrev={previewIndex > 0 ? () => setPreviewId(hitId(hits[previewIndex - 1])) : undefined}
            onNext={previewIndex < hits.length - 1 ? () => setPreviewId(hitId(hits[previewIndex + 1])) : undefined}
            position={`${previewIndex + 1} de ${first?.total ?? hits.length}`}
          />
        </ResizableAside>
      )}
    </div>
  );
}

function Facet({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function FacetList({
  items,
  active,
  onPick,
  label = (k) => k,
  icon,
}: {
  items: [string, number][];
  active: string;
  onPick: (k: string) => void;
  label?: (k: string) => string;
  icon?: (k: string) => React.ReactNode;
}) {
  if (items.length === 0) return <p className="text-xs text-muted-foreground">—</p>;
  return (
    <ul className="space-y-0.5">
      {items.map(([k, n]) => (
        <li key={k}>
          <button
            type="button"
            aria-pressed={active === k}
            onClick={() => onPick(k)}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm",
              active === k ? "bg-primary/10 font-medium text-primary" : "hover:bg-muted",
            )}
          >
            {icon?.(k)}
            <span className="flex-1 truncate">{label(k)}</span>
            <span className="text-xs tabular-nums text-muted-foreground">{formatNumber(n)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Colunas na busca: agrupa resultados por conexão/bucket. */
function SearchColumns({
  hits,
  group,
  onGroup,
  activeId,
  onPreview,
  hasMore,
  loadingMore,
  onLoadMore,
}: {
  hits: SearchHit[];
  group: string | null;
  onGroup: (g: string) => void;
  activeId: string | null;
  onPreview: (h: SearchHit) => void;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore: () => void;
}) {
  const groups = useMemo(() => {
    const m = new Map<string, { label: string; hits: SearchHit[] }>();
    for (const h of hits) {
      const k = `${h.connectionId}|${h.bucket}`;
      if (!m.has(k)) m.set(k, { label: `${h.connectionName} / ${h.bucket}`, hits: [] });
      m.get(k)!.hits.push(h);
    }
    return [...m.entries()];
  }, [hits]);
  const current = groups.find(([k]) => k === group) ?? groups[0];

  return (
    <div className="flex h-full overflow-x-auto">
      <div className="w-64 shrink-0 overflow-y-auto border-r border-border py-1">
        {groups.map(([k, g]) => (
          <button
            key={k}
            type="button"
            onClick={() => onGroup(k)}
            className={cn(
              "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm",
              current?.[0] === k ? "bg-primary text-primary-foreground" : "hover:bg-muted",
            )}
          >
            <span className="flex-1 truncate">{g.label}</span>
            <span className="text-xs tabular-nums opacity-70">{g.hits.length}</span>
          </button>
        ))}
        <LoadMore hasMore={hasMore} loading={loadingMore} onLoadMore={onLoadMore} />
      </div>
      <div className="w-80 shrink-0 overflow-y-auto bg-surface py-1">
        {current?.[1].hits.map((h) => (
          <button
            key={hitId(h)}
            type="button"
            onClick={() => onPreview(h)}
            className={cn("flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm", activeId === hitId(h) ? "bg-primary/15" : "hover:bg-muted")}
          >
            <FileIcon category={h.category} ext={h.ext} className="h-4 w-4" />
            <span className="min-w-0 flex-1">
              <span className="block truncate">{h.name}</span>
              <span className="block truncate text-[11px] text-muted-foreground">{parentPrefix(h.key) || "/"}</span>
            </span>
            <span className="text-[11px] text-muted-foreground">{formatBytes(h.size, 0)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
