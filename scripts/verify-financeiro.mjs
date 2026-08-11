// CONFERÊNCIA (read-only) do Financeiro — o painel bate com o Pipefy?
//
// Reimplementa em JS as MESMAS regras da migration em vigor
// (20260810_financeiro_valor_liquido.sql: parsers, COALESCE da categoria, sinal, e a
// entrada = VALOR LÍQUIDO do card) a partir do Pipefy CRU, e compara com o que a ingestão
// gravou em fin_cards/fin_entries. É uma segunda implementação de propósito: se as duas
// concordam, o erro teria que estar nas duas.
//
// ⚠️ Desde 10/ago é 1 CARD = 1 ENTRADA, de `copy_of_valor_do_pagamento_bruto` (rótulo
// "Valor do Pagamento Líquido") + `data_do_pagamento`. Os campos de parcela NÃO são mais
// lidos, e card com líquido vazio/zerado não gera entrada — este script lista esses cards
// em vez de somá-los, igual à aba.
//
// Responde as perguntas de aceite:
//   1. Todo card do Pipefy virou card no banco?
//   2. Cada card gerou a entrada certa (líquido + data)?
//   3. O total por mês bate com o que o banco tem?
//
// Rodar:  node scripts/verify-financeiro.mjs        (ou: npm run verify:financeiro)
//         node scripts/verify-financeiro.mjs 2024-09 2026-07   (meses a detalhar)
// Requer no .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PIPEFY_TOKEN.
// Não escreve nada — nem no banco, nem no Pipefy.
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
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY
const PIPEFY_TOKEN = env.PIPEFY_TOKEN
const PIPE_ID = env.FINANCEIRO_PIPEFY_PIPE_ID || '304386356'
const FASE_CANCELADO = '327456661'

for (const [k, v] of Object.entries({
  NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
  PIPEFY_TOKEN,
})) {
  if (!v) {
    console.error(`verify-financeiro: falta ${k} no .env.local`)
    process.exit(1)
  }
}

const MESES_ALVO = process.argv.slice(2).filter((a) => /^\d{4}-\d{2}$/.test(a))

// ── regras espelhadas do SQL ────────────────────────────────────────────────
// fin_parse_money: formato br "1.500,00" → 1500.00
function parseMoney(raw) {
  if (raw == null) return null
  let s = String(raw).trim()
  if (s === '') return null
  if (/,[0-9]{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.')
  s = s.replace(/[^0-9.\-]/g, '')
  if (!/^-?[0-9]+(\.[0-9]+)?$/.test(s)) return null
  return Number(s)
}

// fin_parse_date: DD/MM/YYYY (o formato deste pipe) com fallback ISO → 'YYYY-MM-DD'
function parseDate(raw) {
  if (raw == null) return null
  const s = String(raw).trim()
  if (s === '') return null
  const br = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s)
  if (br) return `${br[3]}-${br[2]}-${br[1]}`
  const iso = s.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null
}

const REF_FIELDS = [
  'refer_ncia_do_pagamento',
  'refer_ncia_do_pagamento_juridico',
  'copy_of_refer_ncia_do_pagamento_juridico',
]
// Campos de valor das parcelas (convenção antiga). NÃO entram mais no total — só servem
// para dizer quanto dinheiro o card declara fora do líquido, no aviso de campo vazio.
const PARCELAS_VALOR = [
  'informe_o_valor_pago_referente_a_1_parcela',
  'informe_o_valor_pago_referente_a_2_parcela',
  'informe_o_valor_pago_referente_a_3_parcela',
  'copy_of_informe_o_valor_pago_referente_a_4_parcela',
]

const sign = (cat) => (/desconto|devolu/i.test(cat ?? '') ? -1 : 1)
const cents = (n) => Math.round(n * 100)

// Recomputa, do node cru, o que a ingestão DEVERIA ter gravado.
function expectedFromNode(node) {
  const f = {}
  for (const x of node.fields ?? []) {
    const id = x.field?.id
    if (id) f[id] = x.value === '' ? null : x.value
  }
  const category = REF_FIELDS.map((k) => f[k]).find((v) => v != null && v !== '') ?? null
  const paidValue = parseMoney(f['valor_de_contrata_o'])
  // O id diz "bruto" (herança de um copy_of no Pipefy); o RÓTULO é "Valor do Pagamento
  // Líquido", e é este o número que a aba conta desde 10/ago.
  const netValue = parseMoney(f['copy_of_valor_do_pagamento_bruto'])
  const paidDate = parseDate(f['data_do_pagamento'])
  const parcelas = PARCELAS_VALOR.reduce((s, k) => s + (parseMoney(f[k]) ?? 0), 0)

  const entries = []
  let skipped = 0
  let motivo = null
  if (netValue == null || netValue === 0) {
    skipped++
    motivo = 'sem_liquido'
  } else if (paidDate == null) {
    skipped++
    motivo = 'sem_data'
  } else {
    entries.push({ seq: 1, value: netValue, date: paidDate, source: 'liquido' })
  }

  return {
    pipefyCardId: String(node.id),
    title: node.title ?? null,
    phaseId: node.current_phase?.id ?? null,
    category,
    entries,
    skipped,
    motivo,
    paidDate,
    // Quanto o card declara FORA do líquido — é o que o aviso da aba mostra.
    valorAlternativo: paidValue || parcelas || 0,
  }
}

// ── coleta ──────────────────────────────────────────────────────────────────
async function supa(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  })
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`)
  return res.json()
}

async function supaAll(table, select) {
  const out = []
  const PAGE = 1000
  for (let offset = 0; ; offset += PAGE) {
    const rows = await supa(`${table}?select=${select}&limit=${PAGE}&offset=${offset}&order=id`)
    out.push(...rows)
    if (rows.length < PAGE) return out
  }
}

const PIPEFY_URL = 'https://api.pipefy.com/graphql'
const QUERY = `
query VerifyDump($pipeId: ID!, $cursor: String) {
  allCards(pipeId: $pipeId, first: 50, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    edges { node {
      id
      title
      current_phase { id }
      fields { value field { id } }
    } }
  }
}`

async function pipefyAll() {
  const out = []
  let cursor = null
  let pages = 0
  do {
    const res = await fetch(PIPEFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${PIPEFY_TOKEN}` },
      body: JSON.stringify({ query: QUERY, variables: { pipeId: PIPE_ID, cursor } }),
    })
    const json = await res.json()
    if (json.errors) throw new Error('Pipefy: ' + JSON.stringify(json.errors))
    const conn = json.data.allCards
    for (const { node } of conn.edges) out.push(node)
    cursor = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null
    pages++
    if (pages % 20 === 0) process.stdout.write(`  …${out.length} cards lidos do Pipefy\n`)
  } while (cursor)
  return out
}

