'use client'

import { useCallback, useMemo, useState } from 'react'
import { AppShell } from '@/components/blueline/AppShell'
import { PageHeader } from '@/components/blueline/PageHeader'
import {
  PeriodPicker,
  LeadKpiRow,
  Funnel,
  DeadReasonsDonut,
  DeathByAttempt,
  LeadsTable,
  AgentRanking,
  DuplicateAlert,
  ForgottenLeads,
  ChannelBreakdown,
  OrphanLeads,
} from '@/features/leads'
import { useLeadsRealtime, LEADS_REALTIME_ENABLED } from '@/features/leads/useLeadsRealtime'
import {
  getLeadsData,
  getAgentLeads,
  getSupervisorMetrics,
  type LeadsData,
  type AgentLeadRow,
  type SupervisorMetrics,
  type DuplicateAlert as DuplicateAlertRow,
} from '@/app/actions/leads'
import type { LeadPeriod } from '@/lib/leads/period'

interface LeadsClientProps {
  initialPeriod: LeadPeriod
  initialData: LeadsData
  initialAgentLeads: AgentLeadRow[]
  duplicates: DuplicateAlertRow[]
  initialSupervisor: SupervisorMetrics | null
  isManager: boolean
}

export function LeadsClient({
  initialPeriod,
  initialData,
  initialAgentLeads,
  duplicates,
  initialSupervisor,
  isManager,
}: LeadsClientProps) {
  const [period, setPeriod] = useState(initialPeriod)
  const [data, setData] = useState(initialData)
  const [agentLeads, setAgentLeads] = useState(initialAgentLeads)
  const [supervisor, setSupervisor] = useState(initialSupervisor)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // "Parados agora" da visão do AGENTE: total de leads com SLA de fase estourado, com o
  // split ciclo × retroativo. É estado ATUAL — independe do período; muda só a etiqueta de
  // origem quando o período muda, não o conjunto de abertos.
  const agentStuck = useMemo(() => {
    const s = agentLeads.filter((l) => l.isStuck)
    return {
      total: s.length,
      cycle: s.filter((l) => l.origin === 'ciclo').length,
      retro: s.filter((l) => l.origin === 'retroativo').length,
    }
  }, [agentLeads])

  // Card "Parados" no topo: agente usa a sua fila; supervisor usa o total da equipe (vindo
  // de getSupervisorMetrics — estado atual, com split ciclo × retroativo reancorado ao período).
  const kpiStuck = isManager ? supervisor?.teamStuck : agentStuck

  // Troca de período: re-busca o que depende do período. Para o agente, também a tabela
  // (abertos permanecem; finalizados-no-período e etiquetas de origem mudam). Para o
  // supervisor, também as métricas de estado atual (o split ciclo × retroativo dos parados é
  // reancorado ao período). Duplicados (agente) e "sem acionamento" (supervisor) são
  // now-scoped puros — mas vêm no mesmo payload, então re-buscamos junto sem custo extra.
  async function changePeriod(next: LeadPeriod) {
    setPeriod(next)
    setError(null)
    setLoading(true)
    try {
      if (isManager) {
        const [d, sup] = await Promise.all([getLeadsData(next), getSupervisorMetrics(next)])
        setData(d)
        setSupervisor(sup)
      } else {
        const [d, al] = await Promise.all([getLeadsData(next), getAgentLeads(next)])
        setData(d)
        setAgentLeads(al)
      }
    } catch {
      setError('Não foi possível carregar os dados deste período. Tente novamente.')
    } finally {
      setLoading(false)
    }
  }

  // Refetch SILENCIOSO do período corrente (sem spinner nem troca de período) — usado pelo
  // Realtime (S4). Em erro, mantém os dados atuais na tela em vez de piscar um erro.
  const refresh = useCallback(async () => {
    try {
      if (isManager) {
        const [d, sup] = await Promise.all([getLeadsData(period), getSupervisorMetrics(period)])
        setData(d)
        setSupervisor(sup)
      } else {
        const [d, al] = await Promise.all([getLeadsData(period), getAgentLeads(period)])
        setData(d)
        setAgentLeads(al)
      }
    } catch {
      /* silêncio: a tela segue com o último dado bom */
    }
  }, [isManager, period])

  // Inerte até o dono habilitar Realtime (env + publicação) — ver useLeadsRealtime.
  useLeadsRealtime(refresh)

  return (
    <AppShell>
      <PageHeader
        title="Dashboard de leads"
        description={`Funil de leads do Pipefy · ${period.label}`}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            {LEADS_REALTIME_ENABLED && (
              <span
                className="inline-flex items-center gap-1.5 text-xs font-medium text-success"
                title="Atualização em tempo real ativa"
              >
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success/60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
                </span>
                Ao vivo
              </span>
            )}
            <PeriodPicker value={period} onChange={changePeriod} disabled={loading} />
          </div>
        }
      />

      {error && (
        <div className="mb-4 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div
        className={loading ? 'pointer-events-none opacity-60 transition-opacity' : 'transition-opacity'}
        aria-busy={loading}
      >
        <LeadKpiRow kpis={data.kpis} stuck={kpiStuck} />

        <section className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Funnel stages={data.funnel} />
          <DeadReasonsDonut reasons={data.deadReasons} />
        </section>

        {!isManager && (
          <section className="mt-6">
            <LeadsTable rows={agentLeads} />
          </section>
        )}

        {isManager && supervisor && (
          <>
            <section className="mt-6 grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
              <DeathByAttempt data={data.deathByAttempt} />
              <ForgottenLeads
                leads={supervisor.forgotten}
                total={supervisor.forgottenTotal}
                thresholdHours={supervisor.forgottenThresholdHours}
              />
            </section>
            <section className="mt-6">
              <AgentRanking rows={data.ranking} stuckByAgent={supervisor.stuckByAgent} />
            </section>
            <section className="mt-6">
              <ChannelBreakdown data={data.channelBreakdown} fillRate={data.channelFillRate} />
            </section>
            <section className="mt-6 grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
              <OrphanLeads orphans={supervisor.orphans} />
              <DuplicateAlert rows={duplicates} />
            </section>
          </>
        )}
      </div>
    </AppShell>
  )
}
