'use client'

import * as React from 'react'
import { gsap } from 'gsap'

import './accordion-gallery.css'

/**
 * AccordionGallery (react-bits) portado para TS e adaptado: no original cada
 * painel e uma imagem; aqui cada painel carrega conteudo React arbitrario.
 *
 * O motor de layout continua o mesmo — GSAP anima `flex-grow` (painel ativo
 * cresce, os outros encolhem) mais uma leve rotacao 3D nos vizinhos, e o corpo
 * do painel ativo entra com fade. Colapsado, o painel mostra o titulo na vertical.
 */
export type AccordionGalleryItem = {
  id: string
  /** Titulo curto — vai na vertical quando o painel esta colapsado. */
  label: string
  /** Cor de destaque do painel (barra do topo + veu). Default: --primary. */
  accent?: string
  /** Linha curta ao lado do titulo enquanto o painel esta fechado (prazo, contador…). */
  meta?: string
  /** Conteudo exibido quando o painel esta aberto. */
  content: React.ReactNode
}

export type AccordionGalleryProps = {
  items: AccordionGalleryItem[]
  /** Indice aberto na montagem. */
  defaultIndex?: number
  /** Altura do trilho, em px. */
  height?: number
  gap?: number
  radius?: number
  /** Fatia da largura que o painel ativo ocupa (0.2 – 0.9). */
  expandRatio?: number
  duration?: number
  ease?: string
  /** Inclinacao 3D dos painieis vizinhos, em graus. */
  tilt?: number
  /** Escala dos painieis fora de foco. Abaixo de ~0.94 a fila comeca a parecer quebrada. */
  depthScale?: number
  trigger?: 'hover' | 'click'
  className?: string
}

