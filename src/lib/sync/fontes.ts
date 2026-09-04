// Catálogo das fontes de ingestão sob demanda — o que era um cenário do Make cada uma.
// Ver docs/ingestao-docs/updates/ingestao-sob-demanda.md
//
// Cada fonte é exatamente o que os 5 módulos do cenário faziam: uma query GraphQL no
// Pipefy com filtro delta, e o NODE CRU indo para a RPC de ingestão. O mapeamento de
// campo por field-id continua morando só no SQL — este arquivo não conhece campo
// nenhum, igual o Make não conhecia. Trocar um mapeamento não encosta aqui.
//
// ⚠️ AS QUERIES SÃO AS DOS IMPORTADORES, MAIS O FILTRO DELTA.
// Cada uma foi copiada de scripts/import-*.mjs (que é o caminho provado da carga
// histórica) e recebeu `filter: { field: "updated_at", operator: gte, value: $since }`.
// Pedir campo a menos aqui quebra a RPC em silêncio — ela lê o que não veio como
// ausente. Se mexer, mexa nos dois lugares.

export const FONTES = ['leads', 'cs', 'cs_pagamento', 'financeiro', 'negociacao'] as const
export type Fonte = (typeof FONTES)[number]

export function ehFonte(v: string): v is Fonte {
  return (FONTES as readonly string[]).includes(v)
}

type DefinicaoFonte = {
  rotulo: string
  /** Pipe do Pipefy. Env com o mesmo nome que os importadores usam. */
  pipeId: () => string
  /** RPC de ingestão. Recebe `{ node }` — o card cru. */
  rpc: string
  query: string
  /**
   * `false` = a query NÃO usa `$since` (lê um balde inteiro toda vez). A marca d'água
   * continua sendo gravada, e simplesmente não entra na consulta.
   */
  usaDelta?: boolean
  /** Espelha o gate de rota do middleware: quem enxerga o painel pode atualizá-lo. */
  permite: (role: string, slug: string | null) => boolean
}

// manager/admin/tester = acesso total (mesma definição do src/lib/supabase/middleware.ts).
const acessoTotal = (role: string) => role === 'manager' || role === 'admin' || role === 'tester'

// O painel do CEO é trava LATERAL: o papel `ceo` só alcança /ceo, e /ceo só aceita
// ceo, admin e tester. Financeiro e Negociação alimentam as abas dele.
const acessoCeo = (role: string) => role === 'ceo' || role === 'admin' || role === 'tester'

const QUERY_LEADS = `
query LeadsDelta($pipeId: ID!, $since: String!, $cursor: String, $size: Int!) {
  allCards(pipeId: $pipeId, first: $size, after: $cursor,
           filter: { field: "updated_at", operator: gte, value: $since }) {
    pageInfo { hasNextPage endCursor }
    edges { node {
      id title created_at updated_at finished_at done
      current_phase { id name }
      assignees { id name email }
      fields { value array_value datetime_value field { id } }
    } }
  }
}`

const QUERY_CS = `
query CsDelta($pipeId: ID!, $since: String!, $cursor: String, $size: Int!) {
  allCards(pipeId: $pipeId, first: $size, after: $cursor,
           filter: { field: "updated_at", operator: gte, value: $since }) {
    pageInfo { hasNextPage endCursor }
    edges { node {
      id title created_at updated_at finished_at done
      current_phase { id name }
      phases_history { phase { id } lastTimeIn }
      assignees { id name email }
      fields { name value array_value datetime_value field { id } }
      comments { id text created_at author_name author { id name } }
      child_relations { name cards { id title fields { name value array_value datetime_value field { id } } } }
    } }
  }
}`

