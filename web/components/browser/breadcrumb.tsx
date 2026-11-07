"use client";
import Link from "next/link";
import { ChevronRight, Database } from "lucide-react";
import { browseHref } from "@/lib/files";

export function Breadcrumb({
  connectionId,
  connectionName,
  bucket,
  prefix,
  view,
}: {
  connectionId: string;
  connectionName?: string;
  bucket: string;
  prefix: string;
  view: string;
}) {
  const parts = prefix.split("/").filter(Boolean);
  const crumbs = parts.map((p, i) => ({ name: p, prefix: parts.slice(0, i + 1).join("/") + "/" }));
  return (
    <nav aria-label="Caminho" className="flex min-w-0 items-center gap-1 overflow-x-auto text-sm">
      {connectionName && <span className="hidden shrink-0 text-muted-foreground sm:inline">{connectionName}</span>}
      {connectionName && <ChevronRight className="hidden h-3.5 w-3.5 shrink-0 text-muted-foreground sm:inline" />}
      <Link
        href={browseHref(connectionId, bucket, "", { view })}
        className="flex shrink-0 items-center gap-1.5 rounded px-1 font-medium hover:bg-muted"
      >
        <Database className="h-3.5 w-3.5 text-muted-foreground" />
        {bucket}
      </Link>
      {crumbs.map((c, i) => (
        <span key={c.prefix} className="flex shrink-0 items-center gap-1">
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          {i === crumbs.length - 1 ? (
            <span className="px-1 font-medium" aria-current="page">
              {c.name}
            </span>
          ) : (
            <Link href={browseHref(connectionId, bucket, c.prefix, { view })} className="rounded px-1 hover:bg-muted">
              {c.name}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );
}