export function AccordionGallery({
  items,
  defaultIndex = 0,
  height = 460,
  gap = 10,
  radius = 16,
  expandRatio = 0.52,
  duration = 0.6,
  ease = 'power3.out',
  tilt = 8,
  depthScale = 0.965,
  trigger = 'click',
  className = '',
}: AccordionGalleryProps) {
  const panelRefs = React.useRef<(HTMLDivElement | null)[]>([])
  const bodyRefs = React.useRef<(HTMLDivElement | null)[]>([])
  const spineRefs = React.useRef<(HTMLDivElement | null)[]>([])
  const tlRef = React.useRef<gsap.core.Timeline | null>(null)
  const firstRunRef = React.useRef(true)

  const count = items.length
  const [active, setActive] = React.useState(() =>
    Math.min(Math.max(defaultIndex, 0), Math.max(count - 1, 0)),
  )

  React.useEffect(() => {
    // Se a lista encolher (tarefa excluida/filtrada), o indice pode ficar fora do
    // range — e os refs dos paineis que sumiram continuariam no array, segurando
    // nos do DOM e entrando no forEach da animacao.
    panelRefs.current.length = count
    bodyRefs.current.length = count
    spineRefs.current.length = count
    setActive((i) => Math.min(i, Math.max(count - 1, 0)))
  }, [count])

  // Lido uma vez: `matchMedia` a cada render cria um MediaQueryList novo a toa.
  const [prefersReduced] = React.useState(
    () =>
      typeof window !== 'undefined' &&
      !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  )

  const applyLayout = React.useCallback(
    (animate: boolean) => {
      const panels = panelRefs.current
      if (!panels.length) return

      const r = Math.min(Math.max(expandRatio, 0.2), 0.9)
      const grow = count > 1 ? (r * (count - 1)) / (1 - r) : 1

      tlRef.current?.kill()
      const dur = animate && !prefersReduced ? duration : 0
      const tl = gsap.timeline()

      panels.forEach((panel, i) => {
        if (!panel) return
        const isActive = i === active
        const rot = isActive ? 0 : i < active ? tilt : -tilt

        // `--ag-depth` (0 = em foco, 1 = ao fundo) e o canal de profundidade que
        // precisa acompanhar a animacao quadro a quadro; o CSS o usa so na opacidade
        // das camadas __dim e __lift. Borda, sombra e desfoque ficam presos a classe
        // `--active`, com transicao de CSS — sao pintura, caras demais para rodar a
        // cada quadro em todos os paineis.
        tl.to(
          panel,
          {
            flexGrow: isActive ? grow : 1,
            rotateY: rot,
            scale: isActive ? 1 : depthScale,
            '--ag-depth': isActive ? 0 : 1,
            duration: dur,
            ease,
          },
          0,
        )

        const body = bodyRefs.current[i]
        if (body) {
          tl.to(
            body,
            {
              opacity: isActive ? 1 : 0,
              x: isActive ? 0 : -12,
              duration: isActive ? dur : dur * 0.4,
              ease,
              // so o painel aberto recebe clique; os fechados deixam passar p/ o painel
              pointerEvents: isActive ? 'auto' : 'none',
            },
            0,
          )
        }

        const spine = spineRefs.current[i]
        if (spine) {
          tl.to(spine, { opacity: isActive ? 0 : 1, duration: dur * 0.5, ease }, 0)
        }
      })

      // Terminada a transicao, o painel em foco perde o `transform` inline. Ele ja
      // e a identidade (scale 1, rotateY 0), mas enquanto existir o navegador mantem
      // o elemento numa camada de composicao — e texto em camada propria perde a
      // suavizacao subpixel, que e o que faz a fonte parecer fina e cinzenta.
      tl.eventCallback('onComplete', () => {
        const focused = panelRefs.current[active]
        if (focused) gsap.set(focused, { clearProps: 'transform' })
      })

      tlRef.current = tl
    },
    [active, count, expandRatio, duration, ease, tilt, depthScale, prefersReduced],
  )

  /**
   * Spotlight: guarda a posicao do ponteiro em custom properties do proprio painel.
   * Nao ha estado de React nem re-render — o brilho e uma camada de CSS lendo
   * `--ag-mx`/`--ag-my`.
   *
   * O evento so ANOTA a posicao; a medida e a escrita acontecem uma vez por quadro,
   * dentro do rAF. `pointermove` dispara mais rapido que o quadro, e cada
   * `getBoundingClientRect` no meio do gesto forca o navegador a recalcular layout —
   * durante a transicao do accordion, que ja esta mudando `flex-grow` a cada quadro,
   * isso vira um vai-e-vem de leitura/escrita caro.
   */
  const spotlightRef = React.useRef<{ el: HTMLElement; x: number; y: number } | null>(null)
  const spotlightRaf = React.useRef(0)

  const flushSpotlight = React.useCallback(() => {
    spotlightRaf.current = 0
    const hit = spotlightRef.current
    if (!hit) return
    const rect = hit.el.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    hit.el.style.setProperty('--ag-mx', `${((hit.x - rect.left) / rect.width) * 100}%`)
    hit.el.style.setProperty('--ag-my', `${((hit.y - rect.top) / rect.height) * 100}%`)
  }, [])

  function handlePanelPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (prefersReduced) return // o brilho esta desligado no CSS: nem medir
    spotlightRef.current = { el: e.currentTarget, x: e.clientX, y: e.clientY }
    if (!spotlightRaf.current) spotlightRaf.current = requestAnimationFrame(flushSpotlight)
  }

  React.useEffect(() => {
    applyLayout(!firstRunRef.current)
    firstRunRef.current = false
  }, [applyLayout])

  React.useEffect(
    () => () => {
      tlRef.current?.kill()
      if (spotlightRaf.current) cancelAnimationFrame(spotlightRaf.current)
    },
    [],
  )

  function open(i: number) {
    if (i === active) return
    setActive(i)
  }

  function handleKeyDown(i: number, e: React.KeyboardEvent) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault()
      open((i + 1) % count)
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault()
      open((i - 1 + count) % count)
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      open(i)
    }
  }

  if (!count) return null

  return (
    <div
      className={`accordion-gallery${className ? ` ${className}` : ''}`}
      style={
        {
          '--ag-gap': `${gap}px`,
          '--ag-radius': `${radius}px`,
          height: `${height}px`,
        } as React.CSSProperties
      }
      role="group"
    >
      {items.map((item, i) => {
        const isActive = i === active
        return (
          <div
            key={item.id}
            ref={(el) => {
              panelRefs.current[i] = el
            }}
            className={`ag-panel${isActive ? ' ag-panel--active' : ''}`}
            // Sem `borderRadius` aqui: o CSS ja usa `var(--ag-radius)`, definido
            // uma vez no trilho — repetir por painel era a mesma regra duas vezes.
            style={{ '--ag-accent': item.accent ?? 'var(--primary)' } as React.CSSProperties}
            onClick={() => open(i)}
            onMouseEnter={() => trigger === 'hover' && open(i)}
            onPointerMove={handlePanelPointerMove}
            onFocus={() => open(i)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            role="button"
            tabIndex={0}
            aria-expanded={isActive}
            aria-label={item.label}
          >
            <span className="ag-panel__accent" aria-hidden="true" />
            <span className="ag-panel__lift" aria-hidden="true" />
            <span className="ag-panel__wash" aria-hidden="true" />
            <span className="ag-panel__glare" aria-hidden="true" />
            <span className="ag-panel__dim" aria-hidden="true" />

            <div
              className="ag-panel__spine"
              ref={(el) => {
                spineRefs.current[i] = el
              }}
              aria-hidden={isActive}
            >
              <span className="ag-panel__spine-dot" />
              <span className="ag-panel__spine-text">{item.label}</span>
              {item.meta && <span className="ag-panel__spine-meta">{item.meta}</span>}
            </div>

            <div
              className="ag-panel__body"
              ref={(el) => {
                bodyRefs.current[i] = el
              }}
              aria-hidden={!isActive}
              // painel fechado sai do fluxo de foco/leitor: os botoes de acao dentro
              // dele continuam no DOM, mas nao devem ser tabbable
              inert={!isActive}
            >
              {item.content}
            </div>
          </div>
        )
      })}
    </div>
  )
}