// ⚠️ O SEGUNDO POLL DO CS — NÃO REMOVA ACHANDO QUE É DUPLICATA DO DE CIMA.
// O card do CS é conectado a um pagamento a partir do pipe do FINANCEIRO, e essa conexão
// NÃO mexe no `updated_at` do card do CS. Ou seja: o filtro delta não enxerga o pagamento
// novo, e a aba Pagamento pararia no tempo sem ninguém perceber. A saída (registrada em
// 30/jul/2026 no cenário do Make) é reler o balde "Aguardando Pagamento" INTEIRO a cada
// rodada — são poucos cards, então sai barato. Mesma RPC, mesmo node cru.
const QUERY_CS_PAGAMENTO = `
query CsPagamentoBalde($pipeId: ID!, $cursor: String, $size: Int!) {
  allCards(pipeId: $pipeId, first: $size, after: $cursor,
           filter: { field: "current_phase", operator: eq, value: "343781769" }) {
    pageInfo { hasNextPage endCursor }
    edges { node {
      id title created_at updated_at finished_at done
      current_phase { id name }
      phases_history { phase { id } lastTimeIn }
      assignees { id name email }
      fields { name value array_value datetime_value field { id } }
      comments { id text created_at author_name author { id name } }
      child_relations { name cards { id title fields { name value array_value datetime_value field { id } } } }
    } }
  }
}`

const QUERY_FINANCEIRO = `
query FinanceiroDelta($pipeId: ID!, $since: String!, $cursor: String, $size: Int!) {
  allCards(pipeId: $pipeId, first: $size, after: $cursor,
           filter: { field: "updated_at", operator: gte, value: $since }) {
    pageInfo { hasNextPage endCursor }
    edges { node {
      id title created_at updated_at done
      current_phase { id name }
      fields { name value array_value datetime_value field { id } }
    } }
  }
}`

const QUERY_NEGOCIACAO = `
query NegociacaoDelta($pipeId: ID!, $since: String!, $cursor: String, $size: Int!) {
  allCards(pipeId: $pipeId, first: $size, after: $cursor,
           filter: { field: "updated_at", operator: gte, value: $since }) {
    pageInfo { hasNextPage endCursor }
    edges { node {
      id title created_at updated_at done
      current_phase { id name }
      fields { name value array_value datetime_value field { id } }
    } }
  }
}`

export const DEFINICOES: Record<Fonte, DefinicaoFonte> = {
  leads: {
    rotulo: 'Leads',
    pipeId: () => process.env.PIPEFY_PIPE_ID || '307104305',
    rpc: 'ingest_lead_card',
    query: QUERY_LEADS,
    permite: (role, slug) => acessoTotal(role) || (role === 'supervisor' && slug === 'comercial') || slug === 'comercial',
  },
  cs: {
    rotulo: 'Sucesso do Cliente',
    pipeId: () => process.env.CS_PIPEFY_PIPE_ID || '305801110',
    rpc: 'ingest_cs_card',
    query: QUERY_CS,
    permite: (role, slug) => acessoTotal(role) || slug === 'cs',
  },
  cs_pagamento: {
    rotulo: 'CS · balde de pagamento',
    pipeId: () => process.env.CS_PIPEFY_PIPE_ID || '305801110',
    rpc: 'ingest_cs_card',
    query: QUERY_CS_PAGAMENTO,
    usaDelta: false,
    permite: (role, slug) => acessoTotal(role) || slug === 'cs',
  },
  financeiro: {
    rotulo: 'Financeiro',
    pipeId: () => process.env.FINANCEIRO_PIPEFY_PIPE_ID || '304386356',
    rpc: 'ingest_financeiro_card',
    query: QUERY_FINANCEIRO,
    permite: (role) => acessoCeo(role),
  },
  negociacao: {
    rotulo: 'Negociação',
    pipeId: () => process.env.NEGOCIACAO_PIPEFY_PIPE_ID || '304370275',
    rpc: 'ingest_negociacao_card',
    query: QUERY_NEGOCIACAO,
    permite: (role) => acessoCeo(role),
  },
}

// ⚠️ TAMANHO DA PÁGINA É LIMITE DE PLATAFORMA, NÃO PREFERÊNCIA.
// O Worker da Cloudflare no plano Free permite 50 subrequests por invocação, e uma
// página custa 1 (GraphQL) + N (um POST por card na RPC). Com 30 ficam 31, com folga.
// Subir isso acima de 48 quebra a última página em produção e não em desenvolvimento
// — o erro mais caro possível. É o mesmo 30 dos importadores.
function tamanhoPagina(): number {
  const bruto = Number(process.env.SYNC_PAGE_SIZE)
  if (!Number.isFinite(bruto) || bruto < 1) return 30
  return Math.min(Math.floor(bruto), 40)
}

export const TAMANHO_PAGINA = tamanhoPagina()
