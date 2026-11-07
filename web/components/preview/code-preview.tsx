"use client";
import { useEffect, useState } from "react";
import { CODE_LANGS } from "@/lib/files";
import { Spinner } from "@/components/ui/misc";

/** Destaque de sintaxe com shiki (carregado sob demanda). */
export function CodeBlock({ code, ext }: { code: string; ext: string }) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { codeToHtml, bundledLanguages } = await import("shiki");
      const wanted = CODE_LANGS[ext.toLowerCase()] ?? "text";
      const lang = wanted in bundledLanguages ? wanted : "text";
      try {
        const out = await codeToHtml(code, {
          lang,
          themes: { light: "github-light", dark: "github-dark" },
          defaultColor: "light",
        });
        if (!cancelled) setHtml(out);
      } catch {
        if (!cancelled) setHtml(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, ext]);

  if (html === null) {
    return (
      <div className="relative">
        <pre className="overflow-auto p-4 font-mono text-[12.5px] leading-relaxed">{code}</pre>
        <Spinner className="absolute right-3 top-3" />
      </div>
    );
  }
  return <div className="overflow-auto p-4 [&_pre]:font-mono" dangerouslySetInnerHTML={{ __html: html }} />;
}
