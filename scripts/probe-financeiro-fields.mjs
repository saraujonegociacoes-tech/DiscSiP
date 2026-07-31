// PROBE (read-only) — introspecção do pipe do FINANCEIRO no Pipefy.
//
// Mesma coisa que as queries de docs/projetopainelceo-docs/updates/introspeccao-pipefy-financeiro.md,
// só que rodando aqui e imprimindo um resumo compacto (em vez do JSON gigante do playground).
// Não toca em Supabase, migration nem no app — só lê a GraphQL do Pipefy.
//
// Responde o que bloqueia o Sprint 1 (Financeiro):
//   (a) qual é o pipe ID  → env FINANCEIRO_PIPEFY_PIPE_ID
//   (b) quais os field-ids de VALOR / DATA / CATEGORIA → mapeamento dentro de ingest_financeiro_card
//   (c) em que FORMATO esses valores voltam → define fin_parse_money / fin_parse_date
//
// Rodar:
//   node scripts/probe-financeiro-fields.mjs            (usa FINANCEIRO_PIPEFY_PIPE_ID do .env.local)
//   node scripts/probe-financeiro-fields.mjs <pipeId>   (pipe avulso, sem precisar da env)
//   node scripts/probe-financeiro-fields.mjs --pipes    (só lista os pipes da org, pra achar o ID)
//   node scripts/probe-financeiro-fields.mjs <pipeId> --scan [N]
//        varre N páginas de 30 cards e mede o que decide o SCHEMA (não o mapeamento):
//        duplicidade de pagamento, cards com várias parcelas no mesmo card, e qual campo de
//        "referência" está preenchido por departamento. Ver CAMPOS abaixo.
//
// Requer no .env.local: PIPEFY_TOKEN. Sem o pipe ID, ele cai no modo --pipes sozinho.
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
const ONLY_PIPES = args.includes('--pipes')
const SCAN = args.includes('--scan')
const positional = args.filter((a) => !a.startsWith('-'))
const PIPE_ID = positional[0] || env.FINANCEIRO_PIPEFY_PIPE_ID || null
const SCAN_PAGES = Number(positional[1] || 5)
const SAMPLE_SIZE = Number(env.FINANCEIRO_PROBE_SAMPLE || 5)

// Field-ids do pipe "2.0 - Financeiro" (304386356), confirmados por introspecção em 31/jul/2026.
// Só o modo --scan usa isto; o resto do script é agnóstico de pipe.
const CAMPOS = {
  valorPago: 'valor_de_contrata_o', // "Valor que o Cliente Pagou?"
  valorCobrado: 'valor_total_da_cobran_a',
  valorLiquido: 'copy_of_valor_do_pagamento_bruto', // label diz "Líquido" (o id é herança de um copy_of)
  data: 'data_do_pagamento',
  pagamentoId: 'n_mera_o_do_pagamento_id',
  departamento: 'informe_o_seu_departamento',
  // A categoria real: qual destes está preenchido depende do departamento.
  referencia: ['refer_ncia_do_pagamento', 'refer_ncia_do_pagamento_juridico', 'copy_of_refer_ncia_do_pagamento_juridico'],
  // Convenção ANTIGA (cards de 2024/2025): o card guarda até 4 pagamentos, cada um com valor e
  // data próprios. 1 campo preenchido ≈ repetição do valor pago; 2+ = o card é MAIS DE UMA entrada,
  // possivelmente em meses diferentes. Cards de 2026 não usam nada disto (1 card = 1 parcela).
  parcelas: [
    'informe_o_valor_pago_referente_a_1_parcela',
    'informe_o_valor_pago_referente_a_2_parcela',
    'informe_o_valor_pago_referente_a_3_parcela',
    'copy_of_informe_o_valor_pago_referente_a_4_parcela',
  ],
  parcelasData: [
    'informe_a_data_do_pagamento_da_1_parcela',
    'informe_a_data_do_pagamento_da_2_parcela',
    'informe_a_data_do_pagamento_da_3_parcela',
    'copy_of_informe_a_data_do_pagamento_da_3_parcela', // id herdado de um copy_of; é a 4ª
  ],
}

