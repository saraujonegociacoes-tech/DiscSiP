'use server'

import { createServerClient } from '@/lib/supabase/server'
import { sanitizePeriod, type LeadPeriod } from '@/lib/period'
import type {
  CeoFinanceiroData,
  CeoMetaConfig,
  CeoProjecaoData,
  CeoSaudeEquipeData,
} from '@/lib/types/database'

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
//     (helper criado em supabase/migrations/Migrations_projetopainelceo/20260729_ceo_role.sql). É o que permite ao CEO
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
  missingNet: [],
  missingNetTotal: 0,
}

// ABA 1 — Financeiro (entradas do mês). Lê get_ceo_financeiro(p_start, p_end)
// (migrations 20260731_financeiro_schema.sql → 20260810_financeiro_valor_liquido.sql),
// que soma sobre `fin_entries`.
//
// A entrada é o "Valor do Pagamento Líquido" do card (decisão do dono, 10/ago). Como o
// líquido é um número único por card, cada card virou UMA linha e os campos de parcela
// pararam de ser lidos — antes um card antigo podia render até 4 entradas em meses
// diferentes. Card com líquido vazio não gera entrada: vem em `missingNet` pra tela
// avisar, em vez de sumir do painel.
//
// Os valores chegam com o sinal já aplicado (desconto/devolução negativos) e sem a fase
// "Pagamento cancelado".
//
// `modo` vale para OS DOIS recortes agora: a janela dos KPIs e os 12 baldes da série.
// Até 05/ago a série era sempre em meses civis mesmo com o toggle em ciclo — decisão da
// Sprint 1 que na prática fazia a tela ignorar o filtro. O dono mandou seguir o recorte
// (migration 20260805c_financeiro_serie_por_ciclo.sql).
export async function getCeoFinanceiro(
  period: LeadPeriod,
  modo: 'mes' | 'ciclo' = 'mes',
): Promise<CeoFinanceiroData> {
  const p = sanitizePeriod(period)
  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('get_ceo_financeiro', {
    p_start: p.start,
    p_end: p.end,
    p_modo: modo,
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
    // Só chegam depois da 20260810; até lá a aba roda sem o aviso, sem quebrar.
    missingNet: d.missingNet ?? [],
    missingNetTotal: Number(d.missingNetTotal ?? 0),
  }
}

// ABA 1 (continuação) — a META ESPERADA do período, que alimenta o card "Diária".
// Lê get_ceo_meta() (migration 20260902_ceo_meta_financeira.sql).
//
// É uma RPC SEPARADA de propósito, e não mais uma chave dentro de get_ceo_financeiro:
// mexer naquela função de 130 linhas para acrescentar um número exigiria um
// CREATE OR REPLACE dela numa migration nova, e este projeto já se queimou duas vezes
// com "a última migration que rodar vence" (supabase/migrations/README.md §6). O custo
// é uma chamada a mais — barata, uma linha de singleton — e a aba a dispara em efeito
// próprio, no mesmo mount do carregamento do período: as duas correm em paralelo, e esta
// não se repete a cada troca do seletor.
//
// A meta é UM número para qualquer período: o alvo do mês civil e o do ciclo 11→10 são
// o mesmo alvo. Trocar o seletor não troca a meta — troca o realizado e os dias úteis
// que ainda restam, que é o que faz a diária mudar.
export async function getCeoMeta(): Promise<CeoMetaConfig> {
  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('get_ceo_meta')

  // Mesma disciplina das outras: degrada (meta 0 = "não cadastrada", a aba fica de pé
  // sem o card) e conta o motivo no servidor, porque erro de RPC e "sem dado" produzem
  // exatamente a mesma tela.
  if (error) {
    console.error('[ceo] get_ceo_meta falhou:', error.message ?? error)
  }
  if (error || !data) return { meta: 0, updatedAt: null }

  const d = data as unknown as Partial<CeoMetaConfig>
  return { meta: Number(d.meta ?? 0), updatedAt: d.updatedAt ?? null }
}

// Gravação da meta. Mesma guarda ceo/admin da leitura; a tabela tem RLS sem policy,
// então esta RPC é a única porta. Zero é valor VÁLIDO — é como o dono desliga o card.
export async function setCeoMeta(valor: number): Promise<{ ok: boolean; erro?: string }> {
  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('set_ceo_meta', { p_valor: valor })
  if (error) {
    console.error('[ceo] set_ceo_meta falhou:', error.message ?? error)
    return { ok: false, erro: error.message }
  }
  // NULL = a guarda barrou. Não é erro de rede: é papel sem permissão.
  if (!data) return { ok: false, erro: 'sem permissão' }
  return data as { ok: boolean; erro?: string }
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
// DUAS datas convivem aqui, e trocá-las inverte a leitura:
//   · o PERÍODO recorta por data de VENCIMENTO — só aparece o que vence na janela;
//   · as FAIXAS (vencida / ≤30d / 31–90d / >90d) são contadas contra HOJE, em BRT,
//     dentro da RPC. "Isso já atrasou?" é pergunta sobre hoje, não sobre o recorte.
// Consequência esperada: escolhendo um período futuro, um item pode aparecer como
// "vencido" — ele venceu de verdade, e continua dentro da janela pedida.
// Quem manda no corte do dia é o Postgres, não o Worker (que roda em UTC no Cloudflare).
// Sem período (NULL/NULL na RPC) o comportamento antigo continua: snapshot completo.
//
// ⚠️ Só dinheiro NÃO recebido. O realizado das duas fontes vira card no pipe do
// Financeiro (conectores "Lançar pagamento" e "Subir pagamento") e já está contado
// na aba Financeiro — a RPC exclui card pago e parcela já quitada justamente pra que
// as duas abas nunca somem o mesmo dinheiro.
//
// Hoje o bloco `cs` volta zerado e isso é ESPERADO, não falha: a operação ainda não
// usa a fase "Aguardando Pagamento" do CS. A aba mostra a origem de cada total pra
// que isso apareça como causa, em vez de virar um número que "parece baixo".
export async function getCeoProjecoes(period?: LeadPeriod): Promise<CeoProjecaoData> {
  const p = period ? sanitizePeriod(period) : null
  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('get_ceo_projecoes', {
    p_start: p?.start ?? null,
    p_end: p?.end ?? null,
  })

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

const EMPTY_SAUDE: Omit<CeoSaudeEquipeData, 'periodStart' | 'periodEnd' | 'referenceDate'> = {
  fatorMes: 1,
  custoGeral: 0,
  totais: { receita: 0, custo: 0, pessoas: 0, semCusto: 0 },
  departamentos: [],
  semVendedor: { receita: 0, pagamentos: 0 },
}

// ABA 3 — Saúde da Equipe: receita × custo × margem, por DEPARTAMENTO e por PESSOA.
// A pessoa é o campo "Vendedor" do pipe Financeiro — não o usuário do Blue Desk (a
// maioria dessas pessoas não tem login: são 30 nomes contra 12 perfis).
//
// ⚠️ A RPC ainda se chama `get_ceo_saude_empresa` (migration 20260805b), e o nome está
// DESALINHADO com a aba de propósito. A aba nasceu como "Saúde da Empresa" na Sprint 3
// e, quando virou por pessoa, o dono fundiu Sprint 3 e 4 e renomeou a aba para "Saúde
// da Equipe" (06/ago). Renomear a função exigiria mais uma migration mexendo em objeto
// já aplicado, e este projeto já se queimou com troca de definição de função entre
// migrations — o nome fica, o comentário avisa.
//
// A receita sai do MESMO `fin_entries` da aba Financeiro, com o mesmo sinal e o mesmo
// filtro de fase cancelada. As duas abas não podem divergir sobre dinheiro.
//
// ⚠️ `semVendedor` não é sobra de arredondamento: é a receita cujo card não tem o campo
// Vendedor preenchido (94% do valor de 2026 tem, mas só 28% dos cards do histórico
// inteiro). Em período antigo a soma das pessoas não fecha com o total — e é essa linha
// que explica a diferença. A aba mostra; não esconde.
export async function getCeoSaudeEquipe(period: LeadPeriod): Promise<CeoSaudeEquipeData> {
  const p = sanitizePeriod(period)
  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('get_ceo_saude_empresa', {
    p_start: p.start,
    p_end: p.end,
  })

  // Mesma disciplina das outras abas: degrada pra vazio, mas conta o motivo no
  // servidor — erro na RPC e "sem dado" produzem a mesma tela.
  if (error) {
    console.error('[ceo] get_ceo_saude_empresa falhou:', error.message ?? error)
  }
  const hoje = new Date().toISOString().slice(0, 10)
  if (error || !data) {
    return {
      periodStart: p.start.slice(0, 10),
      periodEnd: p.end.slice(0, 10),
      referenceDate: hoje,
      ...EMPTY_SAUDE,
    }
  }

  const d = data as unknown as Partial<CeoSaudeEquipeData>
  return {
    periodStart: d.periodStart ?? p.start.slice(0, 10),
    periodEnd: d.periodEnd ?? p.end.slice(0, 10),
    referenceDate: d.referenceDate ?? hoje,
    fatorMes: Number(d.fatorMes ?? 1),
    custoGeral: Number(d.custoGeral ?? 0),
    totais: { ...EMPTY_SAUDE.totais, ...d.totais },
    departamentos: d.departamentos ?? [],
    semVendedor: { ...EMPTY_SAUDE.semVendedor, ...d.semVendedor },
  }
}

// Gravação dos custos. As tabelas têm RLS sem policy — estas RPCs são a única porta,
// e carregam a MESMA guarda ceo/admin das de leitura.
//
// `valor: null` em setCeoPessoaCusto APAGA o custo próprio: a pessoa volta a herdar o
// custo geral. É o "desfazer" da tela.
export async function setCeoCustoGeral(valor: number): Promise<{ ok: boolean; erro?: string }> {
  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('set_ceo_custo_geral', { p_valor: valor })
  if (error) {
    console.error('[ceo] set_ceo_custo_geral falhou:', error.message ?? error)
    return { ok: false, erro: error.message }
  }
  // NULL = a guarda barrou. Não é erro de rede: é papel sem permissão.
  if (!data) return { ok: false, erro: 'sem permissão' }
  return data as { ok: boolean; erro?: string }
}

export async function setCeoPessoaCusto(
  pessoa: string,
  valor: number | null,
): Promise<{ ok: boolean; erro?: string }> {
  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('set_ceo_pessoa_custo', {
    p_pessoa: pessoa,
    p_valor: valor,
  })
  if (error) {
    console.error('[ceo] set_ceo_pessoa_custo falhou:', error.message ?? error)
    return { ok: false, erro: error.message }
  }
  if (!data) return { ok: false, erro: 'sem permissão' }
  return data as { ok: boolean; erro?: string }
}
