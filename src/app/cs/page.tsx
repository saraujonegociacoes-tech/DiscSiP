import { Suspense } from 'react'
import { getCsMatrix } from '@/app/actions/cs'
import { currentCycle } from '@/lib/period'
import { CsClient } from './CsClient'
import { CsComingSoon } from './CsComingSoon'

// Painel de Sucesso do Cliente (CS) — domínio separado do dashboard de Leads (comercial).
// Gate de lançamento igual ao /leads: enquanto NEXT_PUBLIC_CS_ENABLED não estiver ligado,
// mostra "Em breve" (early return ANTES de qualquer busca no banco). Para trabalhar nele
// localmente, defina NEXT_PUBLIC_CS_ENABLED=1 no .env.local.
//
// O escopo por papel/departamento é 100% do RLS (agente = os próprios cards, supervisor = o
// departamento de CS, manager/admin = tudo, quem não é do CS não vê nada) — não gateamos por
// papel aqui. A Página 1 é uma foto de ESTADO ATUAL (sem filtro de período): passamos o ciclo
// corrente só como referência as-of, e a RPC usa LEAST(fim, now()) = agora.
const CS_ENABLED =
  process.env.NEXT_PUBLIC_CS_ENABLED === '1' || process.env.NEXT_PUBLIC_CS_ENABLED === 'true'

export default async function CsPage() {
  if (!CS_ENABLED) return <CsComingSoon />

  const data = await getCsMatrix(currentCycle())

  return (
    // Suspense: o CsClient usa useSearchParams (aba ativa em ?aba=), que exige um limite de
    // Suspense no App Router. Os dados já vêm por props, então não há gap real.
    <Suspense fallback={null}>
      <CsClient initialData={data} />
    </Suspense>
  )
}
