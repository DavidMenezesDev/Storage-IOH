"use client";
import { useState } from "react";
import { thumbUrl, type ObjectItem } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { FileIcon } from "./file-icon";

const THUMBABLE = new Set(["image", "video"]);

export function Thumb({
  connectionId,
  bucket,
  item,
  size = 256,
  className,
}: {
  connectionId: string;
  bucket: string;
  item: ObjectItem;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const { canOperate } = useAuth();
  if (!canOperate || !THUMBABLE.has(item.category) || failed) {
    return (
      <div className={cn("flex items-center justify-center", className)}>
        <FileIcon category={item.category} ext={item.ext} className="h-10 w-10" />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={thumbUrl(connectionId, bucket, item.key, size)}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={cn("object-cover", className)}
    />
  );
}
