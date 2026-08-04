'use client'

import dynamic from 'next/dynamic'

// A página de sprints é um Server Component, e `next/dynamic` com `ssr: false` só vale dentro
// de um Client Component — daí este invólucro de uma linha. Sem ele, o Recharts do burndown
// entrava no First Load JS da rota inteira, mesmo quando nenhum sprint está ativo (o gráfico
// só é renderizado para `status === 'active'`, o caso raro).
//
// O placeholder usa a MESMA altura h-56 do estado vazio do gráfico, então nada salta na tela.
export const BurndownChart = dynamic(
  () => import('./burndown-chart').then((m) => m.BurndownChart),
  {
    ssr: false,
    loading: () => (
      <div className="grid h-56 place-items-center text-sm text-muted-foreground" aria-busy="true">
        Carregando burndown…
      </div>
    ),
  },
)
