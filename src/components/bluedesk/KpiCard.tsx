import { cn } from "@/lib/utils";
import { type LucideIcon, TrendingUp, TrendingDown } from "lucide-react";

type Props = {
  label: string;
  value: string;
  delta?: { value: string; positive?: boolean };
  icon?: LucideIcon;
  className?: string;
};

export function KpiCard({ label, value, delta, icon: Icon, className }: Props) {
  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-2xl border border-border bg-gradient-card p-5 shadow-card lift",
        className
      )}
    >
      {/* corner glow */}
      <div className="pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full bg-primary/15 blur-3xl transition-opacity group-hover:bg-primary/25" />

      <div className="relative flex items-start justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </div>
        {Icon && (
          <div className="rounded-xl bg-gradient-primary p-2 text-primary-foreground shadow-glow">
            <Icon className="h-4 w-4" />
          </div>
        )}
      </div>

      <div className="relative mt-3 text-3xl font-semibold tracking-tight text-foreground">
        {value}
      </div>

      {delta && (
        <div
          className={cn(
            "relative mt-2 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
            delta.positive
              ? "border-success/30 bg-success/10 text-success"
              : "border-destructive/30 bg-destructive/10 text-destructive"
          )}
        >
          {delta.positive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
          {delta.value}
        </div>
      )}

      {/* top edge accent */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent opacity-60" />
    </div>
  );
}
