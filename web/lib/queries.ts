"use client";
import { useInfiniteQuery } from "@tanstack/react-query";
import { endpoints } from "./api";

export function objectsKey(connectionId: string, bucket: string, prefix: string) {
  return ["objects", connectionId, bucket, prefix] as const;
}

export function useObjectListing(connectionId: string, bucket: string, prefix: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: objectsKey(connectionId, bucket, prefix),
    queryFn: ({ pageParam }) => endpoints.objects(connectionId, bucket, prefix, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
  });
}
