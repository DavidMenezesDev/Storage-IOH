"use client";
import { useQuery } from "@tanstack/react-query";
import { endpoints, type Role, type User } from "./api";

const RANK: Record<Role, number> = { viewer: 0, operator: 1, admin: 2 };

export const ROLE_LABEL: Record<Role, string> = { admin: "Administrador", operator: "Suporte", viewer: "Leitura" };

export const ROLE_DESCRIPTION: Record<Role, string> = {
  viewer: "Vê painéis, clientes, status, listas de backups e alertas. Não acessa o conteúdo dos arquivos.",
  operator: "Tudo da Leitura + baixar/visualizar arquivos, criar links de compartilhamento, disparar varredura e enviar arquivos.",
  admin: "Acesso total: clientes, conexões, canais de alerta, usuários, exclusões, retenção, tokens de envio e auditoria.",
};

export function hasRole(user: Pick<User, "role"> | null | undefined, min: Role): boolean {
  if (!user) return false;
  return (RANK[user.role] ?? -1) >= RANK[min];
}

export function useMeQuery() {
  return useQuery({ queryKey: ["me"], queryFn: endpoints.me, retry: false, staleTime: 5 * 60_000 });
}

/** Usuário atual (já carregado pelo AppShell) e atalhos de permissão. */
export function useAuth() {
  const me = useMeQuery();
  const user = me.data?.user ?? null;
  return {
    user,
    canOperate: hasRole(user, "operator"),
    isAdmin: hasRole(user, "admin"),
  };
}
