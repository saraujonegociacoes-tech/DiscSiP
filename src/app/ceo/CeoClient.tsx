'use client'

import { useCallback, useMemo } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Wallet, CalendarClock, Users } from 'lucide-react'
import { AppShell } from '@/components/bluedesk/AppShell'
import { PageHeader } from '@/components/bluedesk/PageHeader'
import { Tabs, TabsContent } from '@/components/ui/tabs'
import { CeoTabNav, type CeoTab } from '@/features/ceo'
// Abas com gráfico (Recharts) sob demanda — ver features/ceo/lazy.tsx.
import { CeoFinanceiro, CeoProjecoes, CeoSaudeEquipe } from '@/features/ceo/lazy'

// Painel do CEO — camada de leitura/agregação por cima das verticais isoladas (ver
// docs/projetopainelceo-docs/updates/painel-ceo-sprints.md). TRÊS abas:
//   1. Financeiro (Sprint 1) — entradas do período, do pipe Financeiro. Carro-chefe.
//   2. Projeções (Sprint 2) — "quando/quanto vão pagar", somando CS + Negociação.
//   3. Saúde da Equipe (Sprints 3+4, fundidas) — receita × custo × margem por departamento
//      e por pessoa.
//
// ⚠️ ERAM QUATRO ABAS. A Sprint 3 nasceu como "Saúde da Empresa" (scorecard de 5 domínios)
// e a Sprint 4 seria "Saúde da Equipe" (por pessoa). Ao reformular a Sprint 3 para receita
// e custo POR PESSOA, ela virou o que a Sprint 4 seria — o dono constatou isso em 06/ago e
// mandou fundir: a aba placeholder saiu e a que ficou herdou o nome "Saúde da Equipe".
//
// ⚠️ A RPC continua se chamando `get_ceo_saude_empresa`, desalinhada do rótulo de
// propósito: renomear exigiria mais uma migration mexendo em objeto já aplicado, e este
// projeto já se queimou com troca de definição de função entre migrations.
//
// O que a Sprint 4 previa e NÃO entrou: atividade por pessoa vinda de Leads/CS/Monday/
// Discador. Medido em 06/ago, só 9 das 30 pessoas do Financeiro cruzam com aqueles
// cadastros (Leads 4, CS 5, profiles 2) — são papéis diferentes, não cadastro ruim.
// Entraria como coluna vazia em 2 de cada 3 linhas. Decisão do dono: fica de fora até a
// identidade ser unificada.
//
// A casca (Radix Tabs + ?aba= + AppShell/PageHeader) é réplica local do padrão de
// app/cs/CsClient.tsx — domínio separado, réplica e não componente compartilhado.
//
// Sem PeriodPicker aqui: cada aba tem o seu, porque cada uma recorta uma coisa diferente
// (entrada, vencimento, receita do período). As três usam o CeoPeriodPicker, que oferece
// mês civil (default) e ciclo 11→10.

type TabSlug = 'financeiro' | 'projecoes' | 'saude-equipe'

const TABS: Array<CeoTab & { slug: TabSlug }> = [
  { slug: 'financeiro', label: 'Financeiro', icon: Wallet },
  { slug: 'projecoes', label: 'Projeções', icon: CalendarClock },
  { slug: 'saude-equipe', label: 'Saúde da Equipe', icon: Users },
]

// Link antigo (?aba=saude-empresa) continua abrindo a aba certa em vez de cair no
// Financeiro em silêncio — a aba mudou de nome, não sumiu.
const SLUG_ANTIGO: Record<string, TabSlug> = { 'saude-empresa': 'saude-equipe' }

export function CeoClient() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // Aba ativa sincronizada com ?aba=; deep-link inválido cai na primeira (financeiro).
  const requestedTab = searchParams.get('aba')
  const activeTab = useMemo<TabSlug>(() => {
    const slug = SLUG_ANTIGO[requestedTab ?? ''] ?? requestedTab
    return TABS.some((t) => t.slug === slug) ? (slug as TabSlug) : TABS[0].slug
  }, [requestedTab])

  const handleTabChange = useCallback(
    (slug: string) => {
      const params = new URLSearchParams(searchParams.toString())
      params.set('aba', slug)
      router.replace(`${pathname}?${params.toString()}`, { scroll: false })
    },
    [router, pathname, searchParams],
  )

  return (
    <AppShell>
      <PageHeader
        title="Painel do CEO"
        description="Visão executiva do negócio — financeiro, projeções e saúde da empresa e da equipe."
      />

      <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
        <CeoTabNav tabs={TABS} />

        <div>
          {/* 1 · Financeiro — entradas do mês (Sprint 1, carro-chefe). CONSTRUÍDA: lê
              get_ceo_financeiro sobre fin_entries (uma linha por pagamento — o pipe mudou de
              convenção no meio de 2025 e cards antigos carregam até 4 pagamentos com datas em
              meses diferentes). Componente busca o próprio dado, com período próprio. */}
          <TabsContent value="financeiro" className="mt-6">
            <CeoFinanceiro />
          </TabsContent>

          {/* 2 · Projeções (Sprint 2) — lê get_ceo_projecoes(p_start, p_end), que junta
              `neg_cards` (pipe 3.0 Negociação) com o plano de pagamento do CS.
              ⚠️ Só dinheiro NÃO recebido: o realizado das duas fontes já virou card no pipe
              do Financeiro e está contado na aba 1 — somar as duas abas contaria o mesmo
              dinheiro duas vezes.
              O período filtra por VENCIMENTO; as faixas (vencida/≤30d/…) seguem relativas a
              HOJE, não ao início do período — "isso já atrasou?" é pergunta sobre hoje. */}
          <TabsContent value="projecoes" className="mt-6">
            <CeoProjecoes />
          </TabsContent>

          {/* 3 · Saúde da Equipe (Sprints 3+4 fundidas) — receita × custo × margem por
              departamento e por pessoa. A pessoa é o campo "Vendedor" do pipe Financeiro.
              A RPC é SECURITY DEFINER lendo as tabelas BASE, não as RPCs de cada domínio:
              aquelas são SECURITY INVOKER e o papel `ceo` não está no RLS delas, então
              devolveriam zero — não erro, zero. */}
          <TabsContent value="saude-equipe" className="mt-6">
            <CeoSaudeEquipe />
          </TabsContent>

        </div>
      </Tabs>
    </AppShell>
  )
}