// Sinal por categoria (decisão do dono, 31/jul): desconto/devolução saem do caixa; distrato e
// reversão são entradas normais. Categoria nova nasce positiva — é preciso vir aqui pra virar
// negativa, o que é o default seguro.
const CATEGORIAS_NEGATIVAS = /desconto|devolu/i
const sinal = (cat) => (CATEGORIAS_NEGATIVAS.test(cat ?? '') ? -1 : 1)

// "Departamento - Jurídico" é o nome ANTIGO de "Departamento - Negociação" (dono, 31/jul) — por
// isso os dois usam o mesmo campo de referência. A ingestão normaliza pra não virar duas fatias
// do mesmo departamento no gráfico.
const DEPT_ALIAS = { 'Departamento - Jurídico': 'Departamento - Negociação' }
const normDept = (d) => DEPT_ALIAS[d] ?? d ?? '(sem departamento)'

if (!PIPEFY_TOKEN) {
  console.error('probe-financeiro: falta PIPEFY_TOKEN no .env.local')
  process.exit(1)
}

const PIPEFY_URL = 'https://api.pipefy.com/graphql'

const FIELD = 'id label type required options'

// Query cheia. Se a conta/versão da API não tiver algum desses campos (cards_count, options,
// labels), o Pipefy derruba a query INTEIRA — por isso existe a MIN como plano B.
const Q_PIPE = `
query IntrospeccaoPipe($pipeId: ID!) {
  pipe(id: $pipeId) {
    id
    name
    start_form_fields { ${FIELD} }
    phases { id name cards_count fields { ${FIELD} } }
    labels { id name }
  }
}`

const Q_PIPE_MIN = `
query IntrospeccaoPipeMin($pipeId: ID!) {
  pipe(id: $pipeId) {
    id
    name
    start_form_fields { id label type }
    phases { id name fields { id label type } }
  }
}`

const Q_SAMPLE = `
query AmostraCards($pipeId: ID!, $size: Int!, $cursor: String) {
  allCards(pipeId: $pipeId, first: $size, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    edges { node {
      id title created_at
      current_phase { id name }
      fields { name value array_value datetime_value field { id type } }
    } }
  }
}`

