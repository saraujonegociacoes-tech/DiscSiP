'use server'

import { createServerClient } from '@/lib/supabase/server'
import type { DialerStatus } from '@/store/dialerStore'

// Heartbeat de presença do PRÓPRIO agente. O agente é sempre derivado da sessão
// (auth.getUser), nunca de um id vindo do cliente — a RLS de agent_presence só
// deixa gravar a linha onde agent_id = auth.uid(). Chamado pelo softphone a ~20s.
export async function reportPresence(
  dialerStatus: DialerStatus,
  campaignId?: string | null
): Promise<void> {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return

  await supabase.from('agent_presence').upsert({
    agent_id: user.id,
    dialer_status: dialerStatus,
    campaign_id: campaignId ?? null,
    last_seen_at: new Date().toISOString(),
  })
}
