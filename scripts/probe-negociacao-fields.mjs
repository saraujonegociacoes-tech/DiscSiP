// PROBE (read-only) — introspecção do pipe de NEGOCIAÇÃO no Pipefy (Sprint 2 do painel do CEO).
//
// Irmão de scripts/probe-financeiro-fields.mjs. Aquele lista campos e fases de QUALQUER pipe,
// mas o `--scan` dele mede os riscos de schema com os field-ids do FINANCEIRO cravados — rodar
// aquele --scan aqui devolve tudo zerado. Este mede os riscos DESTE pipe.
//
// Não toca em Supabase, migration nem no app — só lê a GraphQL do Pipefy.
//
// Responde o que o Sprint 2 (Projeções de pagamento) precisa:
//   (a) o que os cards PARADOS na fase "Aguardando pagamento" têm de valor/data → a projeção
//   (b) em que FORMATO esses valores voltam → define neg_parse_money / neg_parse_date
//   (c) a convenção mudou ao longo dos anos? (a armadilha que o Financeiro pegou tarde)
//
// Rodar:
//   node scripts/probe-negociacao-fields.mjs --fase          (os cards parados na fase, cru)
//   node scripts/probe-negociacao-fields.mjs --scan [N]      (N páginas de 30 cards; default 5)
//   node scripts/probe-negociacao-fields.mjs <pipeId> --scan 40
//
// Requer no .env.local: PIPEFY_TOKEN.
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
const args = process.argv.slice(2)
const SCAN = args.includes('--scan')
const FASE = args.includes('--fase')
const positional = args.filter((a) => !a.startsWith('-'))
const PIPE_ID = positional[0] || env.NEGOCIACAO_PIPEFY_PIPE_ID || '304370275'
const SCAN_PAGES = Number(positional[1] || 5)

// Pipe "3.0 Negociação" (304370275), confirmado por introspecção em 31/jul/2026.
const FASE_AGUARDANDO_PAGAMENTO = '326422800'

const CAMPOS = {
  // ── a fase "Aguardando pagamento ⏳💰" (326422800) — é ela que gera a projeção ──
  projData: 'informe_a_data_agendada_para_o_pagamento_1', // datetime · "Informe a data agendada para o Pagamento"
  projValor: 'informe_o_valor_do_pagamento', // currency · "Informe o valor do pagamento"
  projPago: 'o_pagamento_foi_reaizado', // radio Sim/Não · "O pagamento foi Realizado?" (sic, sem o 'l')
  projForma: 'forma_de_pagamento_do_cliente', // radio · forma de pagamento

  // ── start form: contexto do card ──
  produto: 'sele_o_de_lista', // select · "Produto contratado" — a categoria deste pipe
  departamento: 'informe_o_seu_departamento', // radio · mesmos 3 valores do Financeiro (com o "Jurídico" velho)
  vendedor: 'vendedor',
  clienteId: 'id_do_cliente',
  contratante: 'nome_completo',

  // ── start form: pagamento da venda (a 1ª entrada; pode já ter acontecido) ──
  valorTotal: 'valor_da_cobran_a', // currency · "Valor do Pagamento Total"
  dataPagamento: 'data_do_pagamento', // datetime · "Data do Pagamento."
  temSegundaParcela: 'cliente_possui_2_parcela_de_pagamento', // radio Sim/Não
  valorParcela1: 'valor_do_pagamento_da_1_parcela',
  valorParcela2: 'valor_do_pagamento_da_2_parcela',
  dataParcela2: 'data_do_pagamento_da_parcela_2', // date · "Data do pagamento da Parcela 2°"

  // ── quitação futura (outra projeção possível) ──
  dataQuitacaoFinal: 'data_da_quita_o_final_do_cliente',
  valorQuitacaoFinal: 'valor_da_quita_o_final',
}

// Campos cujo FORMATO decide o parser. Para cada um medimos: a máscara do `value`, se o
// `datetime_value` existe, e — a armadilha nova deste pipe — se os dois discordam do DIA.
const CAMPOS_FORMATO = [
  CAMPOS.projData,
  CAMPOS.dataPagamento,
  CAMPOS.dataParcela2,
  CAMPOS.dataQuitacaoFinal,
  CAMPOS.projValor,
  CAMPOS.valorTotal,
]

