'use client'

import { useEffect, useRef, useState } from 'react'

// Count-up sóbrio para KPIs (S4). Anima de 0 (na montagem) ou do valor anterior (na troca de
// período) até `target`, com easing suave, em ~`duration` ms. Respeita
// prefers-reduced-motion: pula direto pro valor final. Retorna o inteiro corrente.
export function useCountUp(target: number, duration = 600): number {
  const [value, setValue] = useState(0)
  const fromRef = useRef(0) // último valor assentado (ponto de partida da próxima animação)

  useEffect(() => {
    const reduce =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const from = fromRef.current
    if (reduce || from === target) {
      fromRef.current = target
      setValue(target)
      return
    }

    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3) // easeOutCubic
      setValue(Math.round(from + (target - from) * eased))
      if (t < 1) {
        raf = requestAnimationFrame(tick)
      } else {
        fromRef.current = target
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, duration])

  return value
}
