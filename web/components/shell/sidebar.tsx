"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  AlertCircle,
  BarChart3,
  BellRing,
  Building2,
  ChevronRight,
  Database,
  HardDrive,
  LayoutDashboard,
  Plug,
  ScrollText,
  Search,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { Role } from "@/lib/api";
import { hasRole, useAuth } from "@/lib/auth";
import { endpoints, type Connection } from "@/lib/api";
import { browseHref, safeDecode } from "@/lib/files";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/logo";
import { Spinner } from "@/components/ui/misc";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  min?: Role;
}

const MAIN: NavItem[] = [
  { href: "/backups", label: "Painel de backups", icon: LayoutDashboard },
  { href: "/clients", label: "Clientes", icon: Building2 },
  { href: "/alerts", label: "Alertas", icon: BellRing },
];

const STORAGE: NavItem[] = [
  { href: "/search", label: "Busca", icon: Search },
  { href: "/dashboard", label: "Uso do storage", icon: BarChart3 },
  { href: "/connections", label: "Conexões", icon: Plug },
];

const ADMIN: NavItem[] = [
  { href: "/users", label: "Usuários", icon: Users, min: "admin" },
  { href: "/audit", label: "Auditoria", icon: ScrollText, min: "admin" },
];

function NavList({ items, pathname, onNavigate }: { items: NavItem[]; pathname: string; onNavigate?: () => void }) {
  return (
    <ul className="space-y-0.5">
      {items.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(href + "/");
        return (
          <li key={href}>
            <Link
              href={href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors",
                active ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function GroupTitle({ children }: { children: React.ReactNode }) {
  return <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{children}</p>;
}

const PROVIDER_LABEL: Record<Connection["provider"], string> = { s3: "S3", r2: "R2", minio: "MinIO", custom: "S3" };

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { data, isLoading } = useQuery({ queryKey: ["connections"], queryFn: endpoints.connections });

  const segs = pathname.split("/");
  const activeConn = segs[1] === "browse" ? safeDecode(segs[2] ?? "") : null;
  const activeBucket = segs[1] === "browse" ? safeDecode(segs[3] ?? "") : null;

  const { user, isAdmin } = useAuth();
  const admin = ADMIN.filter((i) => !i.min || hasRole(user, i.min));

  return (
    <nav className="flex h-full flex-col gap-5 overflow-y-auto bg-sidebar px-3 py-4" aria-label="Navegação principal">
      <Link href="/backups" className="block px-2" onClick={onNavigate}>
        <Logo />
        <span className="mt-0.5 block pl-8 text-[11px] font-medium text-muted-foreground">Backups ERP</span>
      </Link>

      <NavList items={MAIN} pathname={pathname} onNavigate={onNavigate} />

      <div>
        <GroupTitle>Armazenamento</GroupTitle>
        <NavList items={STORAGE} pathname={pathname} onNavigate={onNavigate} />
        <p className="mt-3 px-2 pb-1 text-[11px] font-medium text-muted-foreground">Explorar</p>
        {isLoading && (
          <div className="px-2 py-2">
            <Spinner />
          </div>
        )}
        {data && data.items.length === 0 && isAdmin && (
          <Link href="/connections?new=1" onClick={onNavigate} className="block px-2 py-1.5 text-sm text-primary hover:underline">
            + Adicionar conexão
          </Link>
        )}
        {data && data.items.length === 0 && !isAdmin && <p className="px-2 py-1.5 text-xs text-muted-foreground">Nenhuma conexão</p>}
        <ul className="space-y-0.5">
          {data?.items.map((c) => (
            <ConnectionNode
              key={c.id}
              conn={c}
              defaultOpen={activeConn === c.id || data.items.length === 1}
              activeBucket={activeConn === c.id ? activeBucket : null}
              onNavigate={onNavigate}
            />
          ))}
        </ul>
      </div>

      {admin.length > 0 && (
        <div>
          <GroupTitle>Administração</GroupTitle>
          <NavList items={admin} pathname={pathname} onNavigate={onNavigate} />
        </div>
      )}
    </nav>
  );
}

function ConnectionNode({
  conn,
  defaultOpen,
  activeBucket,
  onNavigate,
}: {
  conn: Connection;
  defaultOpen: boolean;
  activeBucket: string | null;
  onNavigate?: () => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["buckets", conn.id],
    queryFn: () => endpoints.buckets(conn.id),
    enabled: open,
    staleTime: 60_000,
  });

  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
      >
        <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
        <HardDrive className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="truncate">{conn.name}</span>
        <span className="ml-auto rounded bg-muted px-1 text-[10px] font-medium text-muted-foreground">{PROVIDER_LABEL[conn.provider]}</span>
      </button>
      {open && (
        <ul className="ml-4 border-l border-border pl-2">
          {isLoading && (
            <li className="px-2 py-1.5">
              <Spinner className="h-3.5 w-3.5" />
            </li>
          )}
          {isError && (
            <li className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5" /> Falha ao listar buckets
            </li>
          )}
          {data?.items.length === 0 && <li className="px-2 py-1.5 text-xs text-muted-foreground">Nenhum bucket</li>}
          {data?.items.map((b) => (
            <li key={b.name}>
              <Link
                href={browseHref(conn.id, b.name)}
                onClick={onNavigate}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1 text-sm transition-colors",
                  activeBucket === b.name ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Database className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{b.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
