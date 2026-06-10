import { notFound } from 'next/navigation'
import { getCampaignConfig, getAgents } from '@/app/actions/campaigns'
import { getLists } from '@/app/actions/lists'
import { ConfigureCampaignClient } from './ConfigureCampaignClient'

export default async function ConfigureCampaignPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const [config, agents, lists] = await Promise.all([
    getCampaignConfig(id),
    getAgents(),
    getLists(id),
  ])
  if (!config) notFound()

  return (
    <ConfigureCampaignClient
      campaign={config.campaign}
      initialAgentIds={config.agentIds}
      agents={agents}
      initialLists={lists}
    />
  )
}
