// Carga única das Minutas Processuais (área Jurídico) a partir de uma PLANILHA (CSV).
// Diferente dos outros importadores (que paginam o Pipefy), este lê um CSV exportado da
// planilha do dono e manda cada ACORDO (já agrupado) pra RPC proc_ingest_acordo
// (migration 20260731b_minutas_processuais.sql). Idempotente: re-rodar é seguro (upsert do
// acordo por número de processo + parcelas por (acordo, num)).
//
// A planilha atual tem: Título, Fase atual, Data de Vencimento, Valor da Conta, Observações
// ("Parcela 02/03"). O dono vai adicionar Nome da Cliente e Número do processo. O script casa
// as colunas por NOME (tolerante a acento/caixa), então a ordem não importa e colunas extras
// são ignoradas.
//
// ⚠️ DATAS: o exemplo do dono ("1/22/2026") está em formato AMERICANO M/D/YYYY. O parser
// detecta o formato (se um componente > 12, deduz a ordem) e, no caso ambíguo, usa
// MINUTAS_DATE_ORDER (default 'MDY'). Sempre grava ISO.
//
// Rodar:  node scripts/import-minutas.mjs [caminho/da/planilha.csv]   (ou: npm run import:minutas)
//         (default do caminho: ./minutas.csv na raiz do repo)
// Requer no .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   (opcional) MINUTAS_DATE_ORDER = 'MDY' (default) | 'DMY'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
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
const DATE_ORDER = (env.MINUTAS_DATE_ORDER || 'MDY').toUpperCase() === 'DMY' ? 'DMY' : 'MDY'

// --dry-run: parseia e mostra uma amostra, sem gravar nada (não precisa de service_role).
const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run') || env.MINUTAS_DRY_RUN === '1'
const pathArg = args.find((a) => !a.startsWith('--'))
const CSV_PATH = resolve(pathArg || join(root, 'minutas.csv'))

if (!DRY_RUN) {
  for (const [k, v] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY })) {
    if (!v) {
      console.error(`import-minutas: falta ${k} no .env.local`)
      process.exit(1)
    }
  }
}

// ── CSV parsing (sem dependência) ────────────────────────────────────────────
// Suporta aspas com vírgula/;/quebra de linha embutidas e "" como escape.
function parseCsv(text, delim) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ }
        else inQuotes = false
      } else field += c
    } else if (c === '"') {
      inQuotes = true
    } else if (c === delim) {
      row.push(field); field = ''
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = ''
    } else if (c === '\r') {
      /* ignora */
    } else field += c
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row) }
  return rows.filter((r) => r.some((x) => x.trim() !== ''))
}

