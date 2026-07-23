// Carga histórica do painel de Sucesso do Cliente (CS) — mesmo caminho do Make
// (RPC ingest_cs_card), só que em lote e a partir do repo.
//
// Ao contrário do import-leads.mjs (que remonta o payload em JS), este script manda o
// NODE CRU do Pipefy pra `ingest_cs_card` — o mapeamento de campos mora só no SQL da
// migration 20260715_cs_pipeline_schema.sql, sem duplicar a lógica aqui.
//
// Idempotente: re-rodar é seguro (upsert por card + dedup de evento).
//
// Rodar:  node scripts/import-cs-cards.mjs   (ou: npm run import:cs-cards)
// Requer no .env.local:
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PIPEFY_TOKEN
//   (opcional) CS_PIPEFY_PIPE_ID (default 305801110), CS_PIPEFY_PAGE_SIZE (default 30)
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
const PIPE_ID = env.CS_PIPEFY_PIPE_ID || '305801110'
const PAGE_SIZE = Number(env.CS_PIPEFY_PAGE_SIZE || 30)

for (const [k, v] of Object.entries({
  NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
  PIPEFY_TOKEN,
})) {
  if (!v) {
    console.error(`import-cs-cards: falta ${k} no .env.local`)
    process.exit(1)
  }
}

const PIPEFY_URL = 'https://api.pipefy.com/graphql'
const QUERY = `
query CsDump($pipeId: ID!, $cursor: String, $size: Int!) {
  allCards(pipeId: $pipeId, first: $size, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    edges { node {
      id title created_at updated_at finished_at done
      current_phase { id name }
      phases_history { phase { id } lastTimeIn }
      assignees { id name email }
      fields { name value array_value datetime_value field { id } }
      comments { id text created_at author_name author { id name } }
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
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/ingest_cs_card`, {
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
  console.log(`import-cs-cards: pipe ${PIPE_ID}, página ${PAGE_SIZE}`)
  let cursor = null
  let page = 0
  let total = 0
  let ok = 0
  let fail = 0
  let dup = 0
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
        if (r.value?.duplicate) dup++
      } else {
        fail++
        if (fail <= 5) console.error('  falha:', r.reason?.message)
      }
    }
    cursor = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null
    console.log(`  página ${page}: ${total} cards (ok ${ok}, falha ${fail})`)
  } while (cursor)
  const secs = ((Date.now() - t0) / 1000).toFixed(0)
  console.log(`\nimport-cs-cards: fim. ${total} cards em ${page} páginas, ${secs}s.`)
  console.log(`  ok=${ok} falha=${fail} responsabilidade_duplicada=${dup}`)
}

main().catch((e) => {
  console.error('import-cs-cards: erro fatal', e)
  process.exit(1)
})