// "Departamento - Jurídico" é o nome ANTIGO de "Departamento - Negociação" (dono, 31/jul) — o
// mesmo alias do Financeiro, e este pipe também carrega o nome velho no histórico.
const DEPT_ALIAS = { 'Departamento - Jurídico': 'Departamento - Negociação' }
const normDept = (d) => DEPT_ALIAS[d] ?? d ?? '(sem departamento)'

if (!PIPEFY_TOKEN) {
  console.error('probe-negociacao: falta PIPEFY_TOKEN no .env.local')
  process.exit(1)
}

const PIPEFY_URL = 'https://api.pipefy.com/graphql'

const CARD_FIELDS = `
  id title created_at updated_at done
  current_phase { id name }
  fields { name value array_value datetime_value field { id type } }`

const Q_SAMPLE = `
query AmostraCards($pipeId: ID!, $size: Int!, $cursor: String) {
  allCards(pipeId: $pipeId, first: $size, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    edges { node { ${CARD_FIELDS} } }
  }
}`

const Q_FASE = `
query CardsDaFase($phaseId: ID!, $cursor: String) {
  phase(id: $phaseId) {
    id name cards_count
    cards(first: 30, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      edges { node { ${CARD_FIELDS} } }
    }
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

function raw(card, id) {
  return (card.fields ?? []).find((x) => x.field?.id === id) ?? null
}

function get(card, id) {
  const f = raw(card, id)
  if (!f) return null
  if (f.value != null && f.value !== '') return f.value
  if (f.datetime_value) return f.datetime_value
  if (Array.isArray(f.array_value) && f.array_value.length) return f.array_value.join(', ')
  return null
}

const mascara = (s) => String(s).replace(/\d/g, '9')

// A armadilha deste pipe: campo `datetime` traz o ISO em datetime_value, mas em UTC. Um
// pagamento agendado pra 26/07 às 22:47 BRT vira "2026-07-27T01:47Z" — o DIA muda. Quem
// fizer datetime_value::date perde/ganha um dia e, na virada do mês, joga o valor no mês
// errado. Aqui contamos quantas vezes os dois lados discordam.
function diaDiverge(f) {
  if (!f?.value || !f?.datetime_value) return null
  const br = String(f.value).match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  if (!br) return null
  const [, d, m, y] = br
  return `${y}-${m}-${d}` !== String(f.datetime_value).slice(0, 10)
}

function money(s) {
  if (!s) return null
  const n = Number(String(s).replace(/\./g, '').replace(',', '.').replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

const brl = (n) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function conta(map, k) {
  map.set(k, (map.get(k) ?? 0) + 1)
}

function imprimeContagem(titulo, map, total) {
  console.log(titulo)
  const ord = [...map.entries()].sort((a, b) => b[1] - a[1])
  if (!ord.length) console.log('     (nenhum)')
  for (const [k, v] of ord) {
    const pct = total ? ` (${((v / total) * 100).toFixed(1)}%)` : ''
    console.log(`     ${String(v).padStart(5)}×${pct.padEnd(9)} ${k}`)
  }
  console.log('')
}

// ── modo --fase: os cards que ESTÃO parados em "Aguardando pagamento" ─────────
// É a projeção em si. Só 14 cards hoje, então dá pra olhar todos crus.
async function fase() {
  let cursor = null
  let ph
  const nodes = []
  do {
    const data = await gql(Q_FASE, { phaseId: FASE_AGUARDANDO_PAGAMENTO, cursor })
    ph = data.phase
    for (const { node } of ph.cards.edges) nodes.push(node)
    cursor = ph.cards.pageInfo.hasNextPage ? ph.cards.pageInfo.endCursor : null
  } while (cursor)

  console.log('════════════════════════════════════════════════════════════════')
  console.log(`FASE ${ph.id} — "${ph.name}"   ·   ${ph.cards_count} cards (baixados: ${nodes.length})`)
  console.log('════════════════════════════════════════════════════════════════\n')

  let somaProj = 0
  let semValor = 0
  let semData = 0
  const jaPago = new Map()
  const porProduto = new Map()

  for (const n of nodes) {
    const fData = raw(n, CAMPOS.projData)
    const fValor = raw(n, CAMPOS.projValor)
    const v = money(get(n, CAMPOS.projValor))
    const pago = get(n, CAMPOS.projPago) ?? '(vazio)'
    const produto = get(n, CAMPOS.produto) ?? '(sem produto)'
    conta(jaPago, pago)
    conta(porProduto, produto)
    if (v == null) semValor++
    else somaProj += v
    if (!fData?.value && !fData?.datetime_value) semData++

    console.log(`CARD #${n.id} — ${n.title ?? '(sem título)'}`)
    console.log(`   criado ${String(n.created_at).slice(0, 10)} · atualizado ${String(n.updated_at).slice(0, 10)} · done=${n.done}`)
    console.log(`   ${CAMPOS.projValor.padEnd(44)} value=${JSON.stringify(fValor?.value ?? null)}`)
    console.log(
      `   ${CAMPOS.projData.padEnd(44)} value=${JSON.stringify(fData?.value ?? null)}  datetime_value=${JSON.stringify(fData?.datetime_value ?? null)}` +
        (diaDiverge(fData) ? '   ⚠ DIA DIVERGE (UTC)' : ''),
    )
    console.log(`   pagamento realizado? ${pago}   ·   forma: ${get(n, CAMPOS.projForma) ?? '—'}`)
    console.log(`   produto: ${produto}   ·   depto: ${normDept(get(n, CAMPOS.departamento))}`)
    console.log(
      `   venda: total=${get(n, CAMPOS.valorTotal) ?? '—'} · 2ª parcela? ${get(n, CAMPOS.temSegundaParcela) ?? '—'}` +
        ` (${get(n, CAMPOS.valorParcela2) ?? '—'} em ${get(n, CAMPOS.dataParcela2) ?? '—'})`,
    )
    console.log('')
  }

  console.log('── Resumo da fase ──')
  console.log(`   total projetado: R$ ${brl(somaProj)}   (${nodes.length} cards)`)
  console.log(`   ${semValor} sem valor · ${semData} sem data agendada`)
  console.log('')
  imprimeContagem('   "O pagamento foi Realizado?" (card ainda na fase):', jaPago, nodes.length)
  imprimeContagem('   Produto contratado:', porProduto, nodes.length)
}

