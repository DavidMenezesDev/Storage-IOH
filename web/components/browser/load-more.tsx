"use client";
import { useEffect, useRef } from "react";
import { Spinner } from "@/components/ui/misc";

/** Sentinela para scroll infinito. */
export function LoadMore({ hasMore, loading, onLoadMore }: { hasMore?: boolean; loading?: boolean; onLoadMore?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !hasMore || !onLoadMore) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !loading) onLoadMore();
      },
      { rootMargin: "400px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loading, onLoadMore]);
  if (!hasMore) return null;
  return (
    <div ref={ref} className="flex justify-center py-4">
      {loading && <Spinner />}
    </div>
  );
}
