import type { Metadata } from "next";
import { Suspense } from "react";
import { SearchView } from "./search-view";

export const metadata: Metadata = { title: "Busca" };

export default function SearchPage() {
  return (
    <Suspense>
      <SearchView />
    </Suspense>
  );
}
