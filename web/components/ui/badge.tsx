import * as React from "react";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "good" | "warning" | "critical" | "info";
const tones: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  good: "bg-good/12 text-good",
  warning: "bg-warning/15 text-warning",
  critical: "bg-destructive/12 text-destructive",
  info: "bg-primary/12 text-primary",
};

export function Badge({ tone = "neutral", className, ...props }: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium [&_svg]:size-3", tones[tone], className)}
      {...props}
    />
  );
}
