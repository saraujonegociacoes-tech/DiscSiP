import { getDashboardStats, getCampaignsSummary, getCallsByHour, getAgentActivity } from '@/app/actions/supervisor'
import { DashboardClient } from './DashboardClient'

export default async function DashboardPage() {
  const [stats, campaigns, callsByHour, agents] = await Promise.all([
    getDashboardStats(),
    getCampaignsSummary(),
    getCallsByHour(),
    getAgentActivity(),
  ])

  return (
    <DashboardClient
      stats={stats}
      campaigns={campaigns}
      callsByHour={callsByHour}
      agents={agents}
    />
  )
}
