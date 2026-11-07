import type { Metadata } from "next";
import { Suspense } from "react";
import { ClientDetail } from "./client-detail";

export const metadata: Metadata = { title: "Cliente" };

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <ClientDetail id={id} />
    </Suspense>
  );
}
