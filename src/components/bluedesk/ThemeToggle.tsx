'use client'

import { Moon, Sun } from "lucide-react";
import { useTheme } from "./theme";
import { cn } from "@/lib/utils";

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? "Mudar para tema claro" : "Mudar para tema escuro"}
      title={isDark ? "Tema claro" : "Tema escuro"}
      className={cn(
        "group relative inline-flex h-9 w-16 items-center rounded-full border border-border",
        "bg-gradient-card shadow-card transition-colors hover:bg-accent/60",
        className
      )}
    >
      <span
        className={cn(
          "absolute top-1 flex h-7 w-7 items-center justify-center rounded-full",
          "bg-gradient-primary text-primary-foreground shadow-glow transition-all duration-300",
          isDark ? "left-[calc(100%-2rem)]" : "left-1"
        )}
      >
        {isDark ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
      </span>
      <Sun className={cn("absolute left-2 h-3.5 w-3.5 transition-opacity", isDark ? "opacity-40" : "opacity-0")} />
      <Moon className={cn("absolute right-2 h-3.5 w-3.5 transition-opacity", isDark ? "opacity-0" : "opacity-40")} />
    </button>
  );
}
