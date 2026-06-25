import { useEffect, useRef } from "react";

/**
 * Marca data-visible="true|false" baseado em IntersectionObserver.
 * Animações são CSS (.aj-reveal).
 */
export function useReveal<T extends HTMLElement>(options?: {
  threshold?: number;
  once?: boolean;
  rootMargin?: string;
}) {
  const ref = useRef<T | null>(null);
  const { threshold = 0.18, once = false, rootMargin = "0px 0px -10% 0px" } = options ?? {};

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.classList.add("aj-reveal");
    el.dataset.visible = "false";

    if (typeof window === "undefined" || !("IntersectionObserver" in window)) {
      el.dataset.visible = "true";
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const visible = entry.isIntersecting;
          el.dataset.visible = visible ? "true" : "false";
          if (visible && once) io.unobserve(el);
        }
      },
      { threshold, rootMargin }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold, once, rootMargin]);

  return ref;
}
