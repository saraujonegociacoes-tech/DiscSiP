'use server'

import { createServerClient } from '@/lib/supabase/server'
import type { CsDashboardData, CsKpis, CsPhaseCount, CsAgentCount } from '@/lib/types/database'

// Painel de Sucesso do Cliente (CS, Pipefy) — domínio SEPARADO do leads/comercial. Lê a
// RPC agregada get_cs_dashboard() via createServerClient() (propaga auth.uid() → RLS): o
// RLS de cs_cards já escopa por papel+departamento (agente=o próprio card, supervisor=o
// departamento de CS, manager/admin=tudo, quem não é do CS não vê nada) — não duplicamos
// essa lógica aqui.
//
// Sem parâmetro de período (ver migration 20260716_cs_dashboard.sql): "quantos cards por
// fase" e "responsável" são estado ATUAL, não uma janela de tempo.

interface DashboardRpc {
  kpis?: {
    total: number
    without_responsible: number
    distinct_responsible: number
    avg_days_in_current_phase: number | null
  }
  phaseDistribution?: CsPhaseCount[]
  byResponsible?: Record<string, CsAgentCount[]>
}

const EMPTY_KPIS: CsKpis = {
  total: 0,
  withoutResponsible: 0,
  distinctResponsible: 0,
  avgDaysInCurrentPhase: null,
}

export async function getCsDashboard(): Promise<CsDashboardData> {
  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('get_cs_dashboard')
  if (error || !data) {
    return { kpis: EMPTY_KPIS, phaseDistribution: [], byResponsible: {} }
  }
  const d = data as unknown as DashboardRpc
  const k = d.kpis
  return {
    kpis: k
      ? {
          total: k.total,
          withoutResponsible: k.without_responsible,
          distinctResponsible: k.distinct_responsible,
          avgDaysInCurrentPhase: k.avg_days_in_current_phase,
        }
      : EMPTY_KPIS,
    phaseDistribution: d.phaseDistribution ?? [],
    byResponsible: d.byResponsible ?? {},
  }
}
