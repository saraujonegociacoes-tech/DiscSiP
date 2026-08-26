'use client'

import dynamic from 'next/dynamic'
import { ChartSkeleton } from '@/components/bluedesk/ChartSkeleton'

// Painéis pesados das Minutas Processuais, carregados sob demanda (mesma decisão e mesmos
// motivos de features/leads/lazy.tsx). Só um painel fica montado por vez (Radix Tabs), então
// não havia razão para o código dos três vir junto:
//   · Visão Geral  → Recharts (o maior chunk do app).
//   · Calendário   → date-fns (grade de dias).
// A Lista (CRUD) fica no barrel estático: é a aba que o time do Jurídico usa para trabalhar e
// não depende de biblioteca pesada.
export const MinutasVisaoGeral = dynamic(
  () => import('./components/MinutasVisaoGeral').then((m) => m.MinutasVisaoGeral),
  { ssr: false, loading: () => <ChartSkeleton title="Visão geral das minutas" /> },
)

export const MinutasCalendario = dynamic(
  () => import('./components/MinutasCalendario').then((m) => m.MinutasCalendario),
  { ssr: false, loading: () => <ChartSkeleton title="Calendário de vencimentos" /> },
)
