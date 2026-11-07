"use client";
import { useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { Spinner } from "@/components/ui/misc";

// O worker precisa ser configurado no mesmo módulo que usa <Document>.
pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

const MAX_PAGES = 100;

export default function PdfPreview({ src }: { src: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [pages, setPages] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(200, Math.floor(e.contentRect.width) - 32)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={ref} className="h-full overflow-y-auto bg-muted/50 p-4">
      <Document
        file={src}
        onLoadSuccess={(d) => setPages(d.numPages)}
        loading={
          <div className="flex justify-center py-10">
            <Spinner className="h-6 w-6" />
          </div>
        }
        error={<p className="py-10 text-center text-sm text-muted-foreground">Não foi possível abrir o PDF.</p>}
        className="flex flex-col items-center gap-4"
      >
        {Array.from({ length: Math.min(pages, MAX_PAGES) }, (_, i) => (
          <div key={i} className="shadow-md">
            <Page pageNumber={i + 1} width={width} loading={<div style={{ width, height: width * 1.3 }} className="bg-surface" />} />
          </div>
        ))}
      </Document>
      {pages > MAX_PAGES && (
        <p className="py-4 text-center text-xs text-muted-foreground">Exibindo {MAX_PAGES} de {pages} páginas. Baixe o arquivo para ver o restante.</p>
      )}
    </div>
  );
}
