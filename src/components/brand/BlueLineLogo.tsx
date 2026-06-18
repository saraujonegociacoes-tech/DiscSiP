import { cn } from "@/lib/utils";

type Props = {
  className?: string;
  variant?: "full" | "compact";
  tagline?: boolean;
};

export function BlueLineLogo({ className, variant = "full", tagline = true }: Props) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <Mark />
      {variant === "full" && (
        <div className="leading-none">
          <div className="text-[15px] font-bold tracking-[0.18em] text-foreground">
            BLUE LINE
          </div>
          {tagline && (
            <div className="mt-1 text-[10px] font-medium tracking-[0.32em] text-muted-foreground">
              POWER DIALER
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function Mark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 40 40"
      className={cn("h-9 w-9 shrink-0", className)}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <defs>
        <linearGradient id="bl-mark" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#0066CC" />
          <stop offset="100%" stopColor="#00C2A8" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="38" height="38" rx="10" fill="#07133F" stroke="url(#bl-mark)" strokeWidth="1.2" />
      {/* voice waves — short, medium, long, medium, short */}
      <g stroke="url(#bl-mark)" strokeWidth="2.4" strokeLinecap="round">
        <line x1="10" y1="17" x2="10" y2="23" />
        <line x1="15" y1="13" x2="15" y2="27" />
        <line x1="20" y1="9"  x2="20" y2="31" />
        <line x1="25" y1="13" x2="25" y2="27" />
        <line x1="30" y1="17" x2="30" y2="23" />
      </g>
    </svg>
  );
}
