'use client'

import Link from 'next/link'
import { PhoneCall, PhoneOutgoing, Target, Users, ListChecks, Sparkles } from 'lucide-react'
import { AppShell } from '@/components/blueline/AppShell'
import { PageHeader } from '@/components/blueline/PageHeader'
import { StatusBadge, type CallStatus } from '@/components/blueline/StatusBadge'
import { Button } from '@/components/ui/button'
import { MetricCard } from './MetricCard'
import { CallsChart } from './CallsChart'
import { AgentList } from './AgentList'
import type {
  DashboardStats,
  CampaignSummary,
  CallsByHour,
  AgentActivity,
} from '@/app/actions/supervisor'

const CAMPAIGN_STATUS_BADGE: Record<string, { status: CallStatus; label: string }> = {
  draft: { status: 'offline', label: 'Rascunho' },
  active: { status: 'available', label: 'Ativa' },
  paused: { status: 'paused', label: 'Pausada' },
  completed: { status: 'in-call', label: 'Concluída' },
}

interface DashboardClientProps {
  stats: DashboardStats
  campaigns: CampaignSummary[]
  callsByHour: CallsByHour[]
  agents: AgentActivity[]
}

export function DashboardClient({ stats, campaigns, callsByHour, agents }: DashboardClientProps) {
  return (
    <AppShell>
      {/* Hero premium */}
      <section className="sheen relative mb-6 overflow-hidden rounded-3xl border border-border bg-gradient-premium p-6 shadow-elegant md:p-8">
        <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-success/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 left-1/3 h-72 w-72 rounded-full bg-primary/40 blur-3xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-white/80">
              <Sparkles className="h-3 w-3" /> Operação ao vivo
            </div>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white md:text-4xl">
              Conectando conversas que geram resultados.
            </h1>
            <p className="mt-2 text-sm text-white/70">
              {stats.callsToday} chamadas hoje · {stats.activeAgents} agentes ativos · {stats.totalContacts} contatos na fila.
            </p>
          </div>
          <Button asChild className="bg-gradient-glow text-primary-foreground shadow-glow hover:opacity-90">
            <Link href="/softphone">
              <PhoneCall className="mr-2 h-4 w-4" /> Iniciar discagem
            </Link>
          </Button>
        </div>
      </section>

      <PageHeader
        title="Painel da operação"
        description="Acompanhamento em tempo real das campanhas e indicadores do time."
      />

      {/* Métricas */}
      <section className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <MetricCard label="Contatos na fila" value={stats.totalContacts} icon={ListChecks} />
        <MetricCard label="Contactados" value={`${stats.contactedPercent}%`} sub="do total" icon={Target} />
        <MetricCard label="Chamadas hoje" value={stats.callsToday} icon={PhoneOutgoing} />
        <MetricCard label="Agentes ativos" value={stats.activeAgents} sub="hoje" icon={Users} />
      </section>

      {/* Gráfico + Agentes */}
      <section className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <CallsChart data={callsByHour} />
        </div>
        <div>
          <AgentList agents={agents} />
        </div>
      </section>

      {/* Campanhas */}
      <section className="mt-6 overflow-hidden rounded-2xl border border-border bg-gradient-card shadow-elevated">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Campanhas</h2>
            <p className="text-xs text-muted-foreground">{campaigns.length} no total</p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/campaigns">Ver todas</Link>
          </Button>
        </div>
        {campaigns.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Nenhuma campanha criada</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-background/40 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 text-left font-medium">Nome</th>
                  <th className="px-5 py-3 text-left font-medium">Status</th>
                  <th className="px-5 py-3 text-right font-medium">Total</th>
                  <th className="px-5 py-3 text-right font-medium">Pendentes</th>
                  <th className="px-5 py-3 text-right font-medium">Atendidos</th>
                  <th className="px-5 py-3 text-right font-medium">Progresso</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {campaigns.map((c) => {
                  const badge = CAMPAIGN_STATUS_BADGE[c.status] ?? { status: 'offline' as CallStatus, label: c.status }
                  return (
                    <tr key={c.id} className="transition-colors hover:bg-accent/40">
                      <td className="px-5 py-3 font-medium text-foreground">{c.name}</td>
                      <td className="px-5 py-3">
                        <StatusBadge status={badge.status} label={badge.label} />
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">{c.total}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">{c.pending}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-success">{c.answered}</td>
                      <td className="px-5 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full rounded-full bg-gradient-primary"
                              style={{ width: `${c.contactedPercent}%` }}
                            />
                          </div>
                          <span className="w-8 text-right text-xs text-muted-foreground">
                            {c.contactedPercent}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AppShell>
  )
}
