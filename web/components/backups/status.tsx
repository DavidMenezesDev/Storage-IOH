import { AlertOctagon, CheckCircle2, CircleDashed, Clock, Hourglass, PauseCircle, TriangleAlert, type LucideIcon } from "lucide-react";
import type { ClientStatus } from "@/lib/backups";
import { cn } from "@/lib/utils";

export interface StatusMeta {
  label: string;
  icon: LucideIcon;
  /** classes de texto/fundo/borda (cor semântica) */
  text: string;
  bg: string;
  border: string;
  description: string;
}

export const STATUS_META: Record<ClientStatus, StatusMeta> = {
  ok: {
    label: "Em dia",
    icon: CheckCircle2,
    text: "text-good",
    bg: "bg-good/12",
    border: "border-good/40",
    description: "Backup recente e saudável",
  },
  late: {
    label: "Atrasado",
    icon: Clock,
    text: "text-warning",
    bg: "bg-warning/15",
    border: "border-warning/40",
    description: "Último backup mais antigo que o esperado",
  },
  suspicious: {
    label: "Suspeito",
    icon: TriangleAlert,
    text: "text-orange",
    bg: "bg-orange/12",
    border: "border-orange/40",
    description: "Tamanho abaixo do mínimo ou queda brusca",
  },
  missing: {
    label: "Sem backup",
    icon: CircleDashed,
    text: "text-destructive",
    bg: "bg-destructive/12",
    border: "border-destructive/40",
    description: "Nenhum backup encontrado",
  },
  error: {
    label: "Erro",
    icon: AlertOctagon,
    text: "text-destructive",
    bg: "bg-destructive/12",
    border: "border-destructive/40",
    description: "Falha ao varrer o local",
  },
  pending: {
    label: "Aguardando",
    icon: Hourglass,
    text: "text-muted-foreground",
    bg: "bg-muted",
    border: "border-border",
    description: "Cliente novo, aguardando primeira janela",
  },
  inactive: {
    label: "Inativo",
    icon: PauseCircle,
    text: "text-muted-foreground/80",
    bg: "bg-muted/60",
    border: "border-border",
    description: "Cliente desativado",
  },
};

/** Ordem de gravidade (piores primeiro) usada em listas e no painel. */
export const STATUS_SEVERITY: ClientStatus[] = ["error", "missing", "suspicious", "late", "pending", "ok", "inactive"];

export function StatusBadge({ status, reason, className }: { status: ClientStatus; reason?: string; className?: string }) {
  const m = STATUS_META[status] ?? STATUS_META.pending;
  const Icon = m.icon;
  return (
    <span
      title={reason || m.description}
      className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium", m.bg, m.text, className)}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {m.label}
    </span>
  );
}
