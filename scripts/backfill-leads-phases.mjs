// Reconciliação de fases do dashboard de leads (fix de 01/set/2026).
//
// POR QUE ISTO EXISTE
// O poll do Make perdeu movimentações de card: em 01/set o Pipefy tinha 2284 cards em
// Remarketing e o banco só 272, enquanto 1° e 2° Acionamento estavam inflados em ~2100
// (os cards ficaram congelados na última fase que o poll viu). O total batia — 6620 no
// Pipefy contra 6618 no banco —, então não era card faltando: era FASE errada. Isso
// derrubava a contagem de Empréstimo em ~34 leads por ciclo, que foi o sintoma relatado.
//
// O QUE FAZ, por card do pipe:
//   1. ingest_lead_event         -> corrige a fase ATUAL (mesmo caminho do Make/carga).
//   2. ingest_lead_phase_history -> regrava o HISTÓRICO a partir do `phases_history` do
//      Pipefy (fonte autoritativa), consertando também as métricas por ENTRADA de fase:
//      funil da aba Funil, acionamento por etapa, tempo médio por fase e os drill-downs.
// Idempotente: upsert por card + dedup de evento. Re-rodar é seguro.
//
// E ao final, com a varredura COMPLETA em mãos: chama mark_leads_deleted, que concilia os
// dois sentidos — marca o lead cujo card sumiu do Pipefy (some de toda contagem, mas a
// linha fica, mapeada em v_leads_deleted) e desmarca o que reapareceu. Só roda se a
// varredura terminou sem NENHUMA falha: lista parcial marcaria card vivo como excluído.
// (O banco tem uma segunda trava, recusando lista < 90% dos ativos — cinto e suspensório.)
//
// Também AVISA se o Pipefy tiver fase que não está em lead_phases — foi exatamente esse
// silêncio (a fase Remarketing, criada depois do seed) que segurou o bug por meses.
//
// PRÉ-REQUISITO: aplicar antes a migration
//   supabase/migrations/Migrations_painelleads/20260901_leads_remarketing_reaproveitado.sql
//
// Rodar:  npm run backfill:leads-phases
//         npm run backfill:leads-phases -- --dry-run   (não escreve nada, só relata)
// Requer no .env.local:
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PIPEFY_TOKEN
//   (opcional) PIPEFY_PIPE_ID (default 307104305), PIPEFY_PAGE_SIZE (default 30)
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const DRY_RUN = process.argv.includes('--dry-run')

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
    console.error(`backfill-leads-phases: falta ${k} no .env.local`)
    process.exit(1)
  }
}

const PIPEFY_URL = 'https://api.pipefy.com/graphql'

