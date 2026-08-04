'use client'

import dynamic from 'next/dynamic'
import { ChartSkeleton } from '@/components/bluedesk/ChartSkeleton'

// Peças do dashboard de leads que carregam RECHARTS, re-exportadas com carga sob demanda.
//
// Por quê: o Recharts é o maior chunk do app (~336 KB não-comprimidos). Importado
// estaticamente pelo barrel do feature, ele entrava no First Load JS do /leads INTEIRO — ou
// seja, o agente que abre `?aba=leads` (só a tabela da própria fila) baixava e parseava o
// Recharts sem ver um gráfico sequer, e o gestor pagava o custo das 7 abas para ver 1.
// As abas do Radix já desmontam o conteúdo inativo; o que faltava era o código também não vir.
//
// `ssr: false` não perde nada aqui: o ResponsiveContainer do Recharts mede o container no
// cliente, então o HTML que o servidor produzia para estes gráficos já era um wrapper vazio.
// O `loading` reserva a MESMA altura do gráfico real (h-80 dentro do card), então a troca
// esqueleto→gráfico não empurra o layout (sem CLS).
//
// Componentes SEM gráfico (KPIs, tabelas, alertas, ranking) continuam no barrel estático:
// são leves e alguns aparecem na primeira dobra.

export const EvolutionChart = dynamic(
  () => import('./components/EvolutionChart').then((m) => m.EvolutionChart),
  { ssr: false, loading: () => <ChartSkeleton title="Evolução no período" /> },
)

export const PhaseDistribution = dynamic(
  () => import('./components/PhaseDistribution').then((m) => m.PhaseDistribution),
  { ssr: false, loading: () => <ChartSkeleton title="Distribuição por fase" /> },
)

export const DeadReasonsDonut = dynamic(
  () => import('./components/DeadReasonsDonut').then((m) => m.DeadReasonsDonut),
  { ssr: false, loading: () => <ChartSkeleton title="Motivos de descarte" /> },
)

export const Funnel = dynamic(() => import('./components/Funnel').then((m) => m.Funnel), {
  ssr: false,
  loading: () => <ChartSkeleton title="Funil" />,
})

export const FunnelActivity = dynamic(
  () => import('./components/FunnelActivity').then((m) => m.FunnelActivity),
  { ssr: false, loading: () => <ChartSkeleton title="Funil de acionamento" /> },
)

export const PhaseDistributionActivity = dynamic(
  () => import('./components/PhaseDistributionActivity').then((m) => m.PhaseDistributionActivity),
  { ssr: false, loading: () => <ChartSkeleton title="Distribuição por fase" /> },
)

export const DeathByAttempt = dynamic(
  () => import('./components/DeathByAttempt').then((m) => m.DeathByAttempt),
  { ssr: false, loading: () => <ChartSkeleton title="Mortalidade por etapa" /> },
)

export const StepDwellTime = dynamic(
  () => import('./components/StepDwellTime').then((m) => m.StepDwellTime),
  { ssr: false, loading: () => <ChartSkeleton title="Tempo médio por etapa" /> },
)

export const StepConversion = dynamic(
  () => import('./components/StepConversion').then((m) => m.StepConversion),
  { ssr: false, loading: () => <ChartSkeleton title="Conversão entre etapas" /> },
)

export const PerformancePanel = dynamic(
  () => import('./components/PerformancePanel').then((m) => m.PerformancePanel),
  { ssr: false, loading: () => <ChartSkeleton title="Tendência entre ciclos" /> },
)
