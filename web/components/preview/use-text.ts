"use client";
import { useQuery } from "@tanstack/react-query";
import { contentUrl, type ObjectItem } from "@/lib/api";

export function useTextContent(connectionId: string, bucket: string, item: ObjectItem) {
  return useQuery({
    queryKey: ["content-text", connectionId, bucket, item.key, item.etag],
    queryFn: async ({ signal }) => {
      const res = await fetch(contentUrl(connectionId, bucket, item.key), { signal, credentials: "same-origin" });
      if (!res.ok) throw new Error(`Falha ao carregar conteúdo (${res.status})`);
      return res.text();
    },
    staleTime: 5 * 60_000,
  });
}