async function pipefy(query, variables) {
  const res = await fetch(PIPEFY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${PIPEFY_TOKEN}` },
    body: JSON.stringify({ query, variables }),
  })
  const json = await res.json()
  if (json.errors) throw new Error('Pipefy: ' + JSON.stringify(json.errors))
  return json.data
}

// `args` é o objeto de argumentos NOMEADOS da função (PostgREST casa por nome), por isso
// o payload das RPCs de ingestão vai como { payload: ... }.
async function rpc(name, args) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  })
  if (!res.ok) throw new Error(`RPC ${name} ${res.status}: ${await res.text()}`)
  return res.json()
}

async function supabaseGet(path, range) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      ...(range ? { Range: range } : {}),
    },
  })
  if (!res.ok) throw new Error(`GET ${path} ${res.status}: ${await res.text()}`)
  return res.json()
}

// PostgREST corta a resposta no "Max Rows" do projeto (1000). Sem paginar, a conferência
// dos excluídos sairia errada e em silêncio — a mesma armadilha do fix de truncamento.
async function supabaseGetAll(path) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const b = await supabaseGet(path, `${from}-${from + 999}`)
    out.push(...b)
    if (b.length < 1000) return out
  }
}

// -- 1. fases: as do pipe (verdade) x as cadastradas (o que o app entende) --------
// Além de avisar sobre fase nova, o Set de ids válidos filtra o histórico: o Pipefy
// devolve também a fase de sistema "Start form", que não é etapa do funil e só
// poluiria lead_events com ~1 evento inútil por card.
async function loadPhases() {
  const [{ pipe }, registered] = await Promise.all([
    pipefy(`query($id: ID!) { pipe(id: $id) { name phases { id name cards_count } } }`, { id: PIPE_ID }),
    supabaseGet('lead_phases?select=pipefy_phase_id,name'),
  ])
  const known = new Set(registered.map((p) => p.pipefy_phase_id))
  const missing = pipe.phases.filter((f) => !known.has(f.id))
  return { pipeName: pipe.name, phases: pipe.phases, validIds: new Set(pipe.phases.map((f) => f.id)), missing }
}

const CARDS_QUERY = `
query LeadsBackfill($pipeId: ID!, $cursor: String, $size: Int!) {
  allCards(pipeId: $pipeId, first: $size, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    edges { node {
      id title created_at updated_at finished_at done
      current_phase { id name }
      assignees { id name email }
      fields { value array_value datetime_value field { id } }
      phases_history { phase { id name } firstTimeIn lastTimeIn }
    } }
  }
}`

// -- mapeamento node do Pipefy -> payload do ingest_lead_event (igual import-leads) --
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
    from_phase: null,
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
    occurred_at: node.updated_at || null,
    raw: node,
  }
}

// -- histórico -> lista de entradas de fase, em ordem cronológica -----------------
// firstTimeIn é a entrada real na fase (o poll só sabia o updated_at do card, que é
// bem depois). lastTimeIn entra também quando difere: o card passou pela fase mais de
// uma vez e as duas passagens contam como acionamento.
function historyEntries(node, validIds) {
  const out = []
  for (const h of node.phases_history || []) {
    const id = h.phase?.id
    if (!id || !validIds.has(id)) continue // ignora "Start form" e fases fora do board
    const name = h.phase?.name || null
    if (h.firstTimeIn) out.push({ phase_id: id, phase_name: name, occurred_at: h.firstTimeIn })
    if (h.lastTimeIn && h.lastTimeIn !== h.firstTimeIn)
      out.push({ phase_id: id, phase_name: name, occurred_at: h.lastTimeIn })
  }
  return out.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))
}

async function main() {
  const { pipeName, phases, validIds, missing } = await loadPhases()
  console.log(`backfill-leads-phases: pipe ${PIPE_ID} (${pipeName}), página ${PAGE_SIZE}${DRY_RUN ? ' — DRY RUN' : ''}`)

  if (missing.length) {
    console.error('\n  ⚠ FASES DO PIPEFY QUE NÃO ESTÃO EM lead_phases:')
    for (const f of missing) console.error(`      ${f.id}  ${f.name}  (${f.cards_count} cards)`)
    console.error('    Enquanto não forem cadastradas, esses leads não contam como produtivos')
    console.error('    nem como mortos, e somem do funil. Cadastre em lead_phases e rode de novo.\n')
  } else {
    console.log(`  ✓ as ${phases.length} fases do pipe estão cadastradas em lead_phases`)
  }

  let cursor = null
  let page = 0
  let cards = 0
  let okPhase = 0
  let failPhase = 0
  let okHist = 0
  let failHist = 0
  let events = 0
  let semHistorico = 0
  const vistos = [] // todo card_id que o Pipefy devolveu — base da detecção de excluídos
  const t0 = Date.now()

  do {
    const conn = (await pipefy(CARDS_QUERY, { pipeId: PIPE_ID, cursor, size: PAGE_SIZE })).allCards
    page++
    const nodes = conn.edges.map((e) => e.node)
    for (const n of nodes) vistos.push(n.id)

    const results = await Promise.allSettled(
      nodes.map(async (n) => {
        const entries = historyEntries(n, validIds)
        if (DRY_RUN) return { dry: true, entries: entries.length }
        // ordem importa: o lead precisa existir antes de receber histórico.
        await rpc('ingest_lead_event', { payload: toPayload(n) })
        const h = await rpc('ingest_lead_phase_history', { payload: { card_id: n.id, entries } })
        return { inserted: h?.inserted ?? 0, entries: entries.length }
      })
    )

    for (const r of results) {
      cards++
      if (r.status === 'fulfilled') {
        okPhase++
        okHist++
        events += r.value.inserted ?? 0
        if (!r.value.entries) semHistorico++
      } else {
        failPhase++
        failHist++
        if (failPhase <= 5) console.error('  falha:', r.reason?.message)
      }
    }

    cursor = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null
    if (page % 10 === 0 || !cursor) {
      console.log(`  página ${page}: ${cards} cards (ok ${okPhase}, falha ${failPhase}, eventos novos ${events})`)
    }
  } while (cursor)

  // ── Cards excluídos no Pipefy ─────────────────────────────────────────────
  // Só com a varredura COMPLETA e sem falhas dá para afirmar "este card não existe mais".
  // Com falha no meio, um card vivo pode simplesmente não ter sido lido — e marcá-lo como
  // excluído o tiraria de todos os gráficos silenciosamente. Nesse caso, não mexe.
  let del = null
  if (!DRY_RUN && failPhase === 0) {
    try {
      del = await rpc('mark_leads_deleted', { p_live_card_ids: vistos })
    } catch (e) {
      console.error('\n  ⚠ não foi possível conciliar os excluídos:', e.message)
      console.error('    (a migration 20260902b já foi aplicada? nada foi marcado)')
    }
  }

  const secs = ((Date.now() - t0) / 1000).toFixed(0)
  console.log(`\nbackfill-leads-phases: fim. ${cards} cards em ${page} páginas, ${secs}s.`)
  if (DRY_RUN) {
    console.log('  DRY RUN — nada foi escrito.')
    // Mesma conta que o mark_leads_deleted faria, só que sem escrever: quem está no banco
    // como vivo mas não apareceu na varredura do Pipefy.
    try {
      const vivosNoBanco = await supabaseGetAll(
        'leads?select=pipefy_card_id,title,current_phase&deleted_at=is.null&order=pipefy_card_id'
      )
      const noPipe = new Set(vistos)
      const sumidos = vivosNoBanco.filter((l) => !noPipe.has(l.pipefy_card_id))
      console.log(`\n  Cards que SERIAM marcados como excluídos: ${sumidos.length}`)
      for (const l of sumidos.slice(0, 20)) {
        console.log(`      ${l.pipefy_card_id}  ${l.current_phase ?? '—'}  ${l.title ?? '—'}`)
      }
      if (sumidos.length > 20) console.log(`      … e mais ${sumidos.length - 20}`)
    } catch (e) {
      console.log(`\n  (não deu para conferir os excluídos: ${e.message})`)
      console.log('   a migration 20260902b já foi aplicada? ela cria a coluna deleted_at.')
    }
  } else {
    console.log(`  fase atual:  ok=${okPhase} falha=${failPhase}`)
    console.log(`  histórico:   ok=${okHist} falha=${failHist}, ${events} eventos novos gravados`)
    if (semHistorico) console.log(`  ${semHistorico} cards sem histórico utilizável (fase só de sistema)`)
    if (del) {
      console.log(
        `  excluídos:   ${del.marcados} marcado(s) agora, ${del.restaurados} restaurado(s), ` +
          `${del.total_excluidos} no total — fora de toda contagem, mapeados em v_leads_deleted`
      )
    } else if (failPhase > 0) {
      console.log(`  excluídos:   NÃO conciliado — houve ${failPhase} falha(s), a varredura não é confiável`)
    }
    console.log('\n  Confira agora (SQL Editor):')
    console.log('    SELECT current_phase, count(*) FROM public.v_lead_progress GROUP BY 1 ORDER BY 2 DESC;')
    console.log('    SELECT * FROM public.v_leads_unknown_phase;   -- tem que vir vazio')
    console.log('    SELECT * FROM public.v_leads_deleted ORDER BY created_at;')
    console.log('    SELECT count(*) FROM public.leads WHERE reaproveitado;')
  }
  if (failPhase) process.exitCode = 1
}

main().catch((e) => {
  console.error('backfill-leads-phases: erro fatal', e)
  process.exit(1)
})
