"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { KeyRound, LogOut, Menu, Search, User as UserIcon } from "lucide-react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { endpoints, ApiError } from "@/lib/api";
import { ROLE_LABEL, useMeQuery } from "@/lib/auth";
import { ChangePasswordDialog } from "./change-password-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd, Spinner } from "@/components/ui/misc";
import { Sidebar } from "./sidebar";
import { ThemeToggle } from "./theme-toggle";
import { CommandSearch, useCommandShortcut } from "./command-search";

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [cmdOpen, setCmdOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const openCmd = useCallback(() => setCmdOpen(true), []);
  useCommandShortcut(openCmd);

  const me = useMeQuery();
  const [pwOpen, setPwOpen] = useState(false);

  useEffect(() => {
    if (me.error instanceof ApiError && me.error.status === 401) {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      router.replace(`/login?next=${next}`);
    }
  }, [me.error, router]);

  function toggleTheme() {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("ioh-theme", next ? "dark" : "light");
    } catch {
      /* armazenamento indisponível */
    }
  }

  async function logout() {
    try {
      await endpoints.logout();
    } finally {
      router.replace("/login");
    }
  }

  if (!me.data) {
    return (
      <div className="flex h-full items-center justify-center">
        {me.error && !(me.error instanceof ApiError && me.error.status === 401) ? (
          <div className="space-y-3 text-center">
            <p className="text-sm text-muted-foreground">Não foi possível falar com a API: {(me.error as Error).message}</p>
            <Button variant="outline" onClick={() => me.refetch()}>
              Tentar novamente
            </Button>
          </div>
        ) : (
          <Spinner className="h-6 w-6" />
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <aside className="hidden w-64 shrink-0 border-r border-border md:block">
        <Sidebar />
      </aside>

      <DialogPrimitive.Root open={navOpen} onOpenChange={setNavOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/40 md:hidden" />
          <DialogPrimitive.Content className="fixed inset-y-0 left-0 z-50 w-72 border-r border-border shadow-xl md:hidden">
            <DialogPrimitive.Title className="sr-only">Menu</DialogPrimitive.Title>
            <Sidebar onNavigate={() => setNavOpen(false)} />
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-surface/80 px-3 backdrop-blur md:px-5">
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setNavOpen(true)} aria-label="Abrir menu">
            <Menu />
          </Button>
          <button
            type="button"
            onClick={openCmd}
            className="flex h-9 w-full min-w-0 max-w-md items-center gap-2 rounded-md border border-border bg-background px-3 text-sm text-muted-foreground transition-colors hover:bg-muted"
          >
            <Search className="h-4 w-4" />
            <span className="min-w-0 flex-1 truncate text-left">Buscar clientes ou arquivos…</span>
            <Kbd className="hidden sm:inline">Ctrl K</Kbd>
          </button>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <ThemeToggle />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Conta" title={me.data.user.email}>
                  <UserIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel className="space-y-0.5">
                  <span className="block truncate text-sm font-medium text-foreground">{me.data.user.name || me.data.user.email}</span>
                  {me.data.user.name && <span className="block truncate font-normal">{me.data.user.email}</span>}
                  <span className="mt-1 inline-block rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium">
                    {ROLE_LABEL[me.data.user.role] ?? me.data.user.role}
                  </span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setPwOpen(true)}>
                  <KeyRound /> Alterar senha
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={toggleTheme}>
                  <span aria-hidden className="h-4 w-4 rounded-full border border-border bg-gradient-to-br from-white to-neutral-800" /> Alternar tema
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={logout}>
                  <LogOut /> Sair
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
      </div>

      <CommandSearch open={cmdOpen} onOpenChange={setCmdOpen} />
      <ChangePasswordDialog open={pwOpen} onOpenChange={setPwOpen} />
    </div>
  );
}