const Q_PIPES = `
query MeusPipes {
  organizations { id name pipes { id name } }
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

// ── heurística: quem é candidato a valor / data / categoria ────────────────────
const MONEY_TYPES = new Set(['currency', 'number'])
const DATE_TYPES = new Set(['date', 'datetime', 'due_date'])
const CAT_TYPES = new Set(['select', 'radio_vertical', 'radio_horizontal', 'label_select', 'checklist_vertical', 'checklist_horizontal'])

const RX_MONEY = /valor|preç|preco|total|receita|entrada|montante|r\$/i
const RX_DATE = /data|dia|venc|receb|pagam|compet/i
const RX_CAT = /categ|tipo|origem|classif|natureza|centro/i

function scoreField(f, types, rx) {
  let s = 0
  if (types.has(f.type)) s += 2
  if (rx.test(f.label ?? '') || rx.test(f.id ?? '')) s += 1
  return s
}

function pickBest(fields, types, rx) {
  return fields
    .map((f) => ({ f, s: scoreField(f, types, rx) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 3)
    .map((x) => x.f)
}

function fmtField(f, indent = '   ') {
  const req = f.required ? ' [obrigatório]' : ''
  const opts = f.options?.length ? `  opções: ${f.options.join(' | ')}` : ''
  return `${indent}${(f.id ?? '?').padEnd(38)} ${(f.type ?? '?').padEnd(18)} "${f.label ?? ''}"${req}${opts}`
}

function fmtValue(f) {
  if (f.value != null && f.value !== '') return f.value
  if (f.datetime_value) return f.datetime_value
  if (Array.isArray(f.array_value) && f.array_value.length) return JSON.stringify(f.array_value)
  return null
}

// Pra date/currency o resumo não basta: o parser precisa saber se o ISO existe em
// datetime_value ou se só há o value localizado ("14/07/2026"). Aqui imprimimos os três crus.
const RAW_TYPES = new Set(['date', 'datetime', 'due_date', 'currency', 'number'])

function fmtRaw(f) {
  return `value=${JSON.stringify(f.value)} datetime_value=${JSON.stringify(f.datetime_value)} array_value=${JSON.stringify(f.array_value)}`
}

function get(card, id) {
  const f = (card.fields ?? []).find((x) => x.field?.id === id)
  return f ? fmtValue(f) : null
}

async function listPipes() {
  const data = await gql(Q_PIPES, {})
  console.log('Pipes visíveis pro seu token:\n')
  for (const org of data.organizations ?? []) {
    console.log(`  ORG ${org.id} — ${org.name}`)
    for (const p of org.pipes ?? []) console.log(`    ${String(p.id).padEnd(12)} ${p.name}`)
    console.log('')
  }
  console.log('Ache o pipe do Financeiro na lista e rode de novo com o ID:')
  console.log('  node scripts/probe-financeiro-fields.mjs <pipeId>')
}

// ── modo --scan: mede riscos de SCHEMA sobre uma amostra grande ───────────────
// Perguntas que a amostra de 5 cards não responde e que mudam o schema/a soma:
//   1. o mesmo pagamento entra como mais de um card? (e quando é duplicata de verdade?)
//   2. um card carrega mais de uma entrada? (aí fin_cards precisa de tabela-filha)
//   3. que categorias existem — e quais delas são SAÍDA de dinheiro em vez de entrada?
async function scan() {
  console.log(`probe-financeiro: varrendo até ${SCAN_PAGES} páginas de 30 cards do pipe ${PIPE_ID}…\n`)
  let cursor = null
  let pages = 0
  let total = 0
  const porContrato = new Map() // contract_ref -> [{id, valor, dep, data, cat}]
  const histParcelas = [0, 0, 0, 0, 0] // quantos cards têm 0,1,2,3,4 campos de parcela preenchidos
  const multiParcela = []
  const porAno = new Map() // ano de criação -> { com, sem } campos de parcela
  const semData = []
  const semValor = []
  const refPorDep = new Map()
  const porCategoria = new Map() // categoria -> { n, soma }
  const formatosData = new Set()

  const money = (s) => {
    if (!s) return null
    const n = Number(String(s).replace(/\./g, '').replace(',', '.').replace(/[^0-9.\-]/g, ''))
    return Number.isFinite(n) ? n : null
  }

  do {
    const conn = (await gql(Q_SAMPLE, { pipeId: PIPE_ID, size: 30, cursor })).allCards
    pages++
    for (const { node } of conn.edges) {
      total++
      const pid = get(node, CAMPOS.pagamentoId)
      const valor = get(node, CAMPOS.valorPago)
      const data = get(node, CAMPOS.data)
      const dep = normDept(get(node, CAMPOS.departamento))
      // A categoria real = COALESCE dos três campos de referência, na ordem.
      const cat = CAMPOS.referencia.map((r) => get(node, r)).find(Boolean) ?? '(sem categoria)'

      if (pid) {
        if (!porContrato.has(pid)) porContrato.set(pid, [])
        porContrato.get(pid).push({ id: node.id, valor, dep, data, cat, fase: node.current_phase?.name })
      }
      if (!data) semData.push(node.id)
      else formatosData.add(data.replace(/\d/g, '9'))
      if (!valor) semValor.push(node.id)

      const parcelasPreenchidas = CAMPOS.parcelas.filter((p) => get(node, p))
      histParcelas[parcelasPreenchidas.length]++
      const ano = String(node.created_at ?? '').slice(0, 4) || '?'
      const anoAcc = porAno.get(ano) ?? { com: 0, sem: 0 }
      if (parcelasPreenchidas.length) anoAcc.com++
      else anoAcc.sem++
      porAno.set(ano, anoAcc)
      if (parcelasPreenchidas.length > 1) {
        multiParcela.push({
          id: node.id,
          criado: String(node.created_at ?? '').slice(0, 10),
          pago: valor,
          linhas: CAMPOS.parcelas
            .map((p, i) => [i + 1, get(node, p), get(node, CAMPOS.parcelasData[i])])
            .filter(([, v]) => v),
        })
      }

      const chave = `${dep}  →  ${CAMPOS.referencia.filter((r) => get(node, r)).join(' + ') || '(nenhuma)'}`
      refPorDep.set(chave, (refPorDep.get(chave) ?? 0) + 1)

      const acc = porCategoria.get(cat) ?? { n: 0, soma: 0 }
      acc.n++
      acc.soma += money(valor) ?? 0
      porCategoria.set(cat, acc)
    }
    cursor = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null
  } while (cursor && pages < SCAN_PAGES)

  console.log(`── Varredura: ${total} cards em ${pages} páginas ──\n`)

  // 1) Duplicidade: o mesmo contrato repetindo NÃO é por si só duplicata (pode ser parcela, ou
  // um pagamento + um desconto). O sinal forte é: mesmo valor E mesma categoria E mesmo dia.
  const grupos = [...porContrato.entries()].filter(([, v]) => v.length > 1)
  const forte = []
  const provavelParcela = []
  const catsDiferentes = []
  for (const [pid, cards] of grupos) {
    const cats = new Set(cards.map((c) => c.cat))
    const vals = new Set(cards.map((c) => c.valor))
    const dias = new Set(cards.map((c) => c.data))
    if (cats.size === 1 && vals.size === 1 && dias.size === 1) forte.push([pid, cards])
    else if (cats.size > 1) catsDiferentes.push([pid, cards])
    else provavelParcela.push([pid, cards])
  }

  console.log(`1) Contratos ("${CAMPOS.pagamentoId}") com mais de um card: ${grupos.length}`)
  console.log(`     ${forte.length}  suspeita FORTE de duplicata (mesmo valor + mesma categoria + mesmo dia)`)
  console.log(`     ${provavelParcela.length}  mesma categoria, valor/dia diferentes → parcelas ou pagamentos distintos`)
  console.log(`     ${catsDiferentes.length}  categorias diferentes → entradas legítimas distintas`)
  for (const [pid, cards] of forte.slice(0, 5)) {
    console.log(`   ⚠ ${pid}: ${cards.map((c) => `#${c.id} ${c.valor} · ${c.cat} · ${c.dep} · ${c.data}`).join('  |  ')}`)
  }
  for (const [pid, cards] of catsDiferentes.slice(0, 3)) {
    console.log(`   ok ${pid}: ${cards.map((c) => `#${c.id} ${c.valor} · ${c.cat}`).join('  |  ')}`)
  }
  console.log('')

  console.log('2) Campos de parcela preenchidos por card (2+ = o card é mais de uma entrada):')
  histParcelas.forEach((n, i) => console.log(`     ${i} campo(s): ${String(n).padStart(4)} cards`))
  console.log(`   por ano de criação (a convenção mudou no meio de 2025):`)
  for (const [ano, v] of [...porAno.entries()].sort()) console.log(`     ${ano}: ${v.com} com parcela / ${v.sem} sem`)
  for (const m of multiParcela.slice(0, 3)) {
    console.log(`   #${m.id} criado ${m.criado} | valor pago no card = ${m.pago}`)
    for (const [n, v, d] of m.linhas) console.log(`       ${n}ª parcela: ${v}   em ${d ?? '(sem data)'}`)
  }
  console.log('')

  console.log('3) Categorias (COALESCE das 3 referências) — soma do valor pago, já com sinal:')
  for (const [k, v] of [...porCategoria.entries()].sort((a, b) => b[1].n - a[1].n)) {
    const s = sinal(k) < 0 ? '  ← NEGATIVA' : ''
    const soma = v.soma * sinal(k)
    console.log(`     ${String(v.n).padStart(4)}×  ${k.padEnd(34)} R$ ${soma.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}${s}`)
  }
  console.log('')

  console.log('4) Qual "referência" está preenchida, por departamento (já normalizado):')
  for (const [k, v] of [...refPorDep.entries()].sort((a, b) => b[1] - a[1])) console.log(`     ${String(v).padStart(4)}×  ${k}`)
  console.log('')

  console.log(`5) Higiene: ${semData.length} sem data, ${semValor.length} sem valor pago.`)
  console.log(`   formatos de data vistos (dígito→9): ${[...formatosData].join(' , ') || '(nenhum)'}`)
}

