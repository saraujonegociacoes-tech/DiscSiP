'use client'

import { useTheme } from "./theme";

/** Recharts uses inline styles, not CSS vars — give it theme-aware values. */
export function useChartTheme() {
  const { theme } = useTheme();
  const dark = theme === "dark";
  return {
    grid: dark ? "rgba(255,255,255,0.06)" : "rgba(15,30,80,0.08)",
    axis: dark ? "#AAB4D0" : "#4a5b80",
    tooltip: {
      background: dark ? "#07133F" : "#ffffff",
      border: dark ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(15,30,80,0.10)",
      borderRadius: 12,
      color: dark ? "#fff" : "#0a1230",
      fontSize: 12,
      boxShadow: dark
        ? "0 20px 40px -16px rgba(0,0,0,0.7)"
        : "0 12px 30px -10px rgba(15,30,80,0.25)",
    } as const,
    legend: { fontSize: 12, color: dark ? "#AAB4D0" : "#4a5b80" } as const,
    series: {
      primary: "#0066CC",
      success: "#00C2A8",
      warning: "#FFB020",
      danger:  "#FF4D4F",
    },
    // Paleta CATEGÓRICA validada (skill dataviz: banda de luminosidade, piso de croma,
    // separação CVD e contraste na superfície do card — light #fcfcfb / dark #07133F).
    // Passos próprios por tema, ordem fixa (não ciclar); overflow → `muted` ("Outros").
    // Usada onde a cor identifica categorias (ex.: DeadReasonsDonut).
    categorical: dark
      ? ["#3987e5", "#199e70", "#c98500", "#9085e9", "#e66767", "#d55181"]
      : ["#2a78d6", "#1baf7a", "#eda100", "#4a3aa7", "#e34948", "#e87ba4"],
    muted: dark ? "#a2acc4" : "#898781",
  };
}
