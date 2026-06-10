import { getCampaigns } from '@/app/actions/campaigns'
import { CampaignsListClient } from './CampaignsListClient'

export default async function CampaignsPage() {
  const campaigns = await getCampaigns()
  return <CampaignsListClient initialCampaigns={campaigns} />
}