async function main() {
  if (SCAN && PIPE_ID) return scan()
  if (ONLY_PIPES || !PIPE_ID) {
    if (!ONLY_PIPES) console.log('probe-financeiro: sem FINANCEIRO_PIPEFY_PIPE_ID — listando os pipes da org.\n')
    return listPipes()
  }

  let pipe
  try {
    pipe = (await gql(Q_PIPE, { pipeId: PIPE_ID })).pipe
  } catch (e) {
    console.warn('probe-financeiro: query cheia falhou, tentando a mínima…\n' + e.message + '\n')
    pipe = (await gql(Q_PIPE_MIN, { pipeId: PIPE_ID })).pipe
  }
  if (!pipe) {
    console.error(`probe-financeiro: pipe ${PIPE_ID} não encontrado (ou o token não enxerga).`)
    process.exit(1)
  }

  console.log('════════════════════════════════════════════════════════════════')
  console.log(`PIPE ${pipe.id} — "${pipe.name}"     →  FINANCEIRO_PIPEFY_PIPE_ID=${pipe.id}`)
  console.log('════════════════════════════════════════════════════════════════\n')

  const all = []

  const start = pipe.start_form_fields ?? []
  console.log(`── Start form (${start.length} campos) ──`)
  for (const f of start) {
    console.log(fmtField(f))
    all.push(f)
  }
  if (!start.length) console.log('   (vazio)')
  console.log('')

  for (const ph of pipe.phases ?? []) {
    const count = ph.cards_count != null ? ` · ${ph.cards_count} cards` : ''
    console.log(`── Fase "${ph.name}" (id ${ph.id})${count} — ${(ph.fields ?? []).length} campos ──`)
    for (const f of ph.fields ?? []) {
      console.log(fmtField(f))
      all.push(f)
    }
    if (!(ph.fields ?? []).length) console.log('   (sem campos próprios)')
    console.log('')
  }

  if (pipe.labels?.length) {
    console.log('── Labels do pipe ──')
    for (const l of pipe.labels) console.log(`   ${String(l.id).padEnd(12)} ${l.name}`)
    console.log('')
  }

  // Dedup por id: o mesmo campo pode aparecer em mais de uma fase.
  const uniq = [...new Map(all.map((f) => [f.id, f])).values()]
  console.log('── Candidatos (heurística — CONFIRME olhando a amostra abaixo) ──')
  for (const [rotulo, types, rx] of [
    ['valor    ', MONEY_TYPES, RX_MONEY],
    ['data     ', DATE_TYPES, RX_DATE],
    ['categoria', CAT_TYPES, RX_CAT],
  ]) {
    const hits = pickBest(uniq, types, rx)
    if (!hits.length) console.log(`   ${rotulo} → (nenhum campo bate — provavelmente o campo tem outro tipo)`)
    for (const f of hits) console.log(`   ${rotulo} → ${(f.id ?? '?').padEnd(38)} ${(f.type ?? '?').padEnd(18)} "${f.label ?? ''}"`)
  }
  console.log('')

  // Amostra: é ela que trava o FORMATO (money "R$ 1.200,00" vs "1200.0"; data ISO vs BR).
  console.log(`── Amostra de ${SAMPLE_SIZE} cards (valores reais — define fin_parse_money/fin_parse_date) ──`)
  let sample
  try {
    sample = (await gql(Q_SAMPLE, { pipeId: PIPE_ID, size: SAMPLE_SIZE })).allCards
  } catch (e) {
    console.warn('   (amostra falhou: ' + e.message + ')')
    return
  }
  const nodes = (sample.edges ?? []).map((e) => e.node)
  if (!nodes.length) console.log('   (pipe sem cards ainda — crie 1 card de teste e rode de novo)')
  for (const n of nodes) {
    console.log(`\n   CARD #${n.id} — ${n.title ?? '(sem título)'}   [fase: ${n.current_phase?.name ?? '—'}]`)
    console.log(`     created_at = ${n.created_at}`)
    for (const f of n.fields ?? []) {
      const v = fmtValue(f)
      if (v == null) continue
      const id = (f.field?.id ?? '?').padEnd(38)
      if (RAW_TYPES.has(f.field?.type)) {
        console.log(`     ${id} → ${fmtRaw(f)}   (${f.field?.type} · ${f.name})`)
      } else {
        console.log(`     ${id} = ${v}   (${f.field?.type ?? '?'} · ${f.name})`)
      }
    }
  }
  console.log('\nCole a saída inteira de volta no chat — com ela o Sprint 1 destrava.')
}

main().catch((e) => {
  console.error('probe-financeiro: erro\n' + e.message)
  process.exit(1)
})
