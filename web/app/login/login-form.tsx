"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Logo } from "@/components/logo";
import { Spinner } from "@/components/ui/misc";
import { endpoints, ApiError } from "@/lib/api";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await endpoints.login(email, password);
      const next = params.get("next");
      router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/backups");
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? "E-mail ou senha inválidos." : (err as Error).message);
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 flex justify-center">
        <Logo className="text-lg" />
      </div>
      <form onSubmit={onSubmit} className="space-y-4 rounded-xl border border-border bg-surface p-6 shadow-sm">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold">Entrar</h1>
          <p className="text-sm text-muted-foreground">Acesse com seu usuário. No primeiro acesso, use o administrador definido no .env.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">E-mail</Label>
          <Input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Senha</Label>
          <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={loading}>
          {loading && <Spinner className="text-primary-foreground" />}
          Entrar
        </Button>
      </form>
    </div>
  );
}
