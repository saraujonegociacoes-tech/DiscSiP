'use client'

import { Sidebar } from '@/components/Sidebar'
import { MetricCard } from './MetricCard'
import { CallsChart } from './CallsChart'
import { AgentList } from './AgentList'
import type {
  DashboardStats,
  CampaignSummary,
  CallsByHour,
  AgentActivity,
} from '@/app/actions/supervisor'

const CAMPAIGN_STATUS_LABEL: Record<string, string> = {
  draft: 'Rascunho',
  active: 'Ativa',
  paused: 'Pausada',
  completed: 'Concluída',
}

const CAMPAIGN_STATUS_COLOR: Record<string, string> = {
  draft: 'text-slate-400 bg-slate-700',
  active: 'text-green-400 bg-green-900/40',
  paused: 'text-yellow-400 bg-yellow-900/40',
  completed: 'text-blue-400 bg-blue-900/40',
}

interface DashboardClientProps {
  stats: DashboardStats
  campaigns: CampaignSummary[]
  callsByHour: CallsByHour[]
  agents: AgentActivity[]
}

export function DashboardClient({ stats, campaigns, callsByHour, agents }: DashboardClientProps) {
  return (
    <div className="min-h-screen bg-[#0f172a] flex">
      <Sidebar />
      <div className="flex-1 p-6 overflow-y-auto space-y-6">
      <h1 className="text-white text-xl font-semibold">Dashboard</h1>

      {/* Métricas */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard label="Contatos na fila" value={stats.totalContacts} />
        <MetricCard
          label="Contactados"
          value={`${stats.contactedPercent}%`}
          sub="do total"
        />
        <MetricCard label="Chamadas hoje" value={stats.callsToday} />
        <MetricCard label="Agentes ativos" value={stats.activeAgents} sub="hoje" />
      </div>

      {/* Gráfico + Agentes */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <CallsChart data={callsByHour} />
        </div>
        <div>
          <AgentList agents={agents} />
        </div>
      </div>

      {/* Campanhas */}
      <div className="bg-[#1e293b] rounded-xl p-5">
        <h2 className="text-white text-sm font-medium mb-4">Campanhas</h2>
        {campaigns.length === 0 ? (
          <p className="text-slate-500 text-sm text-center py-4">Nenhuma campanha criada</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-400 text-xs uppercase tracking-wide border-b border-slate-700">
                  <th className="text-left pb-3 font-medium">Nome</th>
                  <th className="text-left pb-3 font-medium">Status</th>
                  <th className="text-right pb-3 font-medium">Total</th>
                  <th className="text-right pb-3 font-medium">Pendentes</th>
                  <th className="text-right pb-3 font-medium">Atendidos</th>
                  <th className="text-right pb-3 font-medium">Progresso</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/50">
                {campaigns.map((c) => (
                  <tr key={c.id} className="text-white">
                    <td className="py-3">{c.name}</td>
                    <td className="py-3">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full font-medium ${CAMPAIGN_STATUS_COLOR[c.status] ?? ''}`}
                      >
                        {CAMPAIGN_STATUS_LABEL[c.status] ?? c.status}
                      </span>
                    </td>
                    <td className="py-3 text-right text-slate-300">{c.total}</td>
                    <td className="py-3 text-right text-slate-300">{c.pending}</td>
                    <td className="py-3 text-right text-green-400">{c.answered}</td>
                    <td className="py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-20 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-[#38bdf8] rounded-full"
                            style={{ width: `${c.contactedPercent}%` }}
                          />
                        </div>
                        <span className="text-slate-400 text-xs w-8 text-right">
                          {c.contactedPercent}%
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      </div>
    </div>
  )
}
