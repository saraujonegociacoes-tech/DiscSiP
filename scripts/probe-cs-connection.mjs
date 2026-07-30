// PROBE (read-only) — inspeciona a CONEXÃO de um card do SC com o pipe do Financeiro.
//
// Não toca em Supabase, migration nem no app. Só chama a GraphQL do Pipefy e imprime, pra
// um card, o que volta em child_relations / parent_relations (os cards conectados e os
// campos deles). Serve pra responder, com dado real, antes de construir a Página 4:
//   (a) a conexão aparece em child_relations ou parent_relations?
//   (b) quais field-ids do card do Financeiro carregam valor pago / data / cliente?
//   (c) um card conectado = um recebimento (ledger) ou um por cliente?
//
// Rodar (o card de teste que você criou):
//   node scripts/probe-cs-connection.mjs <cardId>
//   (o <cardId> está na URL do card: app.pipefy.com/open-cards/<cardId>)
//
// Sem <cardId>, ele varre o pipe e imprime os primeiros cards que TÊM alguma conexão.
//
// Requer no .env.local: PIPEFY_TOKEN  (opcional CS_PIPEFY_PIPE_ID, default 305801110).
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

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
const PIPEFY_TOKEN = env.PIPEFY_TOKEN
const PIPE_ID = env.CS_PIPEFY_PIPE_ID || '305801110'
const CARD_ID = process.argv[2] || env.PROBE_CARD_ID || null

if (!PIPEFY_TOKEN) {
  console.error('probe: falta PIPEFY_TOKEN no .env.local')
  process.exit(1)
}

const PIPEFY_URL = 'https://api.pipefy.com/graphql'

// Bloco reaproveitado: os campos do card conectado. array_value/datetime_value entram porque
// data costuma vir em datetime_value e conexão/valor podem vir como array (igual à ingestão).
const CARD_FRAGMENT = `
  id title
  current_phase { id name }
  fields { name value array_value datetime_value field { id } }
  child_relations  { name cards { id title current_phase { id name } fields { name value array_value datetime_value field { id } } } }
  parent_relations { name cards { id title current_phase { id name } fields { name value array_value datetime_value field { id } } } }
`

const ONE = `query Probe($id: ID!) { card(id: $id) { ${CARD_FRAGMENT} } }`
const SCAN = `
query Scan($pipeId: ID!, $cursor: String) {
  allCards(pipeId: $pipeId, first: 30, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    edges { node { ${CARD_FRAGMENT} } }
  }
}`

async function gql(query, variables) {
  const res = await fetch(PIPEFY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${PIPEFY_TOKEN}` },
    body: JSON.stringify({ query, variables }),
  })
  const json = await res.json()
  if (json.errors) throw new Error('Pipefy: ' + JSON.stringify(json.errors, null, 2))
  return json.data
}

function hasRelations(card) {
  const c = card.child_relations?.some((r) => r.cards?.length) ?? false
  const p = card.parent_relations?.some((r) => r.cards?.length) ?? false
  return c || p
}

// Imprime, pra cada relação com cards, o resumo field-id → valor de cada card conectado.
function dumpRelations(card, side) {
  const rels = card[side] ?? []
  const withCards = rels.filter((r) => r.cards?.length)
  if (withCards.length === 0) {
    console.log(`  ${side}: (vazio)`)
    return
  }
  for (const rel of withCards) {
    console.log(`  ${side} · "${rel.name}" — ${rel.cards.length} card(s) conectado(s):`)
    for (const cc of rel.cards) {
      console.log(`    ┌ #${cc.id} — ${cc.title ?? '(sem título)'}  [fase: ${cc.current_phase?.name ?? '—'}]`)
      for (const f of cc.fields ?? []) {
        const val = f.value ?? f.datetime_value ?? (f.array_value ? JSON.stringify(f.array_value) : '')
        if (val === '' || val == null) continue
        console.log(`    │   ${f.field?.id ?? '?'} = ${val}   (${f.name})`)
      }
      console.log('    └')
    }
  }
}

function dumpCard(card) {
  console.log('════════════════════════════════════════════════════════════════')
  console.log(`CARD SC #${card.id} — ${card.title ?? '(sem título)'}`)
  console.log(`  fase: ${card.current_phase?.name ?? '—'} (${card.current_phase?.id ?? '?'})`)
  // Todos os campos preenchidos do próprio card do SC — pra pegar os slugs EXATOS dos campos
  // de projeção que você criar na fase (é por esses slugs que a RPC vai ler).
  console.log('  campos do card do SC (preenchidos):')
  for (const f of card.fields ?? []) {
    const val = f.value ?? f.datetime_value ?? (f.array_value ? JSON.stringify(f.array_value) : '')
    if (val === '' || val == null) continue
    console.log(`    ${f.field?.id ?? '?'} = ${val}   (${f.name})`)
  }
  // Campo conector no próprio card (o "connect cards" que você adicionou na fase):
  const connectors = (card.fields ?? []).filter(
    (f) => Array.isArray(f.array_value) && f.array_value.length && /conex|pagamento|financ/i.test(f.name ?? ''),
  )
  if (connectors.length) {
    console.log('  campo(s) conector no card do SC:')
    for (const f of connectors) console.log(`    ${f.field?.id} = ${JSON.stringify(f.array_value)}   (${f.name})`)
  }
  dumpRelations(card, 'child_relations')
  dumpRelations(card, 'parent_relations')
  console.log('')
  // JSON cru das relações, pra eu ver a estrutura exata se o resumo não bastar:
  console.log('  --- JSON cru das relações ---')
  console.log(JSON.stringify({ child_relations: card.child_relations, parent_relations: card.parent_relations }, null, 2))
}

async function main() {
  if (CARD_ID) {
    console.log(`probe: card único #${CARD_ID} (pipe ${PIPE_ID})\n`)
    const data = await gql(ONE, { id: CARD_ID })
    if (!data.card) {
      console.error('probe: card não encontrado (confira o ID na URL do card).')
      process.exit(1)
    }
    dumpCard(data.card)
    return
  }

  console.log(`probe: sem cardId — varrendo o pipe ${PIPE_ID} atrás de cards com conexão…\n`)
  let cursor = null
  let pages = 0
  let found = 0
  do {
    const data = await gql(SCAN, { pipeId: PIPE_ID, cursor })
    pages++
    for (const { node } of data.allCards.edges) {
      if (hasRelations(node)) {
        dumpCard(node)
        found++
        if (found >= 3) return console.log('probe: 3 cards com conexão impressos — parando.')
      }
    }
    cursor = data.allCards.pageInfo.hasNextPage ? data.allCards.pageInfo.endCursor : null
    if (pages % 5 === 0) console.log(`  …${pages} páginas varridas, ${found} com conexão`)
    if (pages >= 50) return console.log('probe: 50 páginas sem achar conexão — passe o cardId direto.')
  } while (cursor)
  if (found === 0) console.log('probe: nenhum card com conexão encontrado. Passe o cardId do card de teste.')
}

main().catch((e) => {
  console.error('probe: erro', e.message)
  process.exit(1)
})
