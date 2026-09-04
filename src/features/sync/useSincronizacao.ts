'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Fonte } from '@/lib/sync/fontes'

// Estado do botão "Atualizar" — o lado cliente da ingestão sob demanda.
// Ver docs/ingestao-docs/updates/ingestao-sob-demanda.md
//
// ── POR QUE O LOOP MORA AQUI ────────────────────────────────────────────────
// Uma invocação do Worker dá conta de UMA página (10 ms de CPU, 50 subrequests no
// plano Free). Então quem executa a rodada chama a rota repetidas vezes com o mesmo
// token: cada chamada é uma invocação nova, com orçamento novo. A rodada continua
// indo até `hasNextPage = false` — sem teto, sem parar no meio.
//
// ⚠️ Quem AGUARDA também fica chamando (a cada 3s). Isso não é polling à toa: cada
// chamada é uma nova tentativa de reivindicação, então se o executor fechar a aba no
// meio e a trava expirar, quem está esperando ASSUME a rodada e a leva até o fim, do
// cursor que ficou salvo. A rodada se conclui sozinha; ninguém vê estado parcial
// porque a tela só recarrega no fim.

export type FaseSync = 'ocioso' | 'sincronizando' | 'aguardando' | 'recente' | 'erro'

export type EstadoSync = {
  fase: FaseSync
  cards: number
  atualizadoEm: string | null
  /** Segundos que faltam para o cooldown liberar. 0 = liberado. */
  liberaEm: number
  erro: string | null
}

type Resposta = {
  status: 'iniciado' | 'pronto' | 'aguardando' | 'recente' | 'erro_recente' | 'erro'
  done?: boolean
  token?: string
  cards?: number
  paginas?: number
  atualizadoEm?: string | null
  liberaEm?: number
  erro?: string
}

