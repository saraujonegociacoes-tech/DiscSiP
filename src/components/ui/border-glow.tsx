'use client'

import * as React from 'react'
import './border-glow.css'

/**
 * BorderGlow (react-bits, portado para TS + tokens Blue Desk).
 *
 * Acende a borda do card conforme o cursor se aproxima dela: um cone conico
 * mascara o gradiente colorido e segue o angulo do ponteiro. Tudo acontece em
 * CSS custom properties (--edge-proximity / --cursor-angle) — o React so escreve
 * as duas variaveis no `pointermove`, sem re-render.
 *
 * `backgroundColor` aceita `var(--card)` (substituicao de var e recursiva em CSS),
 * entao o card acompanha o tema claro/escuro sem JS.
 */

type GlowVars = Record<string, string>

function parseHSL(hslStr: string): { h: number; s: number; l: number } {
  const match = hslStr.match(/([\d.]+)\s*([\d.]+)%?\s*([\d.]+)%?/)
  if (!match) return { h: 40, s: 80, l: 80 }
  return { h: parseFloat(match[1]), s: parseFloat(match[2]), l: parseFloat(match[3]) }
}

function buildGlowVars(glowColor: string, intensity: number): GlowVars {
  const { h, s, l } = parseHSL(glowColor)
  const base = `${h}deg ${s}% ${l}%`
  const opacities = [100, 60, 50, 40, 30, 20, 10]
  const keys = ['', '-60', '-50', '-40', '-30', '-20', '-10']
  const vars: GlowVars = {}
  for (let i = 0; i < opacities.length; i++) {
    vars[`--glow-color${keys[i]}`] = `hsl(${base} / ${Math.min(opacities[i] * intensity, 100)}%)`
  }
  return vars
}

const GRADIENT_POSITIONS = ['80% 55%', '69% 34%', '8% 6%', '41% 38%', '86% 85%', '82% 18%', '51% 4%']
const GRADIENT_KEYS = [
  '--gradient-one',
  '--gradient-two',
  '--gradient-three',
  '--gradient-four',
  '--gradient-five',
  '--gradient-six',
  '--gradient-seven',
]
const COLOR_MAP = [0, 1, 2, 0, 1, 2, 1]

function buildGradientVars(colors: string[]): GlowVars {
  const vars: GlowVars = {}
  for (let i = 0; i < 7; i++) {
    const c = colors[Math.min(COLOR_MAP[i], colors.length - 1)]
    vars[GRADIENT_KEYS[i]] = `radial-gradient(at ${GRADIENT_POSITIONS[i]}, ${c} 0px, transparent 50%)`
  }
  vars['--gradient-base'] = `linear-gradient(${colors[0]} 0 100%)`
  return vars
}

/* No modulo, nao no default da prop: um literal no parametro nasce com identidade
   nova a cada render e invalidaria o useMemo do `style` toda vez. */
const DEFAULT_COLORS = ['#0066CC', '#00C2A8', '#001F5B']

export type BorderGlowProps = {
  children: React.ReactNode
  className?: string
  /** % de aproximacao da borda a partir da qual o brilho comeca a aparecer. */
  edgeSensitivity?: number
  /** Cor do halo, em componentes HSL crus: "H S L" (ex.: "205 90 60"). */
  glowColor?: string
  /** Fundo do card. Aceita `var(--card)` para seguir o tema. */
  backgroundColor?: string
  borderRadius?: number
  glowRadius?: number
  glowIntensity?: number
  coneSpread?: number
  colors?: string[]
  fillOpacity?: number
}

export function BorderGlow({
  children,
  className = '',
  edgeSensitivity = 30,
  glowColor = '205 90 60',
  backgroundColor = 'var(--card)',
  borderRadius = 16,
  glowRadius = 40,
  glowIntensity = 1.0,
  coneSpread = 25,
  colors = DEFAULT_COLORS,
  fillOpacity = 0.5,
}: BorderGlowProps) {
  const cardRef = React.useRef<HTMLDivElement>(null)
  const pointerRef = React.useRef<{ x: number; y: number } | null>(null)
  const rafRef = React.useRef(0)

  /**
   * O evento so anota a posicao; medir e escrever acontece uma vez por quadro.
   * `pointermove` dispara mais rapido que o quadro, e cada `getBoundingClientRect`
   * dentro do handler forca o navegador a recalcular layout no meio do gesto.
   */
  const flush = React.useCallback(() => {
    rafRef.current = 0
    const card = cardRef.current
    const pointer = pointerRef.current
    if (!card || !pointer) return

    const rect = card.getBoundingClientRect()
    const cx = rect.width / 2
    const cy = rect.height / 2
    if (!cx || !cy) return
    const dx = pointer.x - rect.left - cx
    const dy = pointer.y - rect.top - cy

    // Proximidade da borda: 0 no centro, 1 encostando na moldura.
    const kx = dx !== 0 ? cx / Math.abs(dx) : Infinity
    const ky = dy !== 0 ? cy / Math.abs(dy) : Infinity
    const edge = Math.min(Math.max(1 / Math.min(kx, ky), 0), 1)

    let angle = 0
    if (dx !== 0 || dy !== 0) {
      angle = Math.atan2(dy, dx) * (180 / Math.PI) + 90
      if (angle < 0) angle += 360
    }

    card.style.setProperty('--edge-proximity', (edge * 100).toFixed(3))
    card.style.setProperty('--cursor-angle', `${angle.toFixed(3)}deg`)
  }, [])

  const handlePointerMove = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      pointerRef.current = { x: e.clientX, y: e.clientY }
      if (!rafRef.current) rafRef.current = requestAnimationFrame(flush)
    },
    [flush],
  )

  React.useEffect(
    () => () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    },
    [],
  )

  // Sao 15 custom properties montadas por concatenacao de string; sem o memo elas
  // seriam remontadas a cada tecla digitada no formulario que este card envolve.
  const style = React.useMemo(
    () =>
      ({
        '--card-bg': backgroundColor,
        '--edge-sensitivity': edgeSensitivity,
        '--border-radius': `${borderRadius}px`,
        '--glow-padding': `${glowRadius}px`,
        '--cone-spread': coneSpread,
        '--fill-opacity': fillOpacity,
        ...buildGlowVars(glowColor, glowIntensity),
        ...buildGradientVars(colors),
      }) as React.CSSProperties,
    [
      backgroundColor,
      edgeSensitivity,
      borderRadius,
      glowRadius,
      coneSpread,
      fillOpacity,
      glowColor,
      glowIntensity,
      colors,
    ],
  )

  return (
    <div
      ref={cardRef}
      onPointerMove={handlePointerMove}
      className={`border-glow-card ${className}`}
      style={style}
    >
      <span className="edge-light" />
      <div className="border-glow-inner">{children}</div>
    </div>
  )
}

