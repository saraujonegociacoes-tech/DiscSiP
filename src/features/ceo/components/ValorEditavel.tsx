'use client'

import { useState } from 'react'
import { Check, Pencil } from 'lucide-react'
import { cn } from '@/lib/utils'

// Campo de dinheiro com salvar embutido — clica no número, digita, Enter.
//
// Nasceu dentro do CeoSaudeEquipe.tsx como `CustoInput` (05/ago), único lugar do painel
// que gravava número. Em 02/set o card "Diária" da aba Financeiro passou a precisar do
// MESMO gesto para a meta esperada, e o componente saiu de lá para cá — sem mudar de
// comportamento: a Saúde da Equipe passou a importar este arquivo no lugar da cópia
// local. Duas telas, um campo; se o gesto mudar, muda nos dois.
//
// Fica em features/ceo (e não em components/bluedesk) porque carrega uma ideia que só
// existe neste painel: o valor HERDADO — um número que a tela mostra mas que ninguém
// cadastrou, vindo de um padrão geral. Fora do CEO isso não significa nada.
//
// Só re-renderiza a si mesmo enquanto edita: o estado da digitação mora aqui dentro,
// não na aba (que a cada tecla refaria a tabela inteira de pessoas).

/**
 * Dinheiro digitado em pt-BR ("4.200,00", "4200" ou "R$ 4.200") vira número.
 * Devolve **null** quando o campo está vazio — e null tem significado para quem chama:
 * na Saúde da Equipe apaga o custo próprio da pessoa (ela volta a herdar o geral).
 */
export function parseBrl(s: string): number | null {
  const t = s.trim()
  if (t === '') return null
  const n = Number(t.replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) && n >= 0 ? n : null
}

const brl = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 })

export function ValorEditavel({
  valor,
  herdado,
  onSave,
  compact,
  destaque,
  ariaLabel = 'Valor',
  dicaHerdado = 'Herdando o valor geral — clique para definir um próprio',
}: {
  valor: number
  /** true = está usando um padrão geral, não tem valor próprio cadastrado. */
  herdado?: boolean
  onSave: (v: number | null) => Promise<void>
  compact?: boolean
  /** Número grande, para quando o valor é o assunto do card (o caso da meta). */
  destaque?: boolean
  ariaLabel?: string
  dicaHerdado?: string
}) {
  const [editando, setEditando] = useState(false)
  const [txt, setTxt] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [ok, setOk] = useState(false)

  async function salvar() {
    setSalvando(true)
    await onSave(parseBrl(txt))
    setSalvando(false)
    setEditando(false)
    setOk(true)
    setTimeout(() => setOk(false), 1500)
  }

  if (!editando) {
    return (
      <button
        type="button"
        onClick={() => {
          setTxt(valor ? String(valor).replace('.', ',') : '')
          setEditando(true)
        }}
        className={cn(
          'group inline-flex items-center gap-1.5 rounded-lg px-2 py-1 tabular-nums transition-colors hover:bg-primary/10',
          destaque ? 'text-2xl font-semibold' : compact ? 'text-xs' : 'text-sm',
          herdado ? 'text-muted-foreground' : 'text-foreground',
        )}
        title={herdado ? dicaHerdado : 'Clique para editar'}
      >
        {brl(valor)}
        {herdado && <span className="text-[10px] uppercase tracking-wide">(geral)</span>}
        {ok ? (
          <Check className="h-3 w-3 text-success" />
        ) : (
          <Pencil className={cn('opacity-0 transition-opacity group-hover:opacity-60', destaque ? 'h-4 w-4' : 'h-3 w-3')} />
        )}
      </button>
    )
  }

  return (
    <span className="inline-flex items-center gap-1">
      <input
        autoFocus
        value={txt}
        onChange={(e) => setTxt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void salvar()
          if (e.key === 'Escape') setEditando(false)
        }}
        placeholder="0,00"
        inputMode="decimal"
        className={cn(
          'rounded-lg border border-primary bg-background px-2 py-1 tabular-nums text-foreground outline-none',
          destaque ? 'w-40 text-2xl font-semibold' : compact ? 'w-28 text-xs' : 'w-28 text-sm',
        )}
        aria-label={ariaLabel}
      />
      <button
        type="button"
        onClick={() => void salvar()}
        disabled={salvando}
        className="rounded-lg bg-gradient-primary px-2 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
      >
        {salvando ? '…' : 'ok'}
      </button>
    </span>
  )
}
