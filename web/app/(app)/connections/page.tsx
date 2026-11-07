import type { Metadata } from "next";
import { Suspense } from "react";
import { ConnectionsView } from "./connections-view";

export const metadata: Metadata = { title: "Conexões" };

export default function ConnectionsPage() {
  return (
    <Suspense>
      <ConnectionsView />
    </Suspense>
  );
}