const norm = (s) =>
  (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()

// Lê o arquivo como array-de-arrays. .xlsx/.xls via a lib `xlsx` (já é dependência); o resto
// como CSV. Assim o dono pode passar a planilha direto, sem exportar pra CSV.
async function readRows(path) {
  if (/\.xlsx?$/i.test(path)) {
    const { default: XLSX } = await import('xlsx')
    const wb = XLSX.readFile(path)
    const ws = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' })
    return rows.map((r) => r.map((c) => String(c ?? '')))
  }
  const text = readFileSync(path, 'utf8').replace(/^﻿/, '')
  const firstLine = text.split(/\r?\n/)[0] || ''
  const delim = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ','
  return parseCsv(text, delim)
}

// Acha o índice da 1ª coluna cujo cabeçalho normalizado bate com algum candidato.
function colFinder(headers) {
  const H = headers.map(norm)
  return (...cands) => {
    for (const c of cands.map(norm)) {
      const i = H.findIndex((h) => h === c || h.includes(c))
      if (i !== -1) return i
    }
    return -1
  }
}

// ── Normalizadores de valor ──────────────────────────────────────────────────
function parseMoney(raw) {
  if (raw == null) return null
  let s = String(raw).trim()
  if (!s) return null
  if (/,[0-9]{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.') // br "1.234,56"
  s = s.replace(/[^0-9.\-]/g, '')
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

// Retorna ISO 'YYYY-MM-DD' ou null. Detecta M/D vs D/M; usa DATE_ORDER no caso ambíguo.
function parseDate(raw) {
  if (raw == null) return null
  const s = String(raw).trim()
  if (!s) return null
  // ISO já pronto
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  // com barras (ou traços) DD/MM/YYYY ou MM/DD/YYYY
  m = s.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{2,4})/)
  if (!m) return null
  let a = Number(m[1]) // 1º componente
  let b = Number(m[2]) // 2º componente
  let y = Number(m[3])
  if (y < 100) y += 2000
  let day, month
  if (a > 12 && b <= 12) { day = a; month = b } // 1º > 12 → é dia (D/M)
  else if (b > 12 && a <= 12) { month = a; day = b } // 2º > 12 → é dia (M/D)
  else { // ambíguo: segue a ordem configurada
    if (DATE_ORDER === 'DMY') { day = a; month = b }
    else { month = a; day = b }
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

// "Parcela 02/03" → { num: 2, total: 3 }. null se não achar.
function parseParcela(obs) {
  const m = String(obs || '').match(/(\d+)\s*\/\s*(\d+)/)
  if (!m) return null
  return { num: Number(m[1]), total: Number(m[2]) }
}

// A planilha não tem coluna de cliente: o nome está no título ("Minuta Acordo - Fulano").
// Tira o prefixo pra popular "Nome da Cliente". Se não houver prefixo, devolve ''.
function clienteFromTitulo(titulo) {
  const t = String(titulo || '').trim()
  const m = t.match(/^minuta\s*(?:de\s*)?acordo\s*[-–—:]\s*(.+)$/i)
  return m ? m[1].trim() : ''
}

// "Pago"/"Pago - Gerar Novo Card"/"Quitado" contam como pagos; "Á Vencer" e "Pagamentos do
// Dia" (a receber) NÃO. \bpag[oa]s?\b casa pago/paga/pagos, mas não "Pagamentos".
const isPago = (fase) => /\bpag[oa]s?\b|quitad|liquidad/i.test(String(fase || ''))

async function ingest(node) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/proc_ingest_acordo`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ node }),
  })
  if (!res.ok) throw new Error(`RPC ${res.status}: ${await res.text()}`)
  return res.json()
}

async function main() {
  let rows
  try {
    rows = await readRows(CSV_PATH)
  } catch (e) {
    console.error(`import-minutas: não consegui ler a planilha em ${CSV_PATH}`)
    console.error(`  ${e?.message ?? e}`)
    console.error('  passe o caminho: node scripts/import-minutas.mjs caminho/planilha.csv|.xlsx')
    process.exit(1)
  }
  if (rows.length < 2) {
    console.error('import-minutas: planilha sem linhas de dados.')
    process.exit(1)
  }

  const headers = rows[0]
  const find = colFinder(headers)
  const col = {
    cliente: find('nome da cliente', 'cliente', 'nome do cliente', 'nome'),
    processo: find('numero do processo', 'numero processo', 'processo', 'n processo'),
    titulo: find('titulo', 'nome da minuta', 'descricao'),
    fase: find('fase atual', 'fase', 'situacao', 'status'),
    vencimento: find('data de vencimento', 'vencimento', 'data vencimento'),
    valor: find('valor da conta', 'valor do pagamento', 'valor', 'valor da minuta'),
    pagamento: find('data de pagamento', 'data do pagamento', 'data pagamento'),
    recorrencia: find('recorrencia'),
    obs: find('observacoes', 'observacao', 'obs'),
  }
  const get = (row, i) => (i >= 0 && i < row.length ? row[i].trim() : '')

  console.log(`import-minutas: ${CSV_PATH}`)
  console.log(`  ordem de data ${DATE_ORDER}, ${rows.length - 1} linha(s)`)
  console.log('  colunas mapeadas:', Object.fromEntries(Object.entries(col).map(([k, v]) => [k, v >= 0 ? headers[v] : '(ausente)'])))

  // Agrupa linhas em acordos.
  const grupos = new Map()
  let semGrupo = 0
  for (const row of rows.slice(1)) {
    const processo = get(row, col.processo)
    const titulo = get(row, col.titulo)
    const cliente = get(row, col.cliente) || clienteFromTitulo(titulo)
    const key = processo || (cliente || titulo ? `${norm(cliente)}||${norm(titulo)}` : null)
    if (!key) { semGrupo++; continue }

    const parc = parseParcela(get(row, col.obs))
    const fase = get(row, col.fase)
    const vencimento = parseDate(get(row, col.vencimento))
    const pagExplicito = parseDate(get(row, col.pagamento))
    const dataPagamento = pagExplicito || (isPago(fase) ? vencimento : null)

    const parcela = {
      num: parc?.num ?? null, // preenchido depois se null (sequencial)
      total: parc?.total ?? null,
      valor: parseMoney(get(row, col.valor)),
      vencimento,
      data_pagamento: dataPagamento,
      observacoes: get(row, col.obs) || null,
    }

    let g = grupos.get(key)
    if (!g) {
      g = { cliente: cliente || null, numero_processo: processo || null, titulo: titulo || null, recorrencia: get(row, col.recorrencia) || null, parcelas: [] }
      grupos.set(key, g)
    } else {
      g.cliente = g.cliente || cliente || null
      g.titulo = g.titulo || titulo || null
      g.recorrencia = g.recorrencia || get(row, col.recorrencia) || null
    }
    g.parcelas.push(parcela)
  }

  // Fecha cada acordo: numera parcelas sem num (sequencial por vencimento), fixa o total real
  // (maior entre nº de linhas e o "/N" declarado) e infere a recorrência.
  const nodes = []
  for (const g of grupos.values()) {
    g.parcelas.sort((a, b) => ((a.vencimento || '9999') < (b.vencimento || '9999') ? -1 : 1))
    let seq = 0
    for (const p of g.parcelas) { seq++; if (p.num == null) p.num = seq }
    const declarado = g.parcelas.reduce((m, p) => Math.max(m, p.total || 0), 0)
    g.parcela_total = Math.max(g.parcelas.length, declarado)
    if (!g.recorrencia) g.recorrencia = g.parcela_total > 1 ? 'mensal' : 'avulsa'
    nodes.push(g)
  }

  console.log(`  → ${nodes.length} acordo(s), ${nodes.reduce((n, g) => n + g.parcelas.length, 0)} parcela(s)${semGrupo ? `, ${semGrupo} linha(s) sem chave (puladas)` : ''}`)

  if (DRY_RUN) {
    console.log('\n--dry-run: NADA foi gravado. Amostra dos 5 primeiros acordos:')
    for (const g of nodes.slice(0, 5)) {
      console.log(`\n• ${g.cliente || '(sem cliente)'}  [${g.recorrencia}, total ${g.parcela_total}]  proc=${g.numero_processo || '—'}`)
      console.log(`  título: ${g.titulo || '—'}`)
      for (const p of g.parcelas)
        console.log(`    parcela ${p.num}: R$ ${p.valor ?? '—'} · venc ${p.vencimento ?? '—'} · pago ${p.data_pagamento ?? '—'}`)
    }
    return
  }

  run(nodes)
}

async function run(nodes) {
  let ok = 0, fail = 0, parcelas = 0
  const t0 = Date.now()
  const results = await Promise.allSettled(nodes.map((n) => ingest(n)))
  for (const r of results) {
    if (r.status === 'fulfilled') { ok++; parcelas += r.value?.parcelas ?? 0 }
    else { fail++; if (fail <= 5) console.error('  falha:', r.reason?.message) }
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(0)
  console.log(`\nimport-minutas: fim. acordos ok=${ok} falha=${fail}, parcelas gravadas=${parcelas}, ${secs}s.`)
  console.log('\nConferir no Supabase:')
  console.log('  SELECT count(*) FROM public.proc_acordos;')
  console.log('  SELECT count(*) FROM public.proc_parcelas;')
  if (fail > 0) process.exitCode = 1
}

main().catch((e) => {
  console.error('import-minutas: erro fatal', e)
  process.exit(1)
})
