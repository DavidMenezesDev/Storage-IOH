"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { backupsApi } from "@/lib/backups";
import { EmptyState, Spinner } from "@/components/ui/misc";
import { ClientForm } from "@/components/backups/client-form";
import { RequireRole } from "@/components/backups/admin-only";

export function EditClient({ id }: { id: string }) {
  const q = useQuery({ queryKey: ["client", id], queryFn: () => backupsApi.client(id) });
  return (
    <RequireRole min="admin">
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-4xl space-y-5 p-4 md:p-8">
          <div>
            <Link href={`/clients/${id}`} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <ChevronLeft className="h-3.5 w-3.5" /> {q.data?.name ?? "Cliente"}
            </Link>
            <h1 className="mt-1 text-xl font-semibold tracking-tight">Editar cliente</h1>
          </div>
          {q.isLoading ? (
            <div className="flex justify-center py-16">
              <Spinner className="h-6 w-6" />
            </div>
          ) : q.isError ? (
            <EmptyState title="Não foi possível carregar o cliente" description={(q.error as Error).message} />
          ) : (
            <ClientForm key={q.data!.updatedAt} client={q.data} />
          )}
        </div>
      </div>
    </RequireRole>
  );
}
