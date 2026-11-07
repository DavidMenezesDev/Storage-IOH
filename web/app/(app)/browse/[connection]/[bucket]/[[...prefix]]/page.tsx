import type { Metadata } from "next";
import { Suspense } from "react";
import { ObjectBrowser } from "@/components/browser/object-browser";
import { safeDecode } from "@/lib/files";

type Params = { connection: string; bucket: string; prefix?: string[] };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { bucket } = await params;
  return { title: safeDecode(bucket) };
}

export default async function BrowsePage({ params }: { params: Promise<Params> }) {
  const p = await params;
  const connectionId = safeDecode(p.connection);
  const bucket = safeDecode(p.bucket);
  const segs = (p.prefix ?? []).map(safeDecode);
  const prefix = segs.length ? segs.join("/") + "/" : "";
  return (
    <Suspense>
      <ObjectBrowser key={`${connectionId}/${bucket}/${prefix}`} connectionId={connectionId} bucket={bucket} prefix={prefix} />
    </Suspense>
  );
}
