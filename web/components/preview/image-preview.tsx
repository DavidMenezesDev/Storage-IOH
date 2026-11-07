"use client";
import { useRef, useState } from "react";
import { Minus, Plus, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/misc";

export function ImagePreview({ src, alt }: { src: string; alt: string }) {
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  const clamp = (s: number) => Math.min(8, Math.max(0.25, s));
  const reset = () => {
    setScale(1);
    setPos({ x: 0, y: 0 });
  };

  return (
    <div className="relative flex h-full min-h-[240px] flex-col">
      <div
        className="relative min-h-0 flex-1 cursor-grab overflow-hidden bg-[repeating-conic-gradient(var(--muted)_0%_25%,transparent_0%_50%)] bg-[length:16px_16px] active:cursor-grabbing"
        onWheel={(e) => {
          e.preventDefault();
          setScale((s) => clamp(s * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
        }}
        onDoubleClick={() => (scale === 1 ? setScale(2) : reset())}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y };
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          setPos({ x: drag.current.px + (e.clientX - drag.current.x), y: drag.current.py + (e.clientY - drag.current.y) });
        }}
        onPointerUp={() => (drag.current = null)}
      >
        {!loaded && !error && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Spinner className="h-6 w-6" />
          </div>
        )}
        {error ? (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">Não foi possível carregar a imagem.</p>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={alt}
            draggable={false}
            onLoad={() => setLoaded(true)}
            onError={() => setError(true)}
            className="absolute inset-0 m-auto max-h-full max-w-full select-none object-contain transition-transform duration-75"
            style={{ transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})` }}
          />
        )}
      </div>
      <div className="flex items-center justify-center gap-1 border-t border-border py-1.5">
        <Button variant="ghost" size="icon-sm" onClick={() => setScale((s) => clamp(s / 1.25))} aria-label="Diminuir zoom">
          <Minus />
        </Button>
        <span className="w-12 text-center text-xs tabular-nums text-muted-foreground">{Math.round(scale * 100)}%</span>
        <Button variant="ghost" size="icon-sm" onClick={() => setScale((s) => clamp(s * 1.25))} aria-label="Aumentar zoom">
          <Plus />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={reset} aria-label="Restaurar zoom">
          <RotateCcw />
        </Button>
      </div>
    </div>
  );
}
