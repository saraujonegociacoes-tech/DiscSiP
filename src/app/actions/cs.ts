'use server'

import { createServerClient } from '@/lib/supabase/server'
import { sanitizePeriod, type LeadPeriod } from '@/lib/period'
import type {
  CsMatrixData,
  CsMatrixCard,
  CsTeamData,
  CsTeamMovementAgent,
  CsTeamMovementTotals,
  CsTeamNegotiationAgent,
  CsTeamNegotiationTotals,
  CsMinutasData,
  CsMinutaCard,
} from '@/lib/types/database'

// Painel de Sucesso do Cliente (CS, Pipefy) — domínio SEPARADO do leads/comercial.
//
// PÁGINA 1 (Matriz Fase × Idade): lê a RPC get_cs_matrix(p_end) via createServerClient()
// (propaga auth.uid() → RLS). O RLS de cs_cards já escopa por papel+departamento (agente =
// o próprio card, supervisor = o departamento de CS, manager/admin = tudo, quem não é do CS
// não vê nada) — não duplicamos isso aqui.
//
// A idade é calculada AS-OF o fim do período (decisão do dono: "foto na data"); por isso a
// action passa só `period.end`. A matriz (fase × janela), total, tempo médio e o drill-down
// por célula moram no cliente (src/features/cs/components/CsMatrix.tsx) sobre `cards`.

interface MatrixRpc {
  referenceAt?: string
  cards?: CsMatrixCard[]
}

export async function getCsMatrix(period: LeadPeriod): Promise<CsMatrixData> {
  const p = sanitizePeriod(period)
  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('get_cs_matrix', { p_end: p.end })
  if (error || !data) {
    // Degrada (não quebra) se a migration ainda não foi aplicada ou não houver acesso.
    return { referenceAt: p.end, cards: [] }
  }
  const d = data as unknown as MatrixRpc
  return {
    referenceAt: d.referenceAt ?? p.end,
    cards: d.cards ?? [],
  }
}

// PÁGINA 2 (Equipe): lê get_cs_team(p_start, p_end). Diferente da P1, esta página é uma
// JANELA DE TEMPO (ciclo 11→10, filtrável) — passamos start+end. O RLS escopa igual.
// A parte de série temporal (movimento/comentário/negociação por ciclo) nasce ~vazia e
// enche conforme o Make acumula; a completude já vem do snapshot atual.

const EMPTY_MOVE_TOTALS: CsTeamMovementTotals = {
  received: 0,
  movedWithUpdate: 0,
  movedNoUpdate: 0,
  onlyUpdate: 0,
  idle: 0,
}

const EMPTY_NEG_TOTALS: CsTeamNegotiationTotals = {
  total: 0,
  completa: 0,
  parcial: 0,
  incompleta: 0,
}

interface TeamRpc {
  periodStart?: string
  periodEnd?: string
  movement?: CsTeamMovementAgent[]
  movementTotals?: CsTeamMovementTotals
  negotiations?: CsTeamNegotiationAgent[]
  negotiationTotals?: CsTeamNegotiationTotals
}

export async function getCsTeam(period: LeadPeriod): Promise<CsTeamData> {
  const p = sanitizePeriod(period)
  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('get_cs_team', { p_start: p.start, p_end: p.end })
  if (error || !data) {
    // Degrada (não quebra) se a migration ainda não foi aplicada ou não houver acesso.
    return {
      periodStart: p.start,
      periodEnd: p.end,
      movement: [],
      movementTotals: EMPTY_MOVE_TOTALS,
      negotiations: [],
      negotiationTotals: EMPTY_NEG_TOTALS,
    }
  }
  const d = data as unknown as TeamRpc
  return {
    periodStart: d.periodStart ?? p.start,
    periodEnd: d.periodEnd ?? p.end,
    movement: d.movement ?? [],
    movementTotals: d.movementTotals ?? EMPTY_MOVE_TOTALS,
    negotiations: d.negotiations ?? [],
    negotiationTotals: d.negotiationTotals ?? EMPTY_NEG_TOTALS,
  }
}

// PÁGINA 3 (Minutas): lê get_cs_minutas() — SNAPSHOT de estado atual, sem período (como a P1).
// Devolve os cards que têm minuta (data de quitação = vencimento), com valor/dívida/desconto/
// etiqueta/vencimento; buckets, somas e drill moram no cliente. O RLS escopa igual às outras.

interface MinutasRpc {
  referenceAt?: string
  withoutMinuta?: number
  resguardo?: {
    active?: { total?: number; count?: number }
    inactive?: { total?: number; count?: number }
  }
  cards?: CsMinutaCard[]
}

const EMPTY_RESGUARDO = {
  active: { total: 0, count: 0 },
  inactive: { total: 0, count: 0 },
}

export async function getCsMinutas(): Promise<CsMinutasData> {
  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('get_cs_minutas')
  if (error || !data) {
    // Degrada (não quebra) se a migration ainda não foi aplicada ou não houver acesso.
    return { referenceAt: new Date().toISOString(), withoutMinuta: 0, resguardo: EMPTY_RESGUARDO, cards: [] }
  }
  const d = data as unknown as MinutasRpc
  return {
    referenceAt: d.referenceAt ?? new Date().toISOString(),
    withoutMinuta: d.withoutMinuta ?? 0,
    resguardo: {
      active: {
        total: d.resguardo?.active?.total ?? 0,
        count: d.resguardo?.active?.count ?? 0,
      },
      inactive: {
        total: d.resguardo?.inactive?.total ?? 0,
        count: d.resguardo?.inactive?.count ?? 0,
      },
    },
    cards: d.cards ?? [],
  }
}
