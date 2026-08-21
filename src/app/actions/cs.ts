'use server'

import { createServerClient } from '@/lib/supabase/server'
import { sanitizePeriod, type LeadPeriod } from '@/lib/period'
import type {
  CsMatrixData,
  CsMatrixCard,
  CsTeamData,
  CsTeamNegotiationAgent,
  CsTeamNegotiationTotals,
  CsTeamActivityAgent,
  CsActivityCard,
  CsTeamActivityTotals,
  CsMinutasData,
  CsMinutaCard,
  CsPagamentoProjecaoData,
  CsPagamentoCard,
  CsPagamentoHistoricoData,
  CsPagamentoRecebido,
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
// Duas seções: ATIVIDADE por pessoa (quem comentou, + recebidos e carteira) e NEGOCIAÇÕES.
// A atividade vale retroativo (o autor do comentário está gravado desde abr/2025); a
// negociação depende do snapshot que o Make acumula.

const EMPTY_NEG_TOTALS: CsTeamNegotiationTotals = {
  total: 0,
  completa: 0,
  parcial: 0,
  incompleta: 0,
}

const EMPTY_ACT_TOTALS: CsTeamActivityTotals = {
  updates: 0,
  cards: 0,
  people: 0,
  received: 0,
  portfolio: 0,
}

// O jsonb da RPC é tipado como PARCIAL de propósito. A migration 20260819 foi aplicada em
// duas versões (a 1ª sem `received`/`portfolio`), e a tela quebrou inteira num
// `undefined.toLocaleString` porque o tipo prometia `number` e o banco mandava nada. Aqui é
// a fronteira RPC → app: é este arquivo que tem que normalizar, pra `CsTeamActivityAgent`
// poder seguir dizendo `number` sem mentir. Nunca confiar no shape que o banco devolve —
// função e app versionam separado, e o banco sempre vai estar uma migration atrás em algum
// momento.
interface TeamRpcActivityRow {
  authorId?: string | null
  authorName?: string | null
  updates?: number | null
  cards?: number | null
  received?: number | null
  portfolio?: number | null
  cardsList?: CsActivityCard[] | null
}

interface TeamRpc {
  periodStart?: string
  periodEnd?: string
  activity?: TeamRpcActivityRow[]
  activityTotals?: Partial<CsTeamActivityTotals>
  negotiations?: CsTeamNegotiationAgent[]
  negotiationTotals?: CsTeamNegotiationTotals
}

const num = (v: number | null | undefined): number => (typeof v === 'number' ? v : 0)

function normalizeActivity(rows: TeamRpcActivityRow[] | undefined): CsTeamActivityAgent[] {
  return (rows ?? []).map((r) => ({
    authorId: r.authorId ?? null,
    authorName: r.authorName ?? 'Autor não identificado',
    updates: num(r.updates),
    cards: num(r.cards),
    received: num(r.received),
    portfolio: num(r.portfolio),
    cardsList: r.cardsList ?? [],
  }))
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
      activity: [],
      activityTotals: EMPTY_ACT_TOTALS,
      negotiations: [],
      negotiationTotals: EMPTY_NEG_TOTALS,
    }
  }
  const d = data as unknown as TeamRpc
  return {
    periodStart: d.periodStart ?? p.start,
    periodEnd: d.periodEnd ?? p.end,
    activity: normalizeActivity(d.activity),
    activityTotals: {
      updates: num(d.activityTotals?.updates),
      cards: num(d.activityTotals?.cards),
      people: num(d.activityTotals?.people),
      received: num(d.activityTotals?.received),
      portfolio: num(d.activityTotals?.portfolio),
    },
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

// PÁGINA 4 (Pagamento): duas leituras. PROJEÇÃO = SNAPSHOT (get_cs_pagamento_projecao, sem
// período, como P1/P3): o plano por parcela (metadata do SC) + os pagamentos realizados (conexão
// com o Financeiro), por card. HISTÓRICO = SÉRIE (get_cs_pagamento_historico(p_start,p_end),
// filtrável): os pagamentos com data no período. O RLS escopa igual. Ambas degradam pra vazio se
// a migration 20260730b ainda não foi aplicada ou não houver acesso.

interface PagamentoProjecaoRpc {
  referenceAt?: string
  cards?: CsPagamentoCard[]
}

export async function getCsPagamentoProjecao(): Promise<CsPagamentoProjecaoData> {
  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('get_cs_pagamento_projecao')
  if (error || !data) {
    // Degrada (não quebra) se a migration ainda não foi aplicada ou não houver acesso.
    return { referenceAt: new Date().toISOString(), cards: [] }
  }
  const d = data as unknown as PagamentoProjecaoRpc
  return {
    referenceAt: d.referenceAt ?? new Date().toISOString(),
    cards: d.cards ?? [],
  }
}

interface PagamentoHistoricoRpc {
  periodStart?: string
  periodEnd?: string
  totalRecebido?: number
  count?: number
  payments?: CsPagamentoRecebido[]
}

export async function getCsPagamentoHistorico(period: LeadPeriod): Promise<CsPagamentoHistoricoData> {
  const p = sanitizePeriod(period)
  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('get_cs_pagamento_historico', { p_start: p.start, p_end: p.end })
  if (error || !data) {
    // Degrada (não quebra) se a migration ainda não foi aplicada ou não houver acesso.
    return { periodStart: p.start, periodEnd: p.end, totalRecebido: 0, count: 0, payments: [] }
  }
  const d = data as unknown as PagamentoHistoricoRpc
  return {
    periodStart: d.periodStart ?? p.start,
    periodEnd: d.periodEnd ?? p.end,
    totalRecebido: d.totalRecebido ?? 0,
    count: d.count ?? 0,
    payments: d.payments ?? [],
  }
}
