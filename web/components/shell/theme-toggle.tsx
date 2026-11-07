"use client";
import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";

function subscribe(cb: () => void) {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => obs.disconnect();
}

export function ThemeToggle() {
  const dark = useSyncExternalStore(
    subscribe,
    () => document.documentElement.classList.contains("dark"),
    () => false,
  );
  function toggle() {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("ioh-theme", next ? "dark" : "light");
    } catch {
      /* armazenamento indisponível */
    }
  }
  return (
    <Button variant="ghost" size="icon" onClick={toggle} aria-label={dark ? "Usar tema claro" : "Usar tema escuro"} title="Alternar tema">
      {dark ? <Sun /> : <Moon />}
    </Button>
  );
}
