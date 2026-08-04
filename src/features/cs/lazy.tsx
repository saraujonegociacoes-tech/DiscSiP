'use client'

import dynamic from 'next/dynamic'
import { ChartSkeleton } from '@/components/bluedesk/ChartSkeleton'

// Abas 2, 3 e 4 do painel de CS, carregadas sob demanda.
//
// Diferente de leads/ceo/minutas, aqui o peso não é o Recharts (o CS não plota gráfico) e sim
// o volume de código próprio: as três somam ~2.000 linhas de derivação/reconciliação no
// cliente e respondem por quase todo o bundle da rota, embora o Radix Tabs monte uma por vez.
// Elas também buscam o próprio dado no `useEffect` de montagem — ou seja, nada acontece antes
// de a aba ser aberta, e adiar o código não adia trabalho nenhum que já não fosse adiado.
//
// A aba 1 (CsMatrix) segue estática: é a que abre por padrão.
export const CsTeam = dynamic(() => import('./components/CsTeam').then((m) => m.CsTeam), {
  ssr: false,
  loading: () => <ChartSkeleton title="Equipe" />,
})

export const CsMinutas = dynamic(() => import('./components/CsMinutas').then((m) => m.CsMinutas), {
  ssr: false,
  loading: () => <ChartSkeleton title="Minutas" />,
})

export const CsPagamento = dynamic(
  () => import('./components/CsPagamento').then((m) => m.CsPagamento),
  { ssr: false, loading: () => <ChartSkeleton title="Pagamento + Insights" /> },
)
