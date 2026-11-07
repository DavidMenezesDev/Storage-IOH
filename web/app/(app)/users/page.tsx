import type { Metadata } from "next";
import { RequireRole } from "@/components/backups/admin-only";
import { UsersView } from "./users-view";

export const metadata: Metadata = { title: "Usuários" };

export default function UsersPage() {
  return (
    <RequireRole min="admin">
      <UsersView />
    </RequireRole>
  );
}
