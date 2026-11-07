"use client";
import dynamic from "next/dynamic";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChevronLeft, ChevronRight, Download, ExternalLink, Info, X } from "lucide-react";
import { contentUrl, endpoints, type ObjectItem } from "@/lib/api";
import { CATEGORY_LABEL, TEXT_PREVIEW_LIMIT, previewKind } from "@/lib/files";
import { formatBytes, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/misc";
import { FileIcon } from "@/components/browser/file-icon";
import { ImagePreview } from "./image-preview";
import { CodeBlock } from "./code-preview";
import { JsonTree, type Json } from "./json-tree";
import { CsvTable } from "./csv-table";
import { useTextContent } from "./use-text";

const PdfPreview = dynamic(() => import("./pdf-preview"), {
  ssr: false,
  loading: () => (
    <div className="flex justify-center py-10">
      <Spinner className="h-6 w-6" />
    </div>
  ),
});

export interface PreviewTarget {
  connectionId: string;
  bucket: string;
  item: ObjectItem;
}

export function PreviewPanel({
  target,
  onClose,
  onPrev,
  onNext,
  position,
}: {
  target: PreviewTarget;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  position?: string;
}) {
  const { connectionId, bucket, item } = target;
  const { canOperate } = useAuth();
  const [showInfoState, setShowInfo] = useState(false);
  const showInfo = showInfoState || !canOperate;
  const src = contentUrl(connectionId, bucket, item.key);
  const download = contentUrl(connectionId, bucket, item.key, true);

  // ← / → / Esc
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (document.querySelector("[role=dialog]")) return;
      if (e.key === "ArrowLeft" && onPrev) {
        e.preventDefault();
        onPrev();
      } else if (e.key === "ArrowRight" && onNext) {
        e.preventDefault();
        onNext();
      } else if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onPrev, onNext, onClose]);

  return (
    <section className="flex h-full min-w-0 flex-col bg-surface" aria-label={`Pré-visualização de ${item.name}`}>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <FileIcon category={item.category} ext={item.ext} className="h-4 w-4" />
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium" title={item.key}>
          {item.name}
        </h2>
        {position && <span className="hidden text-xs tabular-nums text-muted-foreground sm:inline">{position}</span>}
        <Button variant="ghost" size="icon-sm" onClick={onPrev} disabled={!onPrev} aria-label="Arquivo anterior" title="Anterior (←)">
          <ChevronLeft />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={onNext} disabled={!onNext} aria-label="Próximo arquivo" title="Próximo (→)">
          <ChevronRight />
        </Button>
        {canOperate && (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setShowInfo((s) => !s)}
          aria-pressed={showInfo}
          aria-label="Detalhes"
          title="Detalhes"
          className={cn(showInfo && "bg-muted")}
        >
          <Info />
        </Button>
        )}
        {canOperate && (
        <>
        <Button variant="ghost" size="icon-sm" asChild aria-label="Abrir em nova aba" title="Abrir em nova aba">
          <a href={src} target="_blank" rel="noopener noreferrer">
            <ExternalLink />
          </a>
        </Button>
        <Button variant="ghost" size="icon-sm" asChild aria-label="Baixar" title="Baixar">
          <a href={download}>
            <Download />
          </a>
        </Button>
        </>
        )}
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Fechar pré-visualização" title="Fechar (Esc)">
          <X />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden">
        {!canOperate ? (
          <div className="flex h-full flex-col">
            <p className="mx-4 mt-4 rounded-md border border-border bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
              Sem permissão para visualizar conteúdo. Seu papel permite ver apenas os metadados.
            </p>
            <div className="min-h-0 flex-1">
              <MetaInfo target={target} />
            </div>
          </div>
        ) : showInfo ? <MetaInfo target={target} /> : <PreviewBody key={`${connectionId}/${bucket}/${item.key}`} target={target} src={src} download={download} />}
      </div>
    </section>
  );
}

function PreviewBody({ target, src, download }: { target: PreviewTarget; src: string; download: string }) {
  const { item } = target;
  const kind = previewKind(item);
  const textual = kind === "code" || kind === "markdown" || kind === "json" || kind === "csv";

  if (textual && item.size > TEXT_PREVIEW_LIMIT) {
    return <Fallback target={target} download={download} reason={`Arquivo grande demais para pré-visualizar (${formatBytes(item.size)}; limite ${formatBytes(TEXT_PREVIEW_LIMIT)}).`} />;
  }

  switch (kind) {
    case "image":
      return <ImagePreview src={src} alt={item.name} />;
    case "video":
      return (
        <div className="flex h-full items-center justify-center bg-black">
          <video src={src} controls preload="metadata" className="max-h-full max-w-full">
            <track kind="captions" />
          </video>
        </div>
      );
    case "audio":
      return (
        <div className="flex h-full flex-col items-center justify-center gap-6 p-6">
          <FileIcon category="audio" className="h-16 w-16" />
          <audio src={src} controls preload="metadata" className="w-full max-w-md" />
        </div>
      );
    case "pdf":
      return <PdfPreview src={src} />;
    case "code":
    case "markdown":
    case "json":
    case "csv":
      return <TextPreview target={target} kind={kind} />;
    default:
      return <Fallback target={target} download={download} reason="Pré-visualização não disponível para este tipo de arquivo." />;
  }
}

