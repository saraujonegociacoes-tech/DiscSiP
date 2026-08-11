// verify-cs-pagamento.mjs — checagem READ-ONLY da Página 4 depois da migration 20260730b +
// query do Make/backfill com child_relations. Não imprime PII (nome/CPF/raw): só contagens e
// colunas operacionais. Usa a service_role (mesmo .env.local do import) só pra ler.
//
// Rodar: node scripts/verify-cs-pagamento.mjs
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
    /* usa só process.env */
  }
  return env
}

const env = loadEnv()
const URL_BASE = env.NEXT_PUBLIC_SUPABASE_URL
const KEY = env.SUPABASE_SERVICE_ROLE_KEY
if (!URL_BASE || !KEY) {
  console.error('verify: falta NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no .env.local')
  process.exit(1)
}

const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }

async function rest(path, extraHeaders = {}) {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, { headers: { ...H, ...extraHeaders } })
  const body = await res.text()
  return { res, body }
}
async function rpc(name, args = {}) {
  const res = await fetch(`${URL_BASE}/rest/v1/rpc/${name}`, { method: 'POST', headers: H, body: JSON.stringify(args) })
  const text = await res.text()
  if (!res.ok) throw new Error(`${res.status} ${text}`)
  return JSON.parse(text)
}

async function main() {
  console.log('== cs_card_payments ==')
  // Contagem exata via header content-range.
  const { res: cr } = await rest('cs_card_payments?select=id', { Prefer: 'count=exact', Range: '0-0' })
  const total = cr.headers.get('content-range')?.split('/')?.[1] ?? '?'
  console.log(`total de pagamentos ingeridos: ${total}`)

  // Amostra sem PII.
  const { body } = await rest(
    'cs_card_payments?select=sc_pipefy_card_id,payment_pipefy_card_id,parcela_num,valor_pago,data_pagamento,forma,total_parcelas,a_vista_ou_parcelado&order=ingested_at.desc&limit=5',
  )
  const rows = JSON.parse(body)
  for (const r of rows) {
    console.log(
      `  SC ${r.sc_pipefy_card_id} · pgto ${r.payment_pipefy_card_id} · parcela ${r.parcela_num} · ` +
        `R$ ${r.valor_pago} · ${r.data_pagamento} · ${r.forma ?? '—'} · ${r.a_vista_ou_parcelado ?? '—'} (${r.total_parcelas ?? '—'}x)`,
    )
  }

  console.log('\n== RPC get_cs_pagamento_projecao() ==')
  try {
    const proj = await rpc('get_cs_pagamento_projecao')
    const cards = proj?.cards ?? []
    console.log(`cards em pagamento: ${cards.length}`)

    // Regra da 20260811: projeção SÓ de card na fase "Aguardando Pagamento"; o realizado
    // conta em qualquer fase. Quem está fora da fase tem que vir com `plano: []` — se vier
    // com plano, a migration não foi aplicada (ou a 20260730b foi reexecutada por cima).
    const naFase = cards.filter((x) => x.naFase === true).length
    const foraComPlano = cards.filter((x) => x.naFase !== true && (x.plano ?? []).length > 0)
    console.log(`  na fase: ${naFase} · fora da fase (só realizado): ${cards.length - naFase}`)
    if (cards.length > 0 && naFase === 0 && cards.every((x) => x.naFase === undefined)) {
      console.log('  ⚠ nenhum card traz `naFase` — a migration 20260811 não foi aplicada.')
    } else if (foraComPlano.length > 0) {
      console.log(`  ⚠ ${foraComPlano.length} card(s) FORA da fase ainda com plano — projeção vazando.`)
    } else {
      console.log('  ✓ nenhuma projeção de card fora da fase.')
    }

    const c = cards[0]
    if (c) {
      console.log(
        `  1º card ${c.pipefyCardId} · forma ${c.forma ?? '—'} · ${c.active ? 'ativo' : 'inativo'}` +
          ` · ${c.naFase ? 'na fase' : 'fora da fase'}`,
      )
      console.log(`    plano (previsto): ${JSON.stringify(c.plano)}`)
      console.log(`    pagamentos (real): ${JSON.stringify((c.pagamentos ?? []).map((p) => ({ n: p.parcelaNum, v: p.valorPago, d: p.dataPagamento })))}`)
    }
  } catch (e) {
    console.log(`  (RPC indisponível via service_role: ${e.message})`)
  }

  console.log('\n== RPC get_cs_pagamento_historico(90d) ==')
  try {
    const start = new Date(Date.now() - 90 * 86400000).toISOString()
    const end = new Date(Date.now() + 2 * 86400000).toISOString()
    const hist = await rpc('get_cs_pagamento_historico', { p_start: start, p_end: end })
    console.log(`  pagamentos no período: ${hist?.count ?? 0} · total: R$ ${hist?.totalRecebido ?? 0}`)
  } catch (e) {
    console.log(`  (RPC indisponível via service_role: ${e.message})`)
  }
}

main().catch((e) => {
  console.error('verify: erro', e.message)
  process.exit(1)
})
