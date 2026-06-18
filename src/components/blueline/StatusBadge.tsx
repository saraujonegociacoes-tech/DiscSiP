import { cn } from "@/lib/utils";

export type CallStatus = "available" | "in-call" | "paused" | "error" | "offline";

const map: Record<CallStatus, { label: string; dot: string; text: string; bg: string }> = {
  available: { label: "Disponível",  dot: "bg-primary",      text: "text-primary",      bg: "bg-primary/10 border-primary/30" },
  "in-call": { label: "Em chamada",  dot: "bg-success animate-pulse", text: "text-success", bg: "bg-success/10 border-success/30" },
  paused:    { label: "Pausado",     dot: "bg-warning",      text: "text-warning",      bg: "bg-warning/10 border-warning/30" },
  error:     { label: "Erro",        dot: "bg-destructive",  text: "text-destructive",  bg: "bg-destructive/10 border-destructive/30" },
  offline:   { label: "Offline",     dot: "bg-muted-foreground", text: "text-muted-foreground", bg: "bg-muted/40 border-border" },
};

export function StatusBadge({ status, className, label }: { status: CallStatus; className?: string; label?: string }) {
  const s = map[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium",
        s.bg, s.text, className
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} />
      {label ?? s.label}
    </span>
  );
}
