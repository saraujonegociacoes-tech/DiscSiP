'use server'

import { createServerClient } from '@/lib/supabase/server'
import { sanitizePeriod, type LeadPeriod } from '@/lib/period'
import type { CeoFinanceiroData } from '@/lib/types/database'

// Server actions do Painel do CEO — camada de leitura/agregação por cima das verticais
// isoladas (ver docs/projetopainelceo-docs/updates/painel-ceo-sprints.md).
//
// Duas particularidades deste domínio:
//
//  1. AGREGAR NO POSTGRES, não no Worker. Cada RPC devolve 1 linha jsonb com o painel
//     inteiro pronto, em vez de linhas cruas. Isso evita o teto de 1000 linhas do PostgREST
//     e o estouro de CPU do Cloudflare (Error 1102) — ver
//     docs/discadora-docs/fixes/correcao-cpu-cloudflare-1102.md.
//
//  2. GUARDA NO BANCO, não só na rota. As RPCs são SECURITY DEFINER com
//       IF public.ceo_current_role() NOT IN ('ceo','admin') THEN RETURN; END IF;
//     (helper criado em supabase/migrations/20260729_ceo_role.sql). É o que permite ao CEO
//     ler as verticais sem espalhar 'ceo' pelo RLS de cada domínio — o middleware é a
//     primeira barreira, não a única. Papel errado → a RPC devolve NULL e a action degrada
//     pra painel vazio, sem vazar nem estourar.

const EMPTY_FINANCEIRO: Omit<CeoFinanceiroData, 'periodStart' | 'periodEnd'> = {
  total: 0,
  count: 0,
  previousTotal: 0,
  previousCount: 0,
  monthly: [],
  byCategory: [],
  byDepartment: [],
  byPaymentMethod: [],
  duplicates: [],
}

// ABA 1 — Financeiro (entradas do mês). Lê get_ceo_financeiro(p_start, p_end)
// (migration 20260731_financeiro_schema.sql), que soma sobre `fin_entries` — uma linha
// por PAGAMENTO, não por card, porque o pipe do Financeiro mudou de convenção no meio de
// 2025 e cards antigos carregam até 4 pagamentos com datas em meses diferentes.
//
// Os valores chegam com o sinal já aplicado (desconto/devolução negativos) e sem a fase
// "Pagamento cancelado". A janela segue o toggle do frontend (mês civil ou ciclo 11→10);
// a série mensal é sempre em meses civis.
export async function getCeoFinanceiro(period: LeadPeriod): Promise<CeoFinanceiroData> {
  const p = sanitizePeriod(period)
  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('get_ceo_financeiro', {
    p_start: p.start,
    p_end: p.end,
  })

  // Degrada (não quebra) se a migration ainda não foi aplicada, se o papel não passar na
  // guarda, ou se não houver dado ingerido.
  //
  // Mas degradar em silêncio esconde uma falha REAL: erro na RPC e "sem dado" produzem a
  // mesma tela vazia. Como a guarda `ceo_current_role()` só deixa a query rodar numa sessão
  // de verdade, um erro dentro dela não aparece em nenhum teste automatizado — só aqui. Por
  // isso o log: a tela continua degradando, o servidor conta o motivo.
  if (error) {
    console.error('[ceo] get_ceo_financeiro falhou:', error.message ?? error)
  }
  if (error || !data) {
    return { periodStart: p.start, periodEnd: p.end, ...EMPTY_FINANCEIRO }
  }

  const d = data as unknown as Partial<CeoFinanceiroData>
  return {
    periodStart: d.periodStart ?? p.start,
    periodEnd: d.periodEnd ?? p.end,
    total: Number(d.total ?? 0),
    count: Number(d.count ?? 0),
    previousTotal: Number(d.previousTotal ?? 0),
    previousCount: Number(d.previousCount ?? 0),
    monthly: d.monthly ?? [],
    byCategory: d.byCategory ?? [],
    byDepartment: d.byDepartment ?? [],
    byPaymentMethod: d.byPaymentMethod ?? [],
    duplicates: d.duplicates ?? [],
  }
}
