import { getCsDashboard } from '@/app/actions/cs'
import { CsClient } from './CsClient'
import { CsComingSoon } from './CsComingSoon'

// Painel de Sucesso do Cliente (CS) — domínio separado do dashboard de Leads (comercial).
// Gate de lançamento igual ao /leads: enquanto NEXT_PUBLIC_CS_ENABLED não estiver ligado,
// mostra "Em breve" (early return ANTES de qualquer busca no banco). Para trabalhar nele
// localmente, defina NEXT_PUBLIC_CS_ENABLED=1 no .env.local.
const CS_ENABLED =
  process.env.NEXT_PUBLIC_CS_ENABLED === '1' || process.env.NEXT_PUBLIC_CS_ENABLED === 'true'

export default async function CsPage() {
  if (!CS_ENABLED) return <CsComingSoon />

  const data = await getCsDashboard()
  return <CsClient data={data} />
}
