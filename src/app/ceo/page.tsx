import { Suspense } from 'react'
import { CeoClient } from './CeoClient'
import { CeoComingSoon } from './CeoComingSoon'

// Painel do CEO — visão executiva FILTRADA do que acontece no Pipefy (produtividade,
// financeiro e saúde do negócio), não movimentação crua. Ver
// docs/projetopainelceo-docs/updates/painel-ceo-indice.md.
//
// Diferente das outras rotas, este painel não é uma vertical: é uma camada de
// leitura/agregação POR CIMA das verticais isoladas (Financeiro, CS, Negociação, Leads,
// Monday, Discador) — consulta cada domínio e compõe em RPCs/actions, sem fundir schemas.
//
// Gate de lançamento igual ao /cs e ao /leads: enquanto NEXT_PUBLIC_CEO_ENABLED não estiver
// ligada, mostra "Em breve" (early return ANTES de qualquer busca no banco). Para trabalhar
// nele localmente, defina NEXT_PUBLIC_CEO_ENABLED=1 no .env.local.
//
// A trava de acesso é do middleware (src/lib/supabase/middleware.ts): só o papel `ceo` e o
// `admin` chegam aqui. A partir do Sprint 1, as RPCs de leitura repetem a guarda no banco
// (SECURITY DEFINER + ceo_current_role()) — defesa em profundidade, não confiança na rota.
//
// Sprint 0: só o esqueleto de abas. Nenhuma aba busca dado ainda; o primeiro entregável real
// é o Financeiro (entradas do mês), no Sprint 1.
const CEO_ENABLED =
  process.env.NEXT_PUBLIC_CEO_ENABLED === '1' || process.env.NEXT_PUBLIC_CEO_ENABLED === 'true'

export default async function CeoPage() {
  if (!CEO_ENABLED) return <CeoComingSoon />

  return (
    // Suspense: o CeoClient usa useSearchParams (aba ativa em ?aba=), que exige um limite de
    // Suspense no App Router. Mesmo padrão de app/cs/page.tsx.
    <Suspense fallback={null}>
      <CeoClient />
    </Suspense>
  )
}
