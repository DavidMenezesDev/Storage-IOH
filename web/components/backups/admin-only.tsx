"use client";
import { ShieldAlert } from "lucide-react";
import type { Role } from "@/lib/api";
import { hasRole, useAuth } from "@/lib/auth";
import { EmptyState } from "@/components/ui/misc";

/** Renderiza os filhos só se o usuário tiver o papel mínimo; senão, mensagem de acesso negado. */
export function RequireRole({ min, children }: { min: Role; children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user) return null;
  if (!hasRole(user, min)) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <EmptyState
          icon={<ShieldAlert />}
          title="Permissão insuficiente"
          description={min === "admin" ? "Esta área é restrita a administradores." : "Seu papel não permite acessar esta área."}
        />
      </div>
    );
  }
  return <>{children}</>;
}