function TextPreview({ target, kind }: { target: PreviewTarget; kind: "code" | "markdown" | "json" | "csv" }) {
  const { connectionId, bucket, item } = target;
  const q = useTextContent(connectionId, bucket, item);
  const json = useMemo(() => {
    if (kind !== "json" || q.data === undefined) return undefined;
    try {
      return { ok: true as const, value: JSON.parse(q.data) as Json };
    } catch {
      return { ok: false as const };
    }
  }, [kind, q.data]);

  if (q.isLoading)
    return (
      <div className="flex justify-center py-10">
        <Spinner className="h-6 w-6" />
      </div>
    );
  if (q.isError) return <p className="p-6 text-sm text-destructive">{(q.error as Error).message}</p>;
  const text = q.data ?? "";

  return (
    <div className="h-full overflow-auto">
      {kind === "markdown" && (
        <article className="prose-ioh max-w-none px-6 py-4 text-sm leading-relaxed">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
        </article>
      )}
      {kind === "json" && (json?.ok ? <JsonTree value={json.value} /> : <CodeBlock code={text} ext="json" />)}
      {kind === "csv" && <CsvTable text={text} ext={item.ext} />}
      {kind === "code" && <CodeBlock code={text} ext={item.ext || item.name.toLowerCase()} />}
    </div>
  );
}

function Fallback({ target, download, reason }: { target: PreviewTarget; download: string; reason: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
      <FileIcon category={target.item.category} ext={target.item.ext} className="h-16 w-16" />
      <p className="max-w-xs text-sm text-muted-foreground">{reason}</p>
      <Button asChild>
        <a href={download}>
          <Download /> Baixar ({formatBytes(target.item.size)})
        </a>
      </Button>
      <div className="w-full max-w-sm text-left">
        <MetaInfo target={target} compact />
      </div>
    </div>
  );
}

function MetaInfo({ target, compact }: { target: PreviewTarget; compact?: boolean }) {
  const { connectionId, bucket, item } = target;
  const q = useQuery({
    queryKey: ["meta", connectionId, bucket, item.key, item.etag],
    queryFn: () => endpoints.meta(connectionId, bucket, item.key),
  });
  const m = q.data;
  const rows: [string, string][] = [
    ["Caminho", `${bucket}/${item.key}`],
    ["Tamanho", `${formatBytes(item.size)} (${item.size.toLocaleString("pt-BR")} bytes)`],
    ["Tipo", m?.contentType ?? item.contentType ?? "—"],
    ["Categoria", CATEGORY_LABEL[item.category]],
    ["Modificado", formatDateTime(item.lastModified)],
    ["ETag", (m?.etag ?? item.etag).replaceAll('"', "")],
  ];
  return (
    <div className={cn("h-full overflow-y-auto", !compact && "p-4")}>
      <dl className="divide-y divide-border rounded-lg border border-border text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[6.5rem_1fr] gap-2 px-3 py-2">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="break-all">{v}</dd>
          </div>
        ))}
      </dl>
      {q.isLoading && <Spinner className="mx-auto mt-3" />}
      {m && Object.keys(m.metadata).length > 0 && (
        <>
          <h3 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Metadados</h3>
          <dl className="divide-y divide-border rounded-lg border border-border text-sm">
            {Object.entries(m.metadata).map(([k, v]) => (
              <div key={k} className="grid grid-cols-[6.5rem_1fr] gap-2 px-3 py-2">
                <dt className="break-all text-muted-foreground">{k}</dt>
                <dd className="break-all">{v}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </div>
  );
}

/** Painel lateral redimensionável (largura persistida); tela cheia no mobile. */
export function ResizableAside({ children }: { children: React.ReactNode }) {
  const [width, setWidth] = useState(() => {
    if (typeof window === "undefined") return 480;
    try {
      const v = Number(localStorage.getItem("ioh-preview-width"));
      return v >= 320 ? v : 480;
    } catch {
      return 480;
    }
  });
  const start = useRef<{ x: number; w: number } | null>(null);

  return (
    <aside
      className="fixed inset-0 z-30 flex md:relative md:inset-auto md:z-auto md:h-full md:w-[var(--w)] md:shrink-0 md:border-l md:border-border"
      style={{ "--w": `${width}px` } as React.CSSProperties}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Redimensionar painel"
        tabIndex={0}
        className="absolute inset-y-0 -left-1 z-10 hidden w-2 cursor-col-resize hover:bg-primary/30 md:block"
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          start.current = { x: e.clientX, w: width };
        }}
        onPointerMove={(e) => {
          if (!start.current) return;
          const max = Math.max(360, window.innerWidth - 420);
          setWidth(Math.min(max, Math.max(320, start.current.w - (e.clientX - start.current.x))));
        }}
        onPointerUp={() => {
          start.current = null;
          try {
            localStorage.setItem("ioh-preview-width", String(width));
          } catch {
            /* ignore */
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") setWidth((w) => Math.min(window.innerWidth - 420, w + 24));
          if (e.key === "ArrowRight") setWidth((w) => Math.max(320, w - 24));
        }}
      />
      <div className="min-w-0 flex-1">{children}</div>
    </aside>
  );
}
