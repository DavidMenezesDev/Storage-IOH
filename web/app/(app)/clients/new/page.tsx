import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { ClientForm } from "@/components/backups/client-form";
import { RequireRole } from "@/components/backups/admin-only";

export const metadata: Metadata = { title: "Novo cliente" };

export default function NewClientPage() {
  return (
    <RequireRole min="admin">
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-4xl space-y-5 p-4 md:p-8">
          <div>
            <Link href="/clients" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <ChevronLeft className="h-3.5 w-3.5" /> Clientes
            </Link>
            <h1 className="mt-1 text-xl font-semibold tracking-tight">Novo cliente</h1>
          </div>
          <ClientForm />
        </div>
      </div>
    </RequireRole>
  );
}
