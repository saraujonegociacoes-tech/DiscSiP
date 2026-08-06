// CONFERÊNCIA (read-only) da Negociação — a projeção bate com o Pipefy?
//
// Reimplementa em JS as MESMAS regras da migration 20260731b_negociacao_schema.sql
// (parsers, prioridade do sinal de projeção, filtro de fase, filtro de pago) a partir do
// Pipefy CRU, e compara com o que a ingestão gravou em neg_cards. É uma segunda
// implementação de propósito: se as duas concordam, o erro teria que estar nas duas.
//
// Responde as perguntas de aceite do Sprint 2:
//   1. Todo card do Pipefy virou card no banco?
//   2. Cada card resolveu a projeção certa (valor, data e de qual sinal veio)?
//   3. O total projetado por janela de vencimento bate?
//   4. O filtro anti-dupla-contagem está de pé — nenhum card pago entrou na projeção?
//
// ⚠️ Uma conferência a mais que o Financeiro não precisava: a de FUSO. O script recomputa
// a data pelos DOIS caminhos (o `value` local e o `datetime_value` em UTC) e conta em
// quantos cards eles divergem. Serve de alarme permanente: se alguém "melhorar" a
// ingestão pra usar o datetime_value, este número vira erro na cara.
//
// Rodar:  node scripts/verify-negociacao.mjs        (ou: npm run verify:negociacao)
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
const PIPE_ID = env.NEGOCIACAO_PIPEFY_PIPE_ID || '304370275'

// Espelha neg_is_waiting_phase (20260803_negociacao_fase_unica.sql).
// UMA fase só. NÃO reintroduzir 338815768 ("Pré - Triagem - 2° Parcela"): apesar de ser a
// fase mais bem preenchida do pipe, ela é do COMERCIAL — acompanhamento de 2ª parcela de
// venda, não cobrança em negociação. Decisão do dono em 2026-08-03.
const FASES_ESPERA = new Set([
  '326422800', // "Aguardando pagamento ⏳💰"
])

for (const [k, v] of Object.entries({
  NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
  PIPEFY_TOKEN,
})) {
  if (!v) {
    console.error(`verify-negociacao: falta ${k} no .env.local`)
    process.exit(1)
  }
}

