'use client'

import dynamic from 'next/dynamic'
import { ChartSkeleton } from '@/components/bluedesk/ChartSkeleton'

// Abas do Painel do CEO que carregam Recharts, sob demanda (mesma decisão de
// features/leads/lazy.tsx). As três abas construídas — Financeiro, Projeções e Saúde da
// Empresa — plotam séries, e o Radix Tabs só monta uma por vez: sem isto, abrir
// `?aba=projecoes` baixava também todo o código do Financeiro, e vice-versa.
export const CeoFinanceiro = dynamic(
  () => import('./components/CeoFinanceiro').then((m) => m.CeoFinanceiro),
  { ssr: false, loading: () => <ChartSkeleton title="Financeiro" /> },
)

export const CeoProjecoes = dynamic(
  () => import('./components/CeoProjecoes').then((m) => m.CeoProjecoes),
  { ssr: false, loading: () => <ChartSkeleton title="Projeções de pagamento" /> },
)

export const CeoSaudeEquipe = dynamic(
  () => import('./components/CeoSaudeEquipe').then((m) => m.CeoSaudeEquipe),
  { ssr: false, loading: () => <ChartSkeleton title="Saúde da equipe" /> },
)
