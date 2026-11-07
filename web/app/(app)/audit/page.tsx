import type { Metadata } from "next";
import { RequireRole } from "@/components/backups/admin-only";
import { AuditView } from "./audit-view";

export const metadata: Metadata = { title: "Auditoria" };

export default function AuditPage() {
  return (
    <RequireRole min="admin">
      <AuditView />
    </RequireRole>
  );
}
