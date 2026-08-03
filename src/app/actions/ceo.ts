'use server'

import { createServerClient } from '@/lib/supabase/server'
import { sanitizePeriod, type LeadPeriod } from '@/lib/period'
import type { CeoFinanceiroData, CeoProjecaoData } from '@/lib/types/database'

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
//     ⚠️ Esse idioma SÓ é seguro porque `ceo_current_role()` nunca devolve NULL — se
//        devolvesse, `NULL NOT IN (...)` seria NULL, o `IF` não entraria e a guarda
//        LIBERARIA. Foi um bug real, corrigido no helper em 20260731c_ceo_guard_null_safe.sql
//        (ver docs/projetopainelceo-docs/fixes/correcao-guarda-ceo-null.md). Ao escrever
//        RPC nova do painel, copie o idioma — ele está seguro pela origem, não por sorte.
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

const EMPTY_PROJECOES: Omit<CeoProjecaoData, 'referenceDate'> = {
  total: 0,
  count: 0,
  negociacao: { total: 0, count: 0 },
  cs: { total: 0, count: 0 },
  byProduct: [],
  byWindow: {},
  items: [],
}

// ABA 2 — Projeções de pagamento. Lê get_ceo_projecoes() (migration
// 20260731b_negociacao_schema.sql), que junta DUAS fontes numa chamada só:
// `neg_cards` (pipe 3.0 Negociação, vertical nova) e o plano de pagamento do CS
// (`cs_cards.metadata` + `cs_card_payments`, que a P4 do CS já construiu).
//
// Sem período: é SNAPSHOT. A janela é de vencimento, calculada contra hoje em BRT
// dentro da RPC — quem manda no corte do dia é o Postgres, não o Worker (que roda
// em UTC no Cloudflare).
//
// ⚠️ Só dinheiro NÃO recebido. O realizado das duas fontes vira card no pipe do
// Financeiro (conectores "Lançar pagamento" e "Subir pagamento") e já está contado
// na aba Financeiro — a RPC exclui card pago e parcela já quitada justamente pra que
// as duas abas nunca somem o mesmo dinheiro.
//
// Hoje o bloco `cs` volta zerado e isso é ESPERADO, não falha: a operação ainda não
// usa a fase "Aguardando Pagamento" do CS. A aba mostra a origem de cada total pra
// que isso apareça como causa, em vez de virar um número que "parece baixo".
export async function getCeoProjecoes(): Promise<CeoProjecaoData> {
  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('get_ceo_projecoes')

  // Mesma disciplina da aba Financeiro: degrada pra vazio, mas conta o motivo no
  // servidor — erro na RPC e "sem dado" produzem a mesma tela, e a guarda
  // ceo_current_role() só roda numa sessão de verdade (nenhum teste pega).
  if (error) {
    console.error('[ceo] get_ceo_projecoes falhou:', error.message ?? error)
  }
  const hoje = new Date().toISOString().slice(0, 10)
  if (error || !data) {
    return { referenceDate: hoje, ...EMPTY_PROJECOES }
  }

  const d = data as unknown as Partial<CeoProjecaoData>
  return {
    referenceDate: d.referenceDate ?? hoje,
    total: Number(d.total ?? 0),
    count: Number(d.count ?? 0),
    negociacao: {
      total: Number(d.negociacao?.total ?? 0),
      count: Number(d.negociacao?.count ?? 0),
    },
    cs: {
      total: Number(d.cs?.total ?? 0),
      count: Number(d.cs?.count ?? 0),
    },
    byProduct: d.byProduct ?? [],
    byWindow: d.byWindow ?? {},
    items: d.items ?? [],
  }
}
