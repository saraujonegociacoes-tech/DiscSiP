import {
  getWarmupNumbers,
  getWarmupSettings,
  getWarmupTemplates,
  getWarmupStats,
  getWarmupHistory,
} from '@/app/actions/warmup'
import { WarmupDashboardClient } from './WarmupDashboardClient'
import { WarmupComingSoon } from './WarmupComingSoon'

// Módulo de aquecimento de números WhatsApp — domínio separado (padrão de
// isolamento do CS/Leads). Gate de lançamento igual ao /cs: enquanto
// NEXT_PUBLIC_WARMUP_ENABLED não estiver ligado, mostra "Em breve" (early return
// ANTES de qualquer busca no banco). Acesso restrito a supervisor/manager/admin
// pelo RLS e pela navegação (Sidebar) — ver também o middleware.
const WARMUP_ENABLED =
  process.env.NEXT_PUBLIC_WARMUP_ENABLED === '1' ||
  process.env.NEXT_PUBLIC_WARMUP_ENABLED === 'true'

export default async function WarmupPage() {
  if (!WARMUP_ENABLED) return <WarmupComingSoon />

  const [numbers, settings, templates, stats, history] = await Promise.all([
    getWarmupNumbers(),
    getWarmupSettings(),
    getWarmupTemplates(),
    getWarmupStats(),
    getWarmupHistory(0),
  ])

  return (
    <WarmupDashboardClient
      initialNumbers={numbers}
      initialSettings={settings}
      initialTemplates={templates}
      stats={stats}
      initialHistory={history.rows}
      historyHasMore={history.hasMore}
    />
  )
}
