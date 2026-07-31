'use client'

import { useCallback, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  LayoutDashboard,
  Users,
  Filter,
  TriangleAlert,
  TrendingUp,
  XCircle,
  Search,
} from 'lucide-react'
import { AppShell } from '@/components/bluedesk/AppShell'
import { PageHeader } from '@/components/bluedesk/PageHeader'
import { PeriodPicker } from '@/components/bluedesk/PeriodPicker'
import { Tabs, TabsContent } from '@/components/ui/tabs'
import {
  LeadKpiRow,
  Funnel,
  PhaseDistribution,
  FunnelActivity,
  PhaseDistributionActivity,
  DeadReasonsDonut,
  DeathByAttempt,
  LeadsTable,
  AgentRanking,
  DuplicateAlert,
  ForgottenLeads,
  ChannelBreakdown,
  OrphanLeads,
  EvolutionChart,
  AlertsPanel,
  PerformancePanel,
  StepDwellTime,
  StepConversion,
  LeadsTabNav,
  TabPlaceholder,
  type LeadTab,
  type AlertItem,
} from '@/features/leads'
import { useLeadsRealtime, LEADS_REALTIME_ENABLED } from '@/features/leads/useLeadsRealtime'
import {
  getLeadsData,
  getAgentLeads,
  getSupervisorMetrics,
  getLeadsTimeseries,
  getLeadsFunnelDepth,
  getLeadsActivity,
  type LeadsData,
  type AgentLeadRow,
  type SupervisorMetrics,
  type DuplicateAlert as DuplicateAlertRow,
  type DailyPoint,
  type TrendPoint,
  type StepDwellTime as StepDwellTimeRow,
  type LeadActivity,
} from '@/app/actions/leads'
import type { LeadPeriod } from '@/lib/period'

interface LeadsClientProps {
  initialPeriod: LeadPeriod
  initialData: LeadsData
  initialAgentLeads: AgentLeadRow[]
  duplicates: DuplicateAlertRow[]
  initialSupervisor: SupervisorMetrics | null
  initialTimeseries: DailyPoint[]
  initialTrend: TrendPoint[]
  initialFunnelDepth: StepDwellTimeRow[]
  initialActivity: LeadActivity
  isManager: boolean
}

// Catálogo das abas do novo visual (Sprint 1). Cada aba responde uma pergunta — ver
// docs/painelleads-docs/updates/novo-visual-dashleads.md. `managerOnly` esconde a aba do agente (ele não vê
// Equipe/Operação/Performance). A ordem aqui é a ordem na topbar; a primeira visível é o
// default (`visao-geral`, sempre visível).
type TabSlug =
  | 'visao-geral'
  | 'equipe'
  | 'funil'
  | 'operacao'
  | 'performance'
  | 'lead-morto'
  | 'leads'

const TABS: Array<LeadTab & { slug: TabSlug; managerOnly: boolean }> = [
  { slug: 'visao-geral', label: 'Visão Geral', icon: LayoutDashboard, managerOnly: false },
  { slug: 'equipe', label: 'Equipe', icon: Users, managerOnly: true },
  { slug: 'funil', label: 'Funil', icon: Filter, managerOnly: false },
  { slug: 'operacao', label: 'Operação', icon: TriangleAlert, managerOnly: true },
  { slug: 'performance', label: 'Performance', icon: TrendingUp, managerOnly: true },
  { slug: 'lead-morto', label: 'Lead Morto', icon: XCircle, managerOnly: false },
  { slug: 'leads', label: 'Leads', icon: Search, managerOnly: false },
]