// Guarda de sanidade: 400 páginas × 30 cards ≈ 12 mil cards numa rodada. Um delta
// normal são 1 ou 2 páginas; este número existe só para um bug de paginação não virar
// laço infinito no navegador de alguém.
const MAX_PAGINAS = 400
const INTERVALO_ESPERA_MS = 3000

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function useSincronizacao(fontes: Fonte[], aoConcluir?: () => void) {
  const [estado, setEstado] = useState<EstadoSync>({
    fase: 'ocioso',
    cards: 0,
    atualizadoEm: null,
    liberaEm: 0,
    erro: null,
  })

  const emAndamento = useRef(false)
  const desmontado = useRef(false)
  const concluir = useRef(aoConcluir)
  concluir.current = aoConcluir

  // A lista vem inline do componente (`['financeiro','negociacao']`), então muda de
  // identidade a cada render. Guardar num ref evita reinstalar o efeito por isso.
  const fontesRef = useRef(fontes)
  fontesRef.current = fontes
  const chaveFontes = fontes.join(',')

  useEffect(() => {
    desmontado.current = false
    return () => {
      desmontado.current = true
    }
  }, [])

  // Estado inicial: a mais ATRASADA das fontes do painel manda no rótulo. Mostrar a
  // mais recente daria a impressão de frescor que a tela não tem.
  useEffect(() => {
    let cancelado = false
    Promise.all(
      fontesRef.current.map((f) =>
        fetch(`/api/sync/${f}`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null)
      )
    ).then((estados) => {
      if (cancelado || desmontado.current) return
      const carimbos = estados
        .map((e) => e?.atualizadoEm as string | null | undefined)
        .filter((v): v is string => Boolean(v))
      if (carimbos.length === 0) return
      const maisAntigo = carimbos.reduce((a, b) => (a < b ? a : b))
      setEstado((s) => (s.fase === 'ocioso' ? { ...s, atualizadoEm: maisAntigo } : s))
    })
    return () => {
      cancelado = true
    }
  }, [chaveFontes])

  // Contagem regressiva do cooldown.
  useEffect(() => {
    if (estado.liberaEm <= 0) return
    const t = setTimeout(() => {
      setEstado((s) => ({
        ...s,
        liberaEm: Math.max(0, s.liberaEm - 1),
        fase: s.liberaEm - 1 <= 0 && s.fase === 'recente' ? 'ocioso' : s.fase,
      }))
    }, 1000)
    return () => clearTimeout(t)
  }, [estado.liberaEm, estado.fase])

  const chamar = useCallback(async (fonte: Fonte, token?: string): Promise<Resposta> => {
    const res = await fetch(`/api/sync/${fonte}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(token ? { token } : {}),
    })
    const json = (await res.json().catch(() => ({}))) as Partial<Resposta> & { erro?: string }
    if (!res.ok && !json.status) {
      return { status: 'erro', erro: json.erro ?? `HTTP ${res.status}` }
    }
    return json as Resposta
  }, [])

  /** Leva UMA fonte até o fim. Devolve se o dado da tela mudou. */
  const sincronizarFonte = useCallback(
    async (fonte: Fonte): Promise<{ mudou: boolean; resposta: Resposta }> => {
      let token: string | undefined
      let aguardou = false
      let ultima: Resposta = { status: 'erro', erro: 'sem resposta' }

      for (let i = 0; i < MAX_PAGINAS && !desmontado.current; i++) {
        ultima = await chamar(fonte, token)

        if (ultima.status === 'iniciado') {
          token = ultima.token
          setEstado((s) => ({
            ...s,
            fase: 'sincronizando',
            cards: ultima.cards ?? s.cards,
            erro: null,
          }))
          continue
        }

        if (ultima.status === 'aguardando') {
          aguardou = true
          // Solta o token: na próxima volta esta chamada tenta reivindicar de novo, e é
          // isso que faz a retomada acontecer quando a trava do outro expira.
          token = undefined
          setEstado((s) => ({
            ...s,
            fase: 'aguardando',
            cards: ultima.cards ?? s.cards,
            erro: null,
          }))
          await espera(INTERVALO_ESPERA_MS)
          continue
        }

        break
      }

      // 'recente' depois de ter aguardado = a rodada do outro terminou e o dado é novo.
      const mudou = ultima.status === 'pronto' || (aguardou && ultima.status === 'recente')
      return { mudou, resposta: ultima }
    },
    [chamar]
  )

  const atualizar = useCallback(async () => {
    // Trava do duplo-clique. É só cosmética — a garantia de verdade é o UPDATE atômico
    // do `sync_claim`, que vale entre abas, entre pessoas e entre Workers.
    if (emAndamento.current) return
    emAndamento.current = true
    setEstado((s) => ({ ...s, fase: 'sincronizando', cards: 0, erro: null }))

    try {
      let mudouAlgo = false
      let ultima: Resposta | null = null

      for (const fonte of fontesRef.current) {
        const r = await sincronizarFonte(fonte)
        mudouAlgo = mudouAlgo || r.mudou
        ultima = r.resposta
      }

      if (desmontado.current) return

      if (ultima?.status === 'erro' || ultima?.status === 'erro_recente') {
        setEstado((s) => ({
          ...s,
          fase: 'erro',
          erro: ultima?.erro ?? 'falha na sincronização',
          liberaEm: ultima?.liberaEm ?? 0,
        }))
        return
      }

      setEstado((s) => ({
        ...s,
        fase: ultima?.status === 'recente' && !mudouAlgo ? 'recente' : 'ocioso',
        atualizadoEm: ultima?.atualizadoEm ?? (mudouAlgo ? new Date().toISOString() : s.atualizadoEm),
        liberaEm: ultima?.liberaEm ?? 0,
        erro: null,
      }))

      if (mudouAlgo) concluir.current?.()
    } finally {
      emAndamento.current = false
    }
  }, [sincronizarFonte])

  return { estado, atualizar, ocupado: estado.fase === 'sincronizando' || estado.fase === 'aguardando' }
}
