'use client'

import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from 'react'

/**
 * Alvos que NUNCA iniciam o arrasto: cards do dnd-kit (marcados com `data-no-pan`)
 * e controles nativos, que precisam do proprio clique/selecao.
 */
const NO_PAN = 'button, a, input, textarea, select, [data-no-pan]'

/** Pixels de movimento antes de virar "arrasto" — abaixo disso ainda e um clique. */
const THRESHOLD = 4

/**
 * Pan horizontal "de mao": segurar o botao do mouse no fundo do container e puxar
 * para os lados, no lugar da barra de rolagem.
 *
 * Custo de CPU proximo de zero por design:
 * - `pointermove`/`pointerup` so existem ENQUANTO o botao esta pressionado;
 * - o pan escreve direto em `el.scrollLeft` (sem estado React → sem re-render da arvore
 *   de cards a cada pixel), e o cursor sai de um `classList.toggle` no proprio no;
 * - a posicao inicial e lida uma unica vez no pointerdown, entao o move nunca forca
 *   um reflow sincrono por leitura de layout.
 */
export function useDragScroll<T extends HTMLElement>() {
  const ref = useRef<T>(null)

  const onPointerDown = useCallback((e: ReactPointerEvent<T>) => {
    const el = ref.current
    // So botao principal, e nunca em cima de um card/controle.
    if (!el || e.button !== 0 || (e.target as Element).closest(NO_PAN)) return

    const startX = e.clientX
    const startScroll = el.scrollLeft
    let panning = false

    // Suprime a selecao de texto durante o gesto (o `select-none` sai no pointerup).
    el.classList.add('select-none')

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX
      if (!panning) {
        if (Math.abs(dx) < THRESHOLD) return
        panning = true
        el.classList.add('cursor-grabbing')
      }
      el.scrollLeft = startScroll - dx
    }

    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      el.classList.remove('select-none', 'cursor-grabbing')
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }, [])

  return { ref, onPointerDown }
}