// ── comparação ──────────────────────────────────────────────────────────────
function porMes(entries) {
  const m = new Map()
  for (const e of entries) {
    const mes = e.date.slice(0, 7)
    const acc = m.get(mes) ?? { total: 0, count: 0 }
    acc.total += e.value * e.sign
    acc.count++
    m.set(mes, acc)
  }
  return m
}

async function main() {
  console.log('verify-financeiro: lendo o banco…')
  const [dbCards, dbEntries] = await Promise.all([
    supaAll('fin_cards', 'id,pipefy_card_id,current_phase_id,category,paid_value,paid_date'),
    supaAll('fin_entries', 'id,fin_card_id,seq,entry_value,entry_date,source'),
  ])
  console.log(`  fin_cards: ${dbCards.length}   fin_entries: ${dbEntries.length}`)

  const bySource = {}
  for (const e of dbEntries) bySource[e.source] = (bySource[e.source] ?? 0) + 1
  console.log(`  por convenção: ${Object.entries(bySource).map(([k, v]) => `${k}=${v}`).join('  ') || '(nenhuma)'}`)

  console.log('\nverify-financeiro: lendo o Pipefy (pipe ' + PIPE_ID + ')…')
  const nodes = await pipefyAll()
  console.log(`  ${nodes.length} cards no Pipefy`)

  // Índices
  const dbCardById = new Map(dbCards.map((c) => [c.pipefy_card_id, c]))
  const dbEntriesByCard = new Map()
  for (const e of dbEntries) {
    if (!dbEntriesByCard.has(e.fin_card_id)) dbEntriesByCard.set(e.fin_card_id, [])
    dbEntriesByCard.get(e.fin_card_id).push(e)
  }

  // 1) Cobertura
  const faltando = nodes.filter((n) => !dbCardById.has(String(n.id)))
  console.log('\n── 1. Cobertura ──')
  console.log(`   cards no Pipefy: ${nodes.length}`)
  console.log(`   cards no banco : ${dbCards.length}`)
  console.log(`   faltando no banco: ${faltando.length}${faltando.length ? ' → ' + faltando.slice(0, 5).map((n) => '#' + n.id).join(', ') : ''}`)

  // 2) Card a card
  console.log('\n── 2. Entradas por card (valor + data + convenção) ──')
  let iguais = 0
  const divergentes = []
  let skippedTotal = 0
  const semLiquido = [] // cards fora do total por líquido vazio, mas com dinheiro declarado
  const esperadas = [] // { date, value, sign } de todos os cards não-cancelados
  const doBanco = []

  for (const node of nodes) {
    const exp = expectedFromNode(node)
    skippedTotal += exp.skipped
    if (exp.motivo === 'sem_liquido' && exp.valorAlternativo !== 0 && exp.phaseId !== FASE_CANCELADO) {
      semLiquido.push(exp)
    }
    const card = dbCardById.get(exp.pipefyCardId)
    if (!card) continue

    const got = (dbEntriesByCard.get(card.id) ?? []).map((e) => ({
      seq: e.seq,
      value: Number(e.entry_value),
      date: e.entry_date,
      source: e.source,
    }))

    const norm = (list) =>
      list
        .slice()
        .sort((a, b) => a.seq - b.seq)
        .map((e) => `${e.seq}:${cents(e.value)}:${e.date}:${e.source}`)
        .join('|')

    if (norm(exp.entries) === norm(got)) iguais++
    else if (divergentes.length < 10) divergentes.push({ id: exp.pipefyCardId, esperado: norm(exp.entries) || '(nenhuma)', banco: norm(got) || '(nenhuma)' })
    else divergentes.push({ id: exp.pipefyCardId })

    // Totais só das fases que contam (exclui "Pagamento cancelado")
    if (exp.phaseId !== FASE_CANCELADO) {
      const s = sign(exp.category)
      for (const e of exp.entries) esperadas.push({ ...e, sign: s })
      for (const e of got) doBanco.push({ ...e, sign: sign(card.category) })
    }
  }

  console.log(`   idênticos: ${iguais}`)
  console.log(`   divergentes: ${divergentes.length}`)
  for (const d of divergentes.slice(0, 10)) {
    console.log(`     #${d.id}\n        esperado: ${d.esperado}\n        banco   : ${d.banco}`)
  }
  console.log(`   cards que não geram entrada (sem líquido ou sem data): ${skippedTotal}`)

  // 2b) Os que ficam de fora do total por falta do campo líquido. Não é erro de
  // ingestão: é pendência de preenchimento no Pipefy, a mesma lista que a aba mostra.
  const brl = (n) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  console.log('\n── 2b. Sem "Valor do Pagamento Líquido" (fora do total, com dinheiro em outro campo) ──')
  console.log(`   ${semLiquido.length} cards · ${brl(semLiquido.reduce((s, c) => s + c.valorAlternativo, 0))} fora da soma`)
  for (const c of semLiquido.slice(0, 20)) {
    console.log(`     #${c.pipefyCardId}  ${c.paidDate ?? 's/data'}  ${brl(c.valorAlternativo)}  ${(c.title ?? '').slice(0, 32)}`)
  }

  // 3) Totais por mês
  console.log('\n── 3. Total por mês (só fases que contam, com sinal) ──')
  const mExp = porMes(esperadas)
  const mDb = porMes(doBanco)
  const meses = [...new Set([...mExp.keys(), ...mDb.keys()])].sort()
  const alvo = MESES_ALVO.length ? MESES_ALVO : meses.slice(-6)

  let mesesDivergentes = 0
  for (const m of meses) {
    const a = mExp.get(m) ?? { total: 0, count: 0 }
    const b = mDb.get(m) ?? { total: 0, count: 0 }
    if (cents(a.total) !== cents(b.total) || a.count !== b.count) mesesDivergentes++
  }
  console.log(`   ${meses.length} meses no total · ${mesesDivergentes} com diferença\n`)
  console.log('   mês        Pipefy (recalculado)        banco                  ok?')
  for (const m of alvo) {
    const a = mExp.get(m) ?? { total: 0, count: 0 }
    const b = mDb.get(m) ?? { total: 0, count: 0 }
    const ok = cents(a.total) === cents(b.total) && a.count === b.count
    console.log(
      `   ${m}   ${(brl(a.total) + ` (${a.count})`).padEnd(26)} ${(brl(b.total) + ` (${b.count})`).padEnd(26)} ${ok ? 'OK' : '✗ DIFERE'}`,
    )
  }

  const totalExp = esperadas.reduce((s, e) => s + e.value * e.sign, 0)
  const totalDb = doBanco.reduce((s, e) => s + e.value * e.sign, 0)
  console.log(`\n   TOTAL GERAL  Pipefy ${brl(totalExp)}   ·   banco ${brl(totalDb)}   ${cents(totalExp) === cents(totalDb) ? 'OK' : '✗ DIFERE'}`)

  const tudoOk = faltando.length === 0 && divergentes.length === 0 && mesesDivergentes === 0
  console.log(`\nverify-financeiro: ${tudoOk ? 'TUDO BATE ✅' : 'HÁ DIVERGÊNCIAS ✗ (detalhes acima)'}`)
  process.exitCode = tudoOk ? 0 : 1
}

main().catch((e) => {
  console.error('verify-financeiro: erro fatal', e)
  process.exit(1)
})
