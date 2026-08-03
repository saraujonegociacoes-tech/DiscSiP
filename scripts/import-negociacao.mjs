// Carga histórica da Negociação (Painel do CEO, Sprint 2) — mesmo caminho do Make
// (RPC ingest_negociacao_card), só que em lote e a partir do repo.
//
// Clone de import-financeiro.mjs: manda o NODE CRU do Pipefy pra RPC. O mapeamento de
// field-ids mora só no SQL da migration 20260731b_negociacao_schema.sql — este script não
// conhece campo nenhum, então mudar o mapeamento (ou a regra de qual sinal vira projeção)
// não exige mexer aqui.
//
// Ingere o pipe INTEIRO, não só as fases de espera: assim, quando um card entra numa
// dessas fases, ele já está na tabela e o poll por delta do Make só atualiza a fase.
//
// Idempotente: re-rodar é seguro (upsert por pipefy_card_id).
//
// Rodar:  node scripts/import-negociacao.mjs   (ou: npm run import:negociacao)
// Requer no .env.local:
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PIPEFY_TOKEN
//   (opcional) NEGOCIACAO_PIPEFY_PIPE_ID (default 304370275 = "3.0 Negociação"),
//              NEGOCIACAO_PIPEFY_PAGE_SIZE (default 30)
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// -- env: carrega .env.local sem dependência externa (process.env vence o arquivo) --
function loadEnv() {
  const env = { ...process.env }
  try {
    for (const line of readFileSync(join(root, '.env.local'), 'utf8').split(/\r?\n/)) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const i = t.indexOf('=')
      if (i === -1) continue
      const k = t.slice(0, i).trim()
      let v = t.slice(i + 1).trim()
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
      if (!(k in env)) env[k] = v
    }
  } catch {
    /* sem .env.local: usa só process.env */
  }
  return env
}

const env = loadEnv()
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY
const PIPEFY_TOKEN = env.PIPEFY_TOKEN
const PIPE_ID = env.NEGOCIACAO_PIPEFY_PIPE_ID || '304370275'
const PAGE_SIZE = Number(env.NEGOCIACAO_PIPEFY_PAGE_SIZE || 30)

for (const [k, v] of Object.entries({
  NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
  PIPEFY_TOKEN,
})) {
  if (!v) {
    console.error(`import-negociacao: falta ${k} no .env.local`)
    process.exit(1)
  }
}

const PIPEFY_URL = 'https://api.pipefy.com/graphql'

// Só o que a RPC consome. Sem child_relations: o realizado da Negociação já entra pelo
// pipe do Financeiro (conector "Lançar pagamento" → pipe 304386356, já ingerido no
// Sprint 1). Esta vertical traz SÓ projeção — puxar as conexões aqui seria o caminho
// mais curto pra contar o mesmo dinheiro duas vezes.
//
// `datetime_value` vem no node e é gravado no metadata, mas a ingestão NÃO o usa pra
// data: ele está em UTC e vira o dia seguinte em 8,2% dos cards. Ver o comentário de
// neg_parse_date na migration.
const QUERY = `
query NegociacaoDump($pipeId: ID!, $cursor: String, $size: Int!) {
  allCards(pipeId: $pipeId, first: $size, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    edges { node {
      id title created_at updated_at done
      current_phase { id name }
      fields { name value array_value datetime_value field { id } }
    } }
  }
}`

async function pipefy(cursor) {
  const res = await fetch(PIPEFY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${PIPEFY_TOKEN}` },
    body: JSON.stringify({ query: QUERY, variables: { pipeId: PIPE_ID, cursor, size: PAGE_SIZE } }),
  })
  const json = await res.json()
  if (json.errors) throw new Error('Pipefy: ' + JSON.stringify(json.errors))
  return json.data.allCards
}

async function ingest(node) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/ingest_negociacao_card`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ node }),
  })
  if (!res.ok) throw new Error(`RPC ${res.status}: ${await res.text()}`)
  return res.json()
}

async function main() {
  console.log(`import-negociacao: pipe ${PIPE_ID}, página ${PAGE_SIZE}`)
  let cursor = null
  let page = 0
  let total = 0
  let ok = 0
  let fail = 0
  let projetados = 0
  let pagos = 0
  const porSinal = new Map()
  const t0 = Date.now()
  do {
    const conn = await pipefy(cursor)
    page++
    const nodes = conn.edges.map((e) => e.node)
    const results = await Promise.allSettled(nodes.map((n) => ingest(n)))
    for (const r of results) {
      total++
      if (r.status === 'fulfilled') {
        ok++
        // A RPC devolve se o card virou projeção (fase de espera + não pago + valor/data)
        // e de qual sinal ela veio ('fase' ou 'parcela2').
        if (r.value?.projected) {
          projetados++
          const s = r.value?.proj_source ?? '(sem sinal)'
          porSinal.set(s, (porSinal.get(s) ?? 0) + 1)
        }
        if (r.value?.paid) pagos++
      } else {
        fail++
        if (fail <= 5) console.error('  falha:', r.reason?.message)
      }
    }
    cursor = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null
    console.log(`  página ${page}: ${total} cards (ok ${ok}, falha ${fail}, ${projetados} projeções)`)
  } while (cursor)
  const secs = ((Date.now() - t0) / 1000).toFixed(0)
  console.log(`\nimport-negociacao: fim. ${total} cards em ${page} páginas, ${secs}s.`)
  console.log(`  ok=${ok} falha=${fail} projecoes=${projetados} cards_marcados_pagos=${pagos}`)
  for (const [s, n] of [...porSinal.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    sinal "${s}": ${n} projeções`)
  }
  console.log('\nConferir:')
  console.log('  npm run verify:negociacao')
  console.log("  -- ou no Supabase: SELECT proj_source, count(*), sum(proj_value) FROM public.neg_cards")
  console.log("  --                 WHERE public.neg_is_waiting_phase(current_phase_id) AND NOT paid_flag")
  console.log('  --                 GROUP BY proj_source;')
}

main().catch((e) => {
  console.error('import-negociacao: erro fatal', e)
  process.exit(1)
})
