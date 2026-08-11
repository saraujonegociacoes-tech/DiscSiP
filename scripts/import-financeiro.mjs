// Carga histórica do Financeiro (Painel do CEO, Sprint 1) — mesmo caminho do Make
// (RPC ingest_financeiro_card), só que em lote e a partir do repo.
//
// Clone de import-cs-cards.mjs: manda o NODE CRU do Pipefy pra RPC. O mapeamento de
// field-ids mora só no SQL da migration em vigor (20260731_financeiro_schema.sql, hoje
// substituída pela 20260810_financeiro_valor_liquido.sql) — este script não conhece campo
// nenhum, então mudar o mapeamento não exige mexer aqui.
//
// Idempotente: re-rodar é seguro (upsert por card + as fin_entries do card são regeradas).
//
// Rodar:  node scripts/import-financeiro.mjs   (ou: npm run import:financeiro)
// Requer no .env.local:
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PIPEFY_TOKEN
//   (opcional) FINANCEIRO_PIPEFY_PIPE_ID (default 304386356 = "2.0 - Financeiro"),
//              FINANCEIRO_PIPEFY_PAGE_SIZE (default 30)
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
const PIPE_ID = env.FINANCEIRO_PIPEFY_PIPE_ID || '304386356'
const PAGE_SIZE = Number(env.FINANCEIRO_PIPEFY_PAGE_SIZE || 30)

for (const [k, v] of Object.entries({
  NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
  PIPEFY_TOKEN,
})) {
  if (!v) {
    console.error(`import-financeiro: falta ${k} no .env.local`)
    process.exit(1)
  }
}

const PIPEFY_URL = 'https://api.pipefy.com/graphql'

// Só o que a RPC consome. Sem phases_history/comments/child_relations (que o CS pede):
// o Financeiro não tem série de movimentação — cada card é um lançamento de pagamento.
const QUERY = `
query FinanceiroDump($pipeId: ID!, $cursor: String, $size: Int!) {
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
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/ingest_financeiro_card`, {
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
  console.log(`import-financeiro: pipe ${PIPE_ID}, página ${PAGE_SIZE}`)
  let cursor = null
  let page = 0
  let total = 0
  let ok = 0
  let fail = 0
  let entries = 0
  let skipped = 0
  let semLiquido = 0
  let semEntrada = 0
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
        // A RPC devolve quantas linhas o card gerou — hoje 0 ou 1 (um card, um líquido).
        // 0 = líquido vazio/zerado ou card sem data; nos dois casos ele não entra em mês
        // nenhum. `motivo` diz qual dos dois foi.
        const n = r.value?.entries ?? 0
        entries += n
        skipped += r.value?.skipped ?? 0
        if (r.value?.motivo === 'sem_liquido') semLiquido++
        if (n === 0) semEntrada++
      } else {
        fail++
        if (fail <= 5) console.error('  falha:', r.reason?.message)
      }
    }
    cursor = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null
    console.log(`  página ${page}: ${total} cards (ok ${ok}, falha ${fail}, ${entries} pagamentos)`)
  } while (cursor)
  const secs = ((Date.now() - t0) / 1000).toFixed(0)
  console.log(`\nimport-financeiro: fim. ${total} cards em ${page} páginas, ${secs}s.`)
  console.log(`  ok=${ok} falha=${fail} pagamentos=${entries} fora_do_total=${skipped} (sem_liquido=${semLiquido}) cards_sem_entrada=${semEntrada}`)
  console.log('\nConferir no Supabase:')
  console.log("  SELECT source, count(*) FROM public.fin_entries GROUP BY source;")
  console.log("  -- esperado: uma linha só, 'liquido' (um card = uma entrada)")
}

main().catch((e) => {
  console.error('import-financeiro: erro fatal', e)
  process.exit(1)
})