// ── modo --scan: mede os riscos de SCHEMA sobre uma amostra grande ───────────
// As perguntas que a fase de hoje (14 cards) não responde:
//   1. o formato de data/valor é uniforme ao longo dos ANOS? (o Financeiro mudou no meio)
//   2. datetime_value e value discordam do dia? (fuso — a armadilha nova deste pipe)
//   3. quantos cards JÁ PASSARAM pela fase e têm os campos de projeção preenchidos?
async function scan() {
  console.log(`probe-negociacao: varrendo até ${SCAN_PAGES} páginas de 30 cards do pipe ${PIPE_ID}…\n`)
  let cursor = null
  let pages = 0
  let total = 0

  const porFase = new Map()
  const porAno = new Map() // ano -> { total, comProj, comData2 }
  const formato = new Map() // fieldId -> Map(mascara -> n)
  const isoAusente = new Map() // fieldId -> { comIso, semIso, diverge }
  const porProduto = new Map()
  const porDepto = new Map()
  const preenchido = new Map() // fieldId -> n
  const comProjNaoNaFase = []
  let somaProjNaFase = 0
  let cardsNaFase = 0
  const segundaParcela = { sim: 0, nao: 0, simComData: 0, simComValor: 0 }

  do {
    const conn = (await gql(Q_SAMPLE, { pipeId: PIPE_ID, size: 30, cursor })).allCards
    pages++
    for (const { node } of conn.edges) {
      total++
      const faseId = node.current_phase?.id
      conta(porFase, `${faseId} — ${node.current_phase?.name ?? '?'}`)

      const ano = String(node.created_at ?? '').slice(0, 4) || '?'
      const acc = porAno.get(ano) ?? { total: 0, comProj: 0, comData2: 0 }
      acc.total++

      for (const id of CAMPOS_FORMATO) {
        const f = raw(node, id)
        if (!f) continue
        const v = f.value
        if (v != null && v !== '') {
          if (!formato.has(id)) formato.set(id, new Map())
          conta(formato.get(id), mascara(v))
        }
        const st = isoAusente.get(id) ?? { comIso: 0, semIso: 0, diverge: 0 }
        if (v != null && v !== '') {
          if (f.datetime_value) st.comIso++
          else st.semIso++
          if (diaDiverge(f)) st.diverge++
        }
        isoAusente.set(id, st)
      }

      for (const [, id] of Object.entries(CAMPOS)) {
        if (get(node, id)) conta(preenchido, id)
      }

      const vProj = money(get(node, CAMPOS.projValor))
      if (vProj != null) {
        acc.comProj++
        if (faseId === FASE_AGUARDANDO_PAGAMENTO) {
          cardsNaFase++
          somaProjNaFase += vProj
        } else if (comProjNaoNaFase.length < 5) {
          comProjNaoNaFase.push({ id: node.id, fase: node.current_phase?.name, v: vProj, pago: get(node, CAMPOS.projPago) })
        }
      }
      if (get(node, CAMPOS.dataParcela2)) acc.comData2++
      porAno.set(ano, acc)

      conta(porProduto, get(node, CAMPOS.produto) ?? '(sem produto)')
      conta(porDepto, normDept(get(node, CAMPOS.departamento)))

      const seg = get(node, CAMPOS.temSegundaParcela)
      if (seg === 'Sim') {
        segundaParcela.sim++
        if (get(node, CAMPOS.dataParcela2)) segundaParcela.simComData++
        if (money(get(node, CAMPOS.valorParcela2))) segundaParcela.simComValor++
      } else if (seg === 'Não') segundaParcela.nao++
    }
    cursor = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null
  } while (cursor && pages < SCAN_PAGES)

  console.log(`── Varredura: ${total} cards em ${pages} páginas ──\n`)

  console.log('1) FORMATO dos campos que decidem o parser (máscara do `value`, dígito→9):')
  for (const id of CAMPOS_FORMATO) {
    const m = formato.get(id)
    if (!m) {
      console.log(`   ${id}\n       (nunca preenchido nesta amostra)`)
      continue
    }
    const st = isoAusente.get(id) ?? {}
    console.log(`   ${id}`)
    for (const [k, v] of [...m.entries()].sort((a, b) => b[1] - a[1])) console.log(`       ${String(v).padStart(5)}×  ${k}`)
    console.log(`       datetime_value: ${st.comIso ?? 0} presentes / ${st.semIso ?? 0} nulos` + (st.diverge ? `   ⚠ ${st.diverge} com DIA DIVERGENTE (fuso UTC)` : ''))
  }
  console.log('')

  console.log('2) Por ano de criação (a convenção muda no meio da vida do pipe?):')
  for (const [ano, v] of [...porAno.entries()].sort()) {
    console.log(`     ${ano}: ${String(v.total).padStart(4)} cards · ${v.comProj} com valor de projeção · ${v.comData2} com data da 2ª parcela`)
  }
  console.log('')

  console.log('3) Fase atual dos cards da amostra:')
  for (const [k, v] of [...porFase.entries()].sort((a, b) => b[1] - a[1])) console.log(`     ${String(v).padStart(5)}×  ${k}`)
  console.log('')

  console.log(`4) Campos de projeção fora da fase "Aguardando pagamento":`)
  console.log(`     ${cardsNaFase} cards na fase, somando R$ ${brl(somaProjNaFase)}`)
  console.log(`     ${comProjNaoNaFase.length ? 'há' : 'não há'} cards com valor de projeção preenchido JÁ FORA da fase (o campo fica no card depois que ele sai):`)
  for (const c of comProjNaoNaFase) console.log(`       #${c.id} R$ ${brl(c.v)} · agora em "${c.fase}" · pago? ${c.pago ?? '—'}`)
  console.log('')

  imprimeContagem('5) Produto contratado (a "categoria" deste pipe):', porProduto, total)
  imprimeContagem('6) Departamento (já normalizado):', porDepto, total)

  console.log('7) 2ª parcela da venda (é projeção futura também?):')
  console.log(`     "Sim": ${segundaParcela.sim}  ·  desses, ${segundaParcela.simComValor} com valor e ${segundaParcela.simComData} com data`)
  console.log(`     "Não": ${segundaParcela.nao}`)
  console.log('')

  console.log('8) Preenchimento dos campos mapeados (de ' + total + ' cards):')
  for (const [nome, id] of Object.entries(CAMPOS)) {
    const n = preenchido.get(id) ?? 0
    console.log(`     ${String(n).padStart(5)}×  ${nome.padEnd(20)} ${id}`)
  }
}

async function main() {
  if (FASE) return fase()
  if (SCAN) return scan()
  console.log('probe-negociacao: escolha um modo.\n')
  console.log('  --fase        os cards parados em "Aguardando pagamento" (a projeção), crus')
  console.log('  --scan [N]    varre N páginas de 30 cards e mede os riscos de schema')
  console.log('\nPara a lista de campos/fases do pipe, use o probe irmão:')
  console.log(`  node scripts/probe-financeiro-fields.mjs ${PIPE_ID}`)
}

main().catch((e) => {
  console.error('probe-negociacao: erro\n' + e.message)
  process.exit(1)
})