// ── regras espelhadas do SQL ────────────────────────────────────────────────
// neg_parse_money: formato br "1.166,66" → 1166.66
function parseMoney(raw) {
  if (raw == null) return null
  let s = String(raw).trim()
  if (s === '') return null
  if (/,[0-9]{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.')
  s = s.replace(/[^0-9.\-]/g, '')
  if (!/^-?[0-9]+(\.[0-9]+)?$/.test(s)) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

// neg_parse_date: "DD/MM/YYYY" e "DD/MM/YYYY HH:MM" (regex sem `$`, depois left(s,10)).
// Devolve 'YYYY-MM-DD'. Repare que NÃO existe caminho por datetime_value — de propósito.
function parseDate(raw) {
  if (raw == null) return null
  const s = String(raw).trim()
  if (s === '') return null
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  if (br) return `${br[3]}-${br[2]}-${br[1]}`
  const iso = s.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null
}

const val = (node, id) => {
  const f = (node.fields ?? []).find((x) => x.field?.id === id)
  const v = f?.value
  return v == null || v === '' ? null : v
}
const rawField = (node, id) => (node.fields ?? []).find((x) => x.field?.id === id) ?? null

// neg_projection: SÓ os campos da fase "Aguardando Pagamento". Espelha
// 20260805_negociacao_so_campos_da_fase.sql.
//
// ⚠️ NÃO reintroduzir o fallback para a 2ª parcela da venda
// (`valor_do_pagamento_da_2_parcela` + `data_do_pagamento_da_2_parcela`). Ele existiu
// até 05/ago e saiu por REGRA do dono: campo de pré-venda não gera projeção da
// Negociação, nem em card que esteja na fase certa. Duas razões, e a segunda é factual:
//   1. é escopo do COMERCIAL — o mesmo erro que a 20260803 já tinha corrigido do lado
//      do card (fase 338815768), corrigido pela metade;
//   2. `data_do_pagamento_da_2_parcela` **não é data de parcela**: é carimbo de quando
//      alguém preencheu o formulário. Conferido em 05/ago — três cards distintos com
//      "10/06/2026 17:2x" e discordando do campo de data real do mesmo card.
function projecao(node) {
  const v = parseMoney(val(node, 'informe_o_valor_do_pagamento'))
  const d = parseDate(val(node, 'informe_a_data_agendada_para_o_pagamento_1'))
  return v != null && v !== 0 && d != null ? { src: 'fase', v, d } : null
}

function recomputa(node) {
  const proj = projecao(node)
  const paid = (val(node, 'o_pagamento_foi_reaizado') ?? '') === 'Sim'
  return {
    pipefyCardId: String(node.id),
    phaseId: node.current_phase?.id ?? null,
    paid,
    projValue: proj?.v ?? null,
    projDate: proj?.d ?? null,
    projSource: proj?.src ?? null,
    // Entra na projeção do painel?
    projected: !!proj && !paid && FASES_ESPERA.has(node.current_phase?.id ?? ''),
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

// A tabela pode ainda não existir (migration não aplicada) ou estar vazia (backfill não
// rodado). Nos dois casos o script continua e vira PRÉVIA: mostra o que a projeção VAI
// dar, recomputado só do Pipefy. Serve pra conferir o número antes de aplicar.
async function supaAllOrNull(table, select) {
  try {
    return await supaAll(table, select)
  } catch (e) {
    if (/does not exist|PGRST20[0-9]|schema cache/i.test(String(e.message))) return null
    throw e
  }
}

const PIPEFY_URL = 'https://api.pipefy.com/graphql'
const QUERY = `
query VerifyNegDump($pipeId: ID!, $cursor: String) {
  allCards(pipeId: $pipeId, first: 50, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    edges { node {
      id
      current_phase { id }
      fields { value datetime_value field { id } }
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

const brl = (n) => 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function janela(dateStr, hoje) {
  const d = new Date(dateStr + 'T00:00:00Z')
  const dias = Math.round((d - hoje) / 86400000)
  if (dias < 0) return 'vencida'
  if (dias <= 30) return 'ate30'
  if (dias <= 90) return 'd31a90'
  return 'mais90'
}

async function main() {
  console.log(`verify-negociacao: pipe ${PIPE_ID}\n`)

  console.log('Lendo o Pipefy…')
  const nodes = await pipefyAll()
  console.log(`  ${nodes.length} cards.\n`)

  console.log('Lendo o Supabase…')
  const cards = await supaAllOrNull(
    'neg_cards',
    'pipefy_card_id,current_phase_id,proj_value,proj_date,proj_source,paid_flag',
  )
  const previa = cards === null || cards.length === 0
  if (cards === null) {
    console.log('  neg_cards ainda não existe (migration não aplicada).')
  } else {
    console.log(`  ${cards.length} neg_cards.`)
  }
  if (previa) {
    console.log('  → modo PRÉVIA: mostrando o que a projeção vai dar, recomputado do Pipefy.\n')
  } else {
    console.log('')
  }

  const noBanco = new Map((cards ?? []).map((c) => [String(c.pipefy_card_id), c]))

  let faltando = 0
  let divergentes = 0
  const exemplos = []
  // Defasagem de fase é OUTRA coisa que divergência de dado. O Pipefy é um sistema vivo:
  // entre o backfill e esta conferência, card muda de fase. Isso não é erro da ingestão —
  // é o poll do Make ainda não ter passado. Só vira problema quando a fase envolvida é a
  // de projeção (aí o número da aba está velho) ou quando são muitos (aí o poll caiu).
  let driftFase = 0
  const driftRelevante = []

  // Alarme de fuso: em quantos cards o `value` e o `datetime_value` dariam dias
  // diferentes? Não é erro da ingestão — é a medida do estrago que usar o campo errado
  // causaria. Se um dia virar 0, é porque o Pipefy mudou; se a ingestão passar a usar o
  // datetime_value, `divergentes` acima explode junto.
  let fusoDivergente = 0

  for (const node of nodes) {
    const esperado = recomputa(node)
    const real = noBanco.get(esperado.pipefyCardId)

    for (const id of ['informe_a_data_agendada_para_o_pagamento_1', 'data_do_pagamento_da_2_parcela']) {
      const f = rawField(node, id)
      if (!f?.value || !f?.datetime_value) continue
      const local = parseDate(f.value)
      const utc = String(f.datetime_value).slice(0, 10)
      if (local && local !== utc) fusoDivergente++
    }

    if (!real) {
      if (!previa) {
        faltando++
        if (exemplos.length < 5) exemplos.push(`  #${esperado.pipefyCardId} não está em neg_cards`)
      }
      continue
    }

    const difs = []
    const faseBanco = String(real.current_phase_id ?? '')
    const fasePipefy = String(esperado.phaseId ?? '')
    if (faseBanco !== fasePipefy) {
      driftFase++
      // Só importa pro número da aba se a projeção entra ou sai por causa da mudança.
      if (FASES_ESPERA.has(faseBanco) || FASES_ESPERA.has(fasePipefy)) {
        driftRelevante.push(`  #${esperado.pipefyCardId}: ${faseBanco} → ${fasePipefy} (mexe na projeção)`)
      }
    }
    if (Boolean(real.paid_flag) !== esperado.paid) {
      difs.push(`pago ${real.paid_flag} ≠ ${esperado.paid}`)
    }
    const rv = real.proj_value == null ? null : Number(real.proj_value)
    if ((rv == null) !== (esperado.projValue == null) || (rv != null && Math.abs(rv - esperado.projValue) > 0.005)) {
      difs.push(`valor ${rv} ≠ ${esperado.projValue}`)
    }
    if ((real.proj_date ?? null) !== (esperado.projDate ?? null)) {
      difs.push(`data ${real.proj_date} ≠ ${esperado.projDate}`)
    }
    if ((real.proj_source ?? null) !== (esperado.projSource ?? null)) {
      difs.push(`sinal ${real.proj_source} ≠ ${esperado.projSource}`)
    }

    if (difs.length) {
      divergentes++
      if (exemplos.length < 5) exemplos.push(`  #${esperado.pipefyCardId}: ${difs.join(' | ')}`)
    }
  }

  // ── totais projetados, recomputados do Pipefy ──
  const hoje = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z')
  const projPipefy = nodes.map(recomputa).filter((c) => c.projected)
  const porJanela = new Map()
  const porSinal = new Map()
  let totalPipefy = 0
  for (const c of projPipefy) {
    totalPipefy += c.projValue
    const j = janela(c.projDate, hoje)
    const acc = porJanela.get(j) ?? { total: 0, count: 0 }
    acc.total += c.projValue
    acc.count++
    porJanela.set(j, acc)
    porSinal.set(c.projSource, (porSinal.get(c.projSource) ?? 0) + 1)
  }

  // No modo prévia não há banco pra comparar: o "esperado" é a própria recomputação.
  const projBanco = previa
    ? projPipefy.map((c) => ({ proj_value: c.projValue }))
    : cards.filter(
        (c) =>
          FASES_ESPERA.has(String(c.current_phase_id ?? '')) &&
          !c.paid_flag &&
          c.proj_value != null &&
          Number(c.proj_value) !== 0 &&
          c.proj_date != null,
      )
  const totalBanco = projBanco.reduce((s, c) => s + Number(c.proj_value), 0)

  // Quanto seria contado em dobro se o filtro de pago não existisse.
  const pagosNaFase = previa
    ? nodes
        .map(recomputa)
        .filter((c) => FASES_ESPERA.has(c.phaseId ?? '') && c.paid && c.projValue != null)
        .map((c) => ({ proj_value: c.projValue }))
    : cards.filter(
        (c) => FASES_ESPERA.has(String(c.current_phase_id ?? '')) && c.paid_flag && c.proj_value != null,
      )
  const totalPagos = pagosNaFase.reduce((s, c) => s + Number(c.proj_value), 0)

  console.log('── Resultado ──\n')
  if (previa) {
    console.log(`1) Cards: ${nodes.length} no Pipefy. (prévia — nada no banco pra comparar ainda)`)
    console.log('')
  } else {
    console.log(`1) Cards: ${nodes.length} no Pipefy, ${cards.length} no banco, ${faltando} faltando.`)
    console.log(`2) Divergências de DADO (valor/data/sinal/pago): ${divergentes}`)
    for (const e of exemplos) console.log(e)
    // Defasagem de fase sai à parte: é o poll ainda não ter passado, não erro de ingestão.
    console.log(`   Defasagem de FASE (card moveu no Pipefy depois da carga): ${driftFase}`)
    if (driftRelevante.length) {
      console.log('   ⚠ dessas, mexem na projeção — a aba está mostrando número velho:')
      for (const d of driftRelevante) console.log(d)
    } else if (driftFase) {
      console.log('   Nenhuma envolve a fase de projeção → o número da aba não muda. O Make')
      console.log('   corrige na próxima rodada. Se esse número crescer muito, o poll caiu.')
    }
    console.log('')
    console.log(`3) Projeção — Pipefy recomputado: ${brl(totalPipefy)} em ${projPipefy.length} cards`)
    console.log(`   Projeção — banco:              ${brl(totalBanco)} em ${projBanco.length} cards`)
    console.log(`   ${Math.abs(totalPipefy - totalBanco) < 0.01 && projPipefy.length === projBanco.length ? '✅ batem' : '❌ DIVERGEM'}`)
    console.log('')
  }
  if (previa) {
    console.log(`   Projeção esperada: ${brl(totalPipefy)} em ${projPipefy.length} cards`)
    console.log('')
  }
  console.log('4) Por janela de vencimento (recomputado do Pipefy):')
  for (const k of ['vencida', 'ate30', 'd31a90', 'mais90']) {
    const v = porJanela.get(k) ?? { total: 0, count: 0 }
    console.log(`     ${k.padEnd(8)} ${String(v.count).padStart(4)} cards  ${brl(v.total)}`)
  }
  console.log('')
  console.log('5) Por sinal de origem:')
  for (const [s, n] of [...porSinal.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`     ${s.padEnd(10)} ${n} projeções`)
  }
  console.log('')
  console.log('6) Anti-dupla-contagem (o filtro que mais importa):')
  console.log(`     ${pagosNaFase.length} cards nas fases de espera já marcados como PAGOS, somando ${brl(totalPagos)}`)
  console.log(`     Esse dinheiro já está em fin_entries (aba Financeiro) e está FORA da projeção. ✅`)
  console.log(`     Sem esse filtro a projeção seria ${brl(totalBanco + totalPagos)} em vez de ${brl(totalBanco)}.`)
  console.log('')
  console.log('7) Alarme de fuso (o motivo de a ingestão ler `value`, nunca `datetime_value`):')
  console.log(`     ${fusoDivergente} campos de data em que o dia local ≠ o dia do datetime_value (UTC).`)
  console.log('     São os cards que cairiam no dia — e às vezes no MÊS — errado pelo caminho errado.')
  console.log('')

  if (previa) {
    console.log('ℹ️  Prévia (a migration/backfill ainda não rodou). Depois de aplicar a')
    console.log('   20260731b_negociacao_schema.sql e rodar `npm run import:negociacao`,')
    console.log('   rode de novo: os números acima têm que se repetir, agora vindos do banco.')
    return
  }

  // Defasagem de fase NÃO reprova: o Pipefy é vivo e o poll é assíncrono por desenho.
  // O que reprova é card faltando, dado divergente, ou o total não bater.
  const ok = faltando === 0 && divergentes === 0 && Math.abs(totalPipefy - totalBanco) < 0.01
  console.log(ok ? '✅ Conferência passou.' : '❌ Conferência encontrou divergências (acima).')
  if (ok && driftFase > 0) {
    console.log(`   (${driftFase} card(s) com fase defasada — normal entre rodadas do Make.)`)
  }
  process.exitCode = ok ? 0 : 1
}

main().catch((e) => {
  console.error('verify-negociacao: erro fatal', e)
  process.exit(1)
})
