import { useEffect, useRef } from "react";

/**
 * Aplica translate3d(0, scrollY * speed, 0) ao elemento.
 * speed positivo move pra baixo (mais lento que scroll), negativo pra cima.
 */
export function useParallax<T extends HTMLElement>(speed = 0.2) {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof window === "undefined") return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;

    let raf = 0;

    const update = () => {
      const rect = el.getBoundingClientRect();
      const viewportH = window.innerHeight;
      // Distância do centro do elemento ao centro da viewport
      const center = rect.top + rect.height / 2 - viewportH / 2;
      const offset = -center * speed;
      el.style.transform = `translate3d(0, ${offset.toFixed(2)}px, 0)`;
      raf = 0;
    };

    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [speed]);

  return ref;
}
