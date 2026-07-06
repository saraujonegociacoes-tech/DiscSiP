// Carga histórica do dashboard de leads (passo 8).
// Pagina o Pipefy (GraphQL allCards), monta o payload e chama a RPC
// ingest_lead_event no Supabase via service_role — exatamente o caminho do Make.
// Idempotente: re-rodar é seguro (upsert por card + dedup de evento).
//
// Rodar:  node scripts/import-leads.mjs   (ou: npm run import:leads)
// Requer no .env.local:
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PIPEFY_TOKEN
//   (opcional) PIPEFY_PIPE_ID (default 307104305), PIPEFY_PAGE_SIZE (default 30)
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
const PIPE_ID = env.PIPEFY_PIPE_ID || '307104305'
const PAGE_SIZE = Number(env.PIPEFY_PAGE_SIZE || 30)

for (const [k, v] of Object.entries({
  NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
  PIPEFY_TOKEN,
})) {
  if (!v) {
    console.error(`import-leads: falta ${k} no .env.local`)
    process.exit(1)
  }
}

const PIPEFY_URL = 'https://api.pipefy.com/graphql'
const QUERY = `
query LeadsDump($pipeId: ID!, $cursor: String, $size: Int!) {
  allCards(pipeId: $pipeId, first: $size, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    edges { node {
      id title created_at updated_at finished_at done
      current_phase { id name }
      assignees { id name email }
      fields { value array_value datetime_value field { id } }
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

async function ingest(payload) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/ingest_lead_event`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ payload }),
  })
  if (!res.ok) throw new Error(`RPC ${res.status}: ${await res.text()}`)
  return res.json()
}

// -- mapeamento node do Pipefy -> payload do ingest_lead_event --
function fieldsById(node) {
  const m = {}
  for (const f of node.fields || []) if (f.field?.id) m[f.field.id] = f
  return m
}
function firstNonEmpty(fx, ids) {
  for (const id of ids) {
    const v = fx[id]?.value
    if (v && String(v).trim()) return v
  }
  return null
}
// Responsáveis vêm do campo respons_vel (fonte de negócio): IDs em array_value,
// nomes em value (JSON). Enriquece nome/email cruzando com assignees por id.
// Fallback: assignees (cards sem respons_vel preenchido).
function responsiblesOf(node, fx) {
  const byId = Object.fromEntries((node.assignees || []).map((a) => [String(a.id), a]))
  const rv = fx['respons_vel']
  if (rv && Array.isArray(rv.array_value) && rv.array_value.length) {
    let names = []
    try { names = JSON.parse(rv.value || '[]') } catch { /* value não-JSON */ }
    return rv.array_value.map((id, i) => {
      const a = byId[String(id)]
      return { id: String(id), name: a?.name || names[i] || null, email: a?.email || null }
    })
  }
  return (node.assignees || []).map((a) => ({ id: String(a.id), name: a.name, email: a.email }))
}
function toPayload(node) {
  const fx = fieldsById(node)
  return {
    card_id: node.id,
    title: fx['nome']?.value || node.title || null,
    to_phase: node.current_phase?.name || null,
    to_phase_id: node.current_phase?.id || null,
    from_phase: null, // carga não conhece a fase anterior (igual ao poll)
    responsibles: responsiblesOf(node, fx),
    created_at: node.created_at || null,
    first_contact_at: fx['1_acionamento_hora']?.datetime_value || null,
    finalized_at: node.finished_at || null,
    updated_at: node.updated_at || null,
    channel: fx['capta_o_do_lead']?.value || null,
    discard_reason: firstNonEmpty(fx, [
      'motivo_descarte',
      'informe_o_motivo', 'informe_o_motivo_1', 'informe_o_motivo_2',
      'informe_o_motivo_3', 'informe_o_motivo_4', 'informe_o_motivo_5',
    ]),
    occurred_at: node.updated_at || null, // melhor proxy do momento do evento
    raw: node,
  }
}

async function main() {
  console.log(`import-leads: pipe ${PIPE_ID}, página ${PAGE_SIZE}`)
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
    const results = await Promise.allSettled(nodes.map((n) => ingest(toPayload(n))))
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
  console.log(`\nimport-leads: fim. ${total} cards em ${page} páginas, ${secs}s.`)
  console.log(`  ok=${ok} falha=${fail} responsabilidade_duplicada=${dup}`)
}

main().catch((e) => {
  console.error('import-leads: erro fatal', e)
  process.exit(1)
})
