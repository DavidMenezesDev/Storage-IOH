import type { Metadata } from "next";
import { EditClient } from "./edit-client";

export const metadata: Metadata = { title: "Editar cliente" };

export default async function EditClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EditClient id={id} />;
}
