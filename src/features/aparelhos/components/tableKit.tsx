'use client'

import * as React from 'react'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { ChevronDown, ChevronUp, ChevronsUpDown, Loader2, Pencil, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'

// Peças comuns das três abas de cadastro da Central de Aparelhos (Aparelhos, Chips,
// Pessoas). Elas têm colunas diferentes mas MECÂNICA idêntica: mesma casca de card,
// mesma ordenação por clique no cabeçalho, mesmos botões de editar/excluir. Sem isto
// seriam três cópias da mesma lógica de ordenação — o tipo de duplicação que fez
// nascer o `lib/csv.ts` (ver o comentário de lá).
//
// A ordenação segue as regras já validadas na MinutasLista: `kind` decide a direção
// do PRIMEIRO clique (o 2º inverte) e NULOS VÃO SEMPRE PRO FIM, nos dois sentidos —
// campo vazio é ausência de informação, não o "menor" de todos.

export type ColKind = 'texto' | 'numero'

export type Col<T> = {
  label: string
  align?: 'left' | 'center' | 'right'
  kind?: ColKind
  /** Valor usado pra ordenar. Ausente = coluna não ordenável (ex.: Ações). */
  get?: (row: T) => string | number | null
}

export type SortDir = 'asc' | 'desc'
export type SortState<K extends string> = { key: K; dir: SortDir }

const DIR_INICIAL: Record<ColKind, SortDir> = { texto: 'asc', numero: 'desc' }

export function useTableSort<K extends string>(key: K, dir: SortDir = 'asc') {
  const [sort, setSort] = useState<SortState<K>>({ key, dir })
  const toggle = (k: K, kind: ColKind = 'texto') =>
    setSort((s) => (s.key === k ? { key: k, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: DIR_INICIAL[kind] }))
  return { sort, toggle }
}

/**
 * Ordena as linhas pela coluna ativa. `desempate` mantém a ordem estável quando a
 * coluna empata (senão a lista "dança" a cada render com valores repetidos).
 */
export function ordenar<T, K extends string>(
  rows: T[],
  cols: Record<K, Col<T>>,
  sort: SortState<K>,
  desempate: (a: T, b: T) => number,
): T[] {
  const col = cols[sort.key]
  if (!col?.get) return rows
  const get = col.get
  const mul = sort.dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const av = get(a)
    const bv = get(b)
    const an = av === null || av === ''
    const bn = bv === null || bv === ''
    if (an !== bn) return an ? 1 : -1 // nulos sempre por último
    if (!an && !bn) {
      const d =
        typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av).localeCompare(String(bv), 'pt-BR')
      if (d !== 0) return d * mul
    }
    return desempate(a, b)
  })
}

const alinhamento = (align: Col<unknown>['align']) =>
  align === 'center' ? 'text-center' : align === 'right' ? 'text-right' : 'text-left'

/**
 * Linha de cabeçalhos clicáveis. É uma função que devolve JSX chamada pelo `<tr>`,
 * não um componente montado por célula — declarar um componente por `<th>`
 * remontaria todos a cada render.
 */
export function cabecalhos<T, K extends string>(
  cols: Record<K, Col<T>>,
  ordem: K[],
  sort: SortState<K>,
  toggle: (k: K, kind?: ColKind) => void,
): ReactNode[] {
  return ordem.map((k) => {
    const c = cols[k]
    const ativa = sort.key === k
    const Icon = !ativa ? ChevronsUpDown : sort.dir === 'asc' ? ChevronUp : ChevronDown
    if (!c.get) {
      return (
        <th key={k} scope="col" className={cn('px-3 py-2', alinhamento(c.align))}>
          {c.label}
        </th>
      )
    }
    return (
      <th
        key={k}
        scope="col"
        aria-sort={ativa ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
        className={cn('px-3 py-2', alinhamento(c.align))}
      >
        <button
          type="button"
          onClick={() => toggle(k, c.kind)}
          title={`Ordenar por ${c.label}`}
          className={cn(
            'inline-flex items-center gap-1 rounded transition-colors hover:text-foreground',
            ativa ? 'text-foreground' : 'text-muted-foreground',
          )}
        >
          {c.label}
          <Icon className={cn('h-3 w-3 shrink-0', ativa ? 'opacity-100' : 'opacity-40')} />
        </button>
      </th>
    )
  })
}

// ── Cascas ───────────────────────────────────────────────────────────────────

export function BarraDeControle({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-gradient-card p-3 shadow-card">
      {children}
    </div>
  )
}

export function PainelTabela({
  titulo,
  resumo,
  children,
  rodape,
}: {
  titulo: string
  resumo?: string
  children: ReactNode
  rodape?: ReactNode
}) {
  return (
    <div className="rounded-2xl border border-border bg-gradient-card p-4 shadow-elevated">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">{titulo}</h2>
        {resumo && <span className="text-xs tabular-nums text-muted-foreground">{resumo}</span>}
      </div>
      {children}
      {rodape && <p className="mt-2 text-[11px] text-muted-foreground">{rodape}</p>}
    </div>
  )
}

export function RolagemTabela({ children }: { children: ReactNode }) {
  return (
    <div className="scrollbar-slim max-h-[600px] overflow-auto rounded-xl border border-border">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  )
}

export function CabecalhoTabela({ children }: { children: ReactNode }) {
  return (
    <thead className="sticky top-0 z-10">
      <tr className="bg-background/95 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground backdrop-blur">
        {children}
      </tr>
    </thead>
  )
}

export function Vazio({ icone: Icone, children }: { icone: React.ElementType; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-gradient-card p-10 text-center shadow-card">
      <Icone className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" />
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  )
}

/** Editar + excluir no fim da linha. `editar` é o próprio diálogo de edição. */
export function AcoesLinha({
  editar,
  onExcluir,
  excluindo,
  tituloExcluir,
  podeEscrever,
}: {
  editar: ReactNode
  onExcluir: () => void
  excluindo: boolean
  tituloExcluir: string
  podeEscrever: boolean
}) {
  if (!podeEscrever) return <span className="text-xs text-muted-foreground">—</span>
  return (
    <div className="flex items-center justify-end gap-1">
      {editar}
      <button
        type="button"
        onClick={onExcluir}
        disabled={excluindo}
        title={tituloExcluir}
        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
      >
        {excluindo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
      </button>
    </div>
  )
}

/**
 * Botão-lápis usado como gatilho dos diálogos de edição.
 *
 * ⚠️ Repassa props e ref pelo mesmo motivo do BotaoNovo: vive dentro de um
 * `<DialogTrigger asChild>`, que clona este elemento injetando `onClick` e `ref`.
 * Sem o repasse o lápis aparece, aceita o clique e não abre nada.
 */
export const BotaoEditar = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { titulo: string }
>(({ titulo, className, ...props }, ref) => (
  <button
    type="button"
    ref={ref}
    title={titulo}
    {...props}
    className={cn(
      'rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary',
      className,
    )}
  >
    <Pencil className="h-3.5 w-3.5" />
  </button>
))
BotaoEditar.displayName = 'BotaoEditar'

/** Select em linha (trocar responsável/status/aparelho sem abrir o formulário). */
export const selectLinhaCls =
  'rounded-lg border border-border bg-background px-2 py-1 text-xs text-foreground outline-none focus:border-primary disabled:opacity-60'
