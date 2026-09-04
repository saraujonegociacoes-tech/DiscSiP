'use client'

import { formatDistanceToNow, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { AlertTriangle, Check, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Fonte } from '@/lib/sync/fontes'
import { useSincronizacao } from './useSincronizacao'

// Botão "Atualizar" dos painéis — a porta de entrada da ingestão sob demanda.
// Ver docs/ingestao-docs/updates/ingestao-sob-demanda.md
//
// Ele mostra em qual dos quatro estados a pessoa caiu, porque cada um pede uma
// leitura diferente da tela:
//   sincronizando → "você" está puxando; o contador sobe
//   aguardando    → outra pessoa está puxando; o contador é o dela
//   recente       → concluída há pouco; nada a fazer, e o relógio diz quando libera
//   erro          → a rodada caiu; a tela continua com o dado anterior, íntegro
//
// `fontes` aceita mais de uma porque o painel do CEO come de dois pipes (Financeiro e
// Negociação). Elas rodam em sequência, e o botão só descansa quando as duas acabam.

function haQuantoTempo(iso: string | null): string | null {
  if (!iso) return null
  try {
    return formatDistanceToNow(parseISO(iso), { locale: ptBR, addSuffix: false })
  } catch {
    return null
  }
}

function relogio(segundos: number): string {
  const m = Math.floor(segundos / 60)
  const s = segundos % 60
  return m > 0 ? `${m}m${String(s).padStart(2, '0')}` : `${s}s`
}

export function BotaoAtualizar({
  fontes,
  aoConcluir,
  className,
}: {
  fontes: Fonte[]
  /** Chamado quando a rodada termina e o dado da tela mudou. Refaça a leitura aqui. */
  aoConcluir?: () => void
  className?: string
}) {
  const { estado, atualizar, ocupado } = useSincronizacao(fontes, aoConcluir)

  const bloqueado = ocupado || estado.liberaEm > 0
  const desde = haQuantoTempo(estado.atualizadoEm)

  const rotulo = (() => {
    if (estado.fase === 'sincronizando') {
      return estado.cards > 0 ? `Atualizando… ${estado.cards} cards` : 'Atualizando…'
    }
    if (estado.fase === 'aguardando') {
      return estado.cards > 0 ? `Atualizando… ${estado.cards} cards` : 'Atualizando…'
    }
    if (estado.fase === 'recente' && estado.liberaEm > 0) return 'Atualizado agora'
    if (estado.fase === 'erro') return 'Tentar de novo'
    return 'Atualizar'
  })()

  const legenda = (() => {
    if (estado.fase === 'aguardando') return 'outra pessoa já está atualizando'
    if (estado.fase === 'erro') return estado.erro ?? 'a rodada falhou'
    if (estado.liberaEm > 0) return `libera em ${relogio(estado.liberaEm)}`
    if (desde) return `atualizado há ${desde}`
    return null
  })()

  return (
    <div className={cn('flex items-center gap-2', className)}>
      {legenda && (
        <span
          className={cn(
            'text-xs text-muted-foreground',
            estado.fase === 'erro' && 'text-destructive'
          )}
          // O detalhe do erro pode ser longo (mensagem do Pipefy ou do PostgREST);
          // o título entrega inteiro sem esticar o cabeçalho.
          title={estado.fase === 'erro' ? (estado.erro ?? undefined) : undefined}
        >
          {estado.fase === 'erro' && <AlertTriangle className="mr-1 inline size-3" />}
          {legenda}
        </span>
      )}
      <Button
        variant="outline"
        size="sm"
        onClick={atualizar}
        disabled={bloqueado}
        aria-busy={ocupado}
      >
        {estado.fase === 'recente' && estado.liberaEm > 0 ? (
          <Check className="size-4" />
        ) : (
          <RefreshCw className={cn('size-4', ocupado && 'animate-spin')} />
        )}
        {rotulo}
      </Button>
    </div>
  )
}
