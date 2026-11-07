"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Copy,
  Download,
  Eye,
  FolderOpen,
  FolderPlus,
  FolderUp,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  ScanSearch,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { contentUrl, endpoints, uploadFiles, type ObjectItem } from "@/lib/api";
import { browseHref, parentPrefix } from "@/lib/files";
import { formatNumber } from "@/lib/format";
import { useObjectListing } from "@/lib/queries";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState, Spinner } from "@/components/ui/misc";
import { PreviewPanel, ResizableAside, type PreviewTarget } from "@/components/preview/preview-panel";
import { Breadcrumb } from "./breadcrumb";
import { ColumnsView } from "./columns-view";
import { ConfirmDialog, PromptDialog } from "./dialogs";
import { GalleryView } from "./gallery-view";
import { ListView } from "./list-view";
import type { Entry, ViewMode } from "./types";
import { ViewSwitcher, parseView, readStoredView, storeView } from "./view-switcher";

export function ObjectBrowser({ connectionId, bucket, prefix }: { connectionId: string; bucket: string; prefix: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const { canOperate, isAdmin } = useAuth();

  // ---- modo de visualização: URL > localStorage > lista
  const urlView = parseView(params.get("view"));
  const [storedView] = useState<ViewMode | null>(() => (typeof window === "undefined" ? null : readStoredView()));
  const view: ViewMode = urlView ?? storedView ?? "list";
  const setView = (v: ViewMode) => {
    storeView(v);
    const sp = new URLSearchParams(params.toString());
    sp.set("view", v);
    router.replace(`?${sp.toString()}`, { scroll: false });
  };

  const conns = useQuery({ queryKey: ["connections"], queryFn: endpoints.connections });
  const connection = conns.data?.items.find((c) => c.id === connectionId);

  // ---- listagem
  const listing = useObjectListing(connectionId, bucket, prefix);
  const folders = useMemo(() => listing.data?.pages.flatMap((p) => p.folders) ?? [], [listing.data]);
  const objects = useMemo(() => listing.data?.pages.flatMap((p) => p.objects) ?? [], [listing.data]);
  const entries: Entry[] = useMemo(
    () => [
      ...folders.map((f): Entry => ({ kind: "folder", id: `f:${f.prefix}`, name: f.name, prefix: f.prefix })),
      ...objects.map((o): Entry => ({ kind: "object", id: `o:${o.key}`, item: o, connectionId, bucket })),
    ],
    [folders, objects, connectionId, bucket],
  );

  // ---- seleção
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const lastClicked = useRef<number | null>(null);
  const toggleSelect = useCallback(
    (id: string, opts?: { range?: boolean }) => {
      const idx = entries.findIndex((e) => e.id === id);
      setSelected((prev) => {
        const next = new Set(prev);
        if (opts?.range && lastClicked.current !== null && idx >= 0) {
          const [a, b] = [Math.min(lastClicked.current, idx), Math.max(lastClicked.current, idx)];
          for (let i = a; i <= b; i++) next.add(entries[i].id);
        } else if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      lastClicked.current = idx;
    },
    [entries],
  );
  const selectAll = (checked: boolean) => setSelected(checked ? new Set(entries.map((e) => e.id)) : new Set());

  // ---- preview (?preview=key permite deep-link a partir da busca)
  const urlPreview = params.get("preview");
  const [previewKey, setPreviewKey] = useState<string | null>(urlPreview);
  const [previewList, setPreviewList] = useState<ObjectItem[] | null>(null);
  const [prevUrlPreview, setPrevUrlPreview] = useState(urlPreview);
  if (urlPreview !== prevUrlPreview) {
    // URL mudou — só adota se divergir do estado local (ex.: busca ⌘K abrindo
    // um arquivo desta mesma pasta). Mudanças feitas por openPreview já batem.
    setPrevUrlPreview(urlPreview);
    if (urlPreview !== previewKey) {
      setPreviewKey(urlPreview);
      setPreviewList(null);
    }
  }
  const siblings = previewList ?? objects;
  const previewIndex = previewKey ? siblings.findIndex((o) => o.key === previewKey) : -1;
  const listedItem = previewIndex >= 0 ? siblings[previewIndex] : undefined;
  const deepMeta = useQuery({
    queryKey: ["meta", connectionId, bucket, previewKey],
    queryFn: () => endpoints.meta(connectionId, bucket, previewKey!),
    enabled: !!previewKey && !listedItem && !listing.isLoading,
  });
  const previewItem: ObjectItem | undefined = listedItem ?? deepMeta.data;
  const previewTarget: PreviewTarget | null = previewItem ? { connectionId, bucket, item: previewItem } : null;

  const openPreview = (key: string | null, list: ObjectItem[] | null = null) => {
    setPreviewKey(key);
    setPreviewList(list);
    const sp = new URLSearchParams(window.location.search);
    if (key) sp.set("preview", key);
    else sp.delete("preview");
    const s = sp.toString();
    window.history.replaceState(window.history.state, "", s ? `?${s}` : window.location.pathname);
  };

  const navigate = (p: string) => {
    openPreview(null);
    router.push(browseHref(connectionId, bucket, p, { view }));
  };

  const onOpen = (e: Entry) => {
    if (e.kind === "folder") navigate(e.prefix);
    else openPreview(e.item.key);
  };

  // ---- mutações
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["objects", connectionId, bucket] });
    qc.invalidateQueries({ queryKey: ["buckets", connectionId] });
  };

  const [folderOpen, setFolderOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<ObjectItem | null>(null);
  const [deleteKeys, setDeleteKeys] = useState<string[] | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);

  async function doUpload(files: File[]) {
    if (!files.length) return;
    setUploading(true);
    const id = toast.loading(`Enviando ${files.length} arquivo(s)… 0%`);
    const { promise } = uploadFiles(connectionId, bucket, prefix, files, (f) =>
      toast.loading(`Enviando ${files.length} arquivo(s)… ${Math.round(f * 100)}%`, { id }),
    );
    try {
      const res = await promise;
      toast.success(`${res.uploaded.length} arquivo(s) enviado(s)`, { id });
      invalidate();
    } catch (err) {
      toast.error(`Falha no upload: ${(err as Error).message}`, { id });
    } finally {
      setUploading(false);
    }
  }

  function downloadKeys(keys: string[]) {
    keys.forEach((k, i) => {
      setTimeout(() => {
        const a = document.createElement("a");
        a.href = contentUrl(connectionId, bucket, k, true);
        a.download = "";
        document.body.appendChild(a);
        a.click();
        a.remove();
      }, i * 300);
    });
  }

  async function reindex() {
    try {
      await endpoints.syncConnection(connectionId, bucket);
      toast.success("Reindexação do bucket agendada");
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  const selectedKeys = [...selected].map((id) => id.slice(2));
  const selectedObjectKeys = [...selected].filter((id) => id.startsWith("o:")).map((id) => id.slice(2));

  const renderMenu = (e: Entry) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Ações">
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {e.kind === "folder" ? (
          <DropdownMenuItem onSelect={() => navigate(e.prefix)}>
            <FolderOpen /> Abrir
          </DropdownMenuItem>
        ) : (
          <>
            <DropdownMenuItem onSelect={() => openPreview(e.item.key)}>
              <Eye /> Visualizar
            </DropdownMenuItem>
            {canOperate && (
              <DropdownMenuItem onSelect={() => downloadKeys([e.item.key])}>
                <Download /> Baixar
              </DropdownMenuItem>
            )}
            {isAdmin && (
              <DropdownMenuItem onSelect={() => setRenameTarget(e.item)}>
                <Pencil /> Renomear
              </DropdownMenuItem>
            )}
          </>
        )}
        <DropdownMenuItem
          onSelect={() => {
            const path = `${bucket}/${e.kind === "folder" ? e.prefix : e.item.key}`;
            navigator.clipboard?.writeText(path).then(() => toast.success("Caminho copiado"));
          }}
        >
          <Copy /> Copiar caminho
        </DropdownMenuItem>
        {isAdmin && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onSelect={() => setDeleteKeys([e.kind === "folder" ? e.prefix : e.item.key])}>
              <Trash2 /> Excluir
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const viewProps = {
    entries,
    selected,
    activeId: previewKey ? `o:${previewKey}` : null,
    onToggleSelect: toggleSelect,
    onSelectAll: selectAll,
    onOpen,
    renderMenu,
    hasMore: listing.hasNextPage,
    isFetchingMore: listing.isFetchingNextPage,
    onLoadMore: () => listing.fetchNextPage(),
  };

  const countLabel = listing.data
    ? `${formatNumber(folders.length)} pasta(s), ${formatNumber(objects.length)}${listing.hasNextPage ? "+" : ""} arquivo(s)`
    : "";

  return (
    <div className="flex h-full min-h-0">
      <div
        className="relative flex min-w-0 flex-1 flex-col"
        onDragOver={(e) => {
          if (canOperate && e.dataTransfer.types.includes("Files")) {
            e.preventDefault();
            setDragging(true);
          }
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (canOperate) doUpload(Array.from(e.dataTransfer.files));
        }}
      >
        {/* Toolbar */}
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface px-3 py-2 md:px-4">
          <Breadcrumb connectionId={connectionId} connectionName={connection?.name} bucket={bucket} prefix={prefix} view={view} />
          <span className="hidden text-xs text-muted-foreground lg:inline">{countLabel}</span>
          <div className="ml-auto flex items-center gap-1.5">
            <Button variant="ghost" size="icon" onClick={() => listing.refetch()} aria-label="Atualizar" title="Atualizar">
              <RefreshCw className={cn(listing.isRefetching && "animate-spin")} />
            </Button>
            {canOperate && (
              <>
            <Button variant="ghost" size="icon" onClick={reindex} aria-label="Reindexar bucket" title="Reindexar bucket na busca">
              <ScanSearch />
            </Button>
            <Button variant="outline" size="sm" onClick={() => setFolderOpen(true)}>
              <FolderPlus /> <span className="hidden sm:inline">Nova pasta</span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" disabled={uploading}>
                  {uploading ? <Spinner className="text-primary-foreground" /> : <Upload />}
                  <span className="hidden sm:inline">Enviar</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => fileInput.current?.click()}>
                  <Upload /> Arquivos
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => folderInput.current?.click()}>
                  <FolderUp /> Pasta
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <input
              ref={folderInput}
              type="file"
              multiple
              hidden
              {...({ webkitdirectory: "" } as Record<string, string>)}
              onChange={(e) => {
                doUpload(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                doUpload(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
              </>
            )}
            <ViewSwitcher value={view} onChange={setView} />
          </div>
        </div>

        {/* Barra de seleção */}
        {selected.size > 0 && (
          <div className="flex shrink-0 items-center gap-2 border-b border-border bg-primary/8 px-4 py-1.5 text-sm">
            <span className="font-medium">{selected.size} selecionado(s)</span>
            {canOperate && (
              <Button variant="ghost" size="sm" onClick={() => downloadKeys(selectedObjectKeys)} disabled={!selectedObjectKeys.length}>
                <Download /> Baixar
              </Button>
            )}
            {isAdmin && (
              <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setDeleteKeys(selectedKeys)}>
                <Trash2 /> Excluir
              </Button>
            )}
            <Button variant="ghost" size="icon-sm" className="ml-auto" onClick={() => setSelected(new Set())} aria-label="Limpar seleção">
              <X />
            </Button>
          </div>
        )}

        <div className="min-h-0 flex-1">
          {listing.isLoading ? (
            <div className="flex h-full items-center justify-center">
              <Spinner className="h-6 w-6" />
            </div>
          ) : listing.isError ? (
            <EmptyState
              title="Não foi possível listar este local"
              description={(listing.error as Error).message}
              action={
                <Button variant="outline" onClick={() => listing.refetch()}>
                  Tentar novamente
                </Button>
              }
            />
          ) : view === "columns" ? (
            <ColumnsView
              connectionId={connectionId}
              bucket={bucket}
              prefix={prefix}
              activeKey={previewKey}
              selected={selected}
              onNavigate={navigate}
              onPreview={(item, list) => openPreview(item.key, parentPrefix(item.key) === prefix ? null : list)}
              onToggleSelect={(id) => toggleSelect(id)}
            />
          ) : entries.length === 0 ? (
            <EmptyState
              icon={<FolderOpen />}
              title="Pasta vazia"
              description={canOperate ? "Arraste arquivos para cá ou use o botão Enviar." : "Nenhum arquivo neste local."}
              action={
                canOperate ? (
                  <Button onClick={() => fileInput.current?.click()}>
                    <Upload /> Enviar arquivos
                  </Button>
                ) : undefined
              }
            />
          ) : view === "gallery" ? (
            <GalleryView {...viewProps} />
          ) : (
            <ListView {...viewProps} />
          )}
        </div>

        {dragging && (
          <div className="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-primary/8">
            <p className="rounded-lg bg-surface px-4 py-2 text-sm font-medium shadow">
              Solte para enviar para <span className="text-primary">{bucket}/{prefix}</span>
            </p>
          </div>
        )}
      </div>

      {previewTarget && (
        <ResizableAside>
          <PreviewPanel
            target={previewTarget}
            onClose={() => openPreview(null)}
            onPrev={previewIndex > 0 ? () => openPreview(siblings[previewIndex - 1].key, previewList) : undefined}
            onNext={
              previewIndex >= 0 && previewIndex < siblings.length - 1
                ? () => openPreview(siblings[previewIndex + 1].key, previewList)
                : undefined
            }
            position={previewIndex >= 0 ? `${previewIndex + 1} de ${siblings.length}` : undefined}
          />
        </ResizableAside>
      )}

      <PromptDialog
        open={folderOpen}
        onOpenChange={setFolderOpen}
        title="Nova pasta"
        description={`Será criada em ${bucket}/${prefix}`}
        label="Nome da pasta"
        confirmLabel="Criar"
        validate={(v) => (v.includes("/") ? "Use um nome sem “/”." : null)}
        onConfirm={async (name) => {
          await endpoints.createFolder(connectionId, bucket, `${prefix}${name}/`);
          toast.success("Pasta criada");
          invalidate();
        }}
      />

      <PromptDialog
        open={!!renameTarget}
        onOpenChange={(o) => !o && setRenameTarget(null)}
        title="Renomear arquivo"
        description="O objeto é copiado para o novo nome e o original é removido."
        label="Novo nome"
        initial={renameTarget?.name ?? ""}
        confirmLabel="Renomear"
        validate={(v) => (v.includes("/") ? "Use um nome sem “/”." : v === renameTarget?.name ? "O nome não mudou." : null)}
        onConfirm={async (name) => {
          if (!renameTarget) return;
          const to = parentPrefix(renameTarget.key) + name;
          await endpoints.renameObject(connectionId, bucket, renameTarget.key, to);
          if (previewKey === renameTarget.key) openPreview(to);
          toast.success("Arquivo renomeado");
          invalidate();
        }}
      />

      <ConfirmDialog
        open={!!deleteKeys}
        onOpenChange={(o) => !o && setDeleteKeys(null)}
        title={deleteKeys && deleteKeys.length === 1 ? "Excluir item?" : `Excluir ${deleteKeys?.length ?? 0} itens?`}
        description={
          <div className="space-y-2">
            <p>Esta ação não pode ser desfeita.</p>
            {deleteKeys?.some((k) => k.endsWith("/")) && (
              <p className="font-medium text-destructive">Pastas serão excluídas com todo o seu conteúdo.</p>
            )}
            <ul className="max-h-32 overflow-y-auto rounded-md bg-muted px-3 py-2 font-mono text-xs">
              {deleteKeys?.slice(0, 20).map((k) => (
                <li key={k} className="truncate">
                  {k}
                </li>
              ))}
              {(deleteKeys?.length ?? 0) > 20 && <li>… e mais {(deleteKeys?.length ?? 0) - 20}</li>}
            </ul>
          </div>
        }
        confirmLabel="Excluir"
        destructive
        onConfirm={async () => {
          if (!deleteKeys) return;
          try {
            const res = await endpoints.deleteObjects(connectionId, bucket, deleteKeys);
            toast.success(`${formatNumber(res.deleted)} objeto(s) excluído(s)`);
            if (previewKey && deleteKeys.some((k) => k === previewKey || (k.endsWith("/") && previewKey.startsWith(k)))) openPreview(null);
            setSelected(new Set());
            invalidate();
          } catch (err) {
            toast.error((err as Error).message);
          }
        }}
      />
    </div>
  );
}
