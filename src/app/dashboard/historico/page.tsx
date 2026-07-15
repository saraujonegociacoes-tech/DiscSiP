import { getAgents, getCampaigns } from '@/app/actions/campaigns'
import { getCallHistoryFiltered } from '@/app/actions/supervisor'
import { currentCycle } from '@/lib/period'
import { HistoricoClient } from './HistoricoClient'

export default async function HistoricoPage() {
  const cycle = currentCycle()
  const [agents, campaigns, history] = await Promise.all([
    getAgents(),
    getCampaigns(true), // inclui arquivadas: consulta histórica não deve esconder campanha antiga
    getCallHistoryFiltered({ period: cycle }),
  ])

  return (
    <HistoricoClient
      initialPeriod={cycle}
      agents={agents}
      campaigns={campaigns.map((c) => ({ id: c.id, name: c.name }))}
      initialRows={history.rows}
      initialHasMore={history.hasMore}
    />
  )
}
