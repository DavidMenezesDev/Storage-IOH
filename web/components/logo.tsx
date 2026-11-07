import { cn } from "@/lib/utils";

export function Logo({ className, withText = true }: { className?: string; withText?: boolean }) {
  return (
    <span className={cn("flex items-center gap-2 font-semibold tracking-tight", className)}>
      <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden>
        <rect x="2" y="3" width="20" height="5.5" rx="1.6" className="fill-primary" />
        <rect x="2" y="9.75" width="20" height="5.5" rx="1.6" className="fill-primary/70" />
        <rect x="2" y="16.5" width="20" height="5.5" rx="1.6" className="fill-primary/40" />
        <circle cx="18" cy="5.75" r="1" className="fill-white" />
        <circle cx="18" cy="12.5" r="1" className="fill-white" />
        <circle cx="18" cy="19.25" r="1" className="fill-white" />
      </svg>
      {withText && <span>Storage-IOH</span>}
    </span>
  );
}