export function LeadsClient({
  initialPeriod,
  initialData,
  initialAgentLeads,
  duplicates,
  initialSupervisor,
  initialTimeseries,
  initialTrend,
  initialFunnelDepth,
  initialActivity,
  isManager,
}: LeadsClientProps) {
  const [period, setPeriod] = useState(initialPeriod)
  const [data, setData] = useState(initialData)
  const [agentLeads, setAgentLeads] = useState(initialAgentLeads)
  const [supervisor, setSupervisor] = useState(initialSupervisor)
  const [timeseries, setTimeseries] = useState(initialTimeseries)
  const [funnelDepth, setFunnelDepth] = useState(initialFunnelDepth)
  const [activity, setActivity] = useState(initialActivity)
  // Tendência entre ciclos (Performance) não depende do período selecionado → não re-busca.
  const [trend] = useState(initialTrend)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // Abas visíveis para o papel atual e aba ativa (sincronizada com ?aba=). Deep-link inválido
  // (ou aba escondida por RBAC) cai no default — a primeira visível, sempre `visao-geral`.
  const visibleTabs = useMemo(() => TABS.filter((t) => !t.managerOnly || isManager), [isManager])
  const requestedTab = searchParams.get('aba')
  const activeTab = visibleTabs.some((t) => t.slug === requestedTab)
    ? (requestedTab as TabSlug)
    : visibleTabs[0].slug

  // Troca de aba: 100% client-side, sem refetch. Só reescreve ?aba= na URL (replace, sem
  // rolar), mantendo qualquer outro parâmetro que exista.
  const handleTabChange = useCallback(
    (slug: string) => {
      const params = new URLSearchParams(searchParams.toString())
      params.set('aba', slug)
      router.replace(`${pathname}?${params.toString()}`, { scroll: false })
    },
    [router, pathname, searchParams],
  )

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

  // Alertas da Visão Geral: números já calculados (sem acionamento, parados, órfãos e duplicados
  // para o gestor; parados para o agente). As listas completas ficam na aba Operação.
  const alertItems: AlertItem[] = useMemo(() => {
    if (isManager && supervisor) {
      return [
        { label: 'Sem acionamento', value: supervisor.forgottenTotal, tone: 'danger' },
        { label: 'Parados agora', value: supervisor.teamStuck.total, tone: 'danger' },
        { label: 'Sem responsável', value: supervisor.orphans.total, tone: 'warning' },
        { label: 'Responsabilidade duplicada', value: duplicates.length, tone: 'warning' },
      ]
    }
    return [{ label: 'Parados agora', value: agentStuck.total, tone: 'danger' }]
  }, [isManager, supervisor, duplicates.length, agentStuck.total])

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
        const [d, sup, ts, fd, act] = await Promise.all([
          getLeadsData(next),
          getSupervisorMetrics(next),
          getLeadsTimeseries(next),
          getLeadsFunnelDepth(next),
          getLeadsActivity(next),
        ])
        setData(d)
        setSupervisor(sup)
        setTimeseries(ts)
        setFunnelDepth(fd)
        setActivity(act)
      } else {
        const [d, al, ts, fd, act] = await Promise.all([
          getLeadsData(next),
          getAgentLeads(next),
          getLeadsTimeseries(next),
          getLeadsFunnelDepth(next),
          getLeadsActivity(next),
        ])
        setData(d)
        setAgentLeads(al)
        setTimeseries(ts)
        setFunnelDepth(fd)
        setActivity(act)
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
        const [d, sup, ts, fd, act] = await Promise.all([
          getLeadsData(period),
          getSupervisorMetrics(period),
          getLeadsTimeseries(period),
          getLeadsFunnelDepth(period),
          getLeadsActivity(period),
        ])
        setData(d)
        setSupervisor(sup)
        setTimeseries(ts)
        setFunnelDepth(fd)
        setActivity(act)
      } else {
        const [d, al, ts, fd, act] = await Promise.all([
          getLeadsData(period),
          getAgentLeads(period),
          getLeadsTimeseries(period),
          getLeadsFunnelDepth(period),
          getLeadsActivity(period),
        ])
        setData(d)
        setAgentLeads(al)
        setTimeseries(ts)
        setFunnelDepth(fd)
        setActivity(act)
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

      <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
        <LeadsTabNav tabs={visibleTabs} />

        <div
          className={loading ? 'pointer-events-none opacity-60 transition-opacity' : 'transition-opacity'}
          aria-busy={loading}
        >
          {/* 🏠 Visão Geral — "Como está a operação agora?" */}
          <TabsContent value="visao-geral" className="mt-6">
            <LeadKpiRow kpis={data.kpis} stuck={kpiStuck} />
            <section className="mt-6 grid grid-cols-1 items-start gap-4 xl:grid-cols-3">
              <div className="xl:col-span-2">
                <EvolutionChart data={timeseries} />
              </div>
              <AlertsPanel
                items={alertItems}
                onOpenOperacao={isManager ? () => handleTabChange('operacao') : undefined}
              />
            </section>
            <section className="mt-6 grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
              <PhaseDistribution data={data.phaseDistribution} period={period} />
              <DeadReasonsDonut reasons={data.deadReasons} />
            </section>
          </TabsContent>

          {/* 👥 Equipe — "Quem está performando melhor ou pior?" (supervisor+) */}
          {isManager && supervisor && (
            <TabsContent value="equipe" className="mt-6">
              <AgentRanking rows={data.ranking} stuckByAgent={supervisor.stuckByAgent} />
              <section className="mt-6">
                <ChannelBreakdown data={data.channelBreakdown} fillRate={data.channelFillRate} />
              </section>
            </TabsContent>
          )}

          {/* 🎯 Funil — "Onde estou perdendo leads no processo?" (entradas de fase + volume atual) */}
          <TabsContent value="funil" className="mt-6">
            <section className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
              <Funnel stages={data.funnel} period={period} />
              <PhaseDistribution data={data.phaseDistribution} period={period} />
            </section>
            <h3 className="mb-1 mt-8 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Acionado no período (quando o card entra numa fase)
            </h3>
            <section className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
              <FunnelActivity stages={activity.funnel} period={period} />
              <PhaseDistributionActivity data={activity.phaseDistribution} period={period} />
            </section>
            <section className="mt-6 grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
              <StepDwellTime data={funnelDepth} />
              <StepConversion stages={data.funnel} byResponsible={data.funnelByResponsible} />
            </section>
          </TabsContent>

          {/* ⚠ Operação — "O que precisa de ação agora?" (supervisor+) */}
          {isManager && supervisor && (
            <TabsContent value="operacao" className="mt-6">
              <ForgottenLeads
                leads={supervisor.forgotten}
                total={supervisor.forgottenTotal}
                thresholdHours={supervisor.forgottenThresholdHours}
              />
              <section className="mt-6 grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
                <OrphanLeads orphans={supervisor.orphans} />
                <DuplicateAlert rows={duplicates} />
              </section>
            </TabsContent>
          )}

          {/* 📊 Performance — "Estamos melhorando ao longo do tempo?" (supervisor+) */}
          {isManager && (
            <TabsContent value="performance" className="mt-6">
              <PerformancePanel data={trend} />
            </TabsContent>
          )}

          {/* ❌ Lead Morto — "Por que estamos perdendo leads?" */}
          <TabsContent value="lead-morto" className="mt-6">
            <section className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
              <DeadReasonsDonut reasons={data.deadReasons} />
              <DeathByAttempt data={data.deathByAttempt} />
            </section>
          </TabsContent>

          {/* 🔍 Leads — exploração livre */}
          <TabsContent value="leads" className="mt-6">
            {isManager ? (
              <TabPlaceholder
                icon={Search}
                title="Explorador de leads chega na Sprint 5"
                description="A busca livre com filtros e a tabela completa para o gestor entram na sprint final. Por enquanto, o agente vê a própria fila aqui."
              />
            ) : (
              <LeadsTable rows={agentLeads} />
            )}
          </TabsContent>
        </div>
      </Tabs>
    </AppShell>
  )
}
