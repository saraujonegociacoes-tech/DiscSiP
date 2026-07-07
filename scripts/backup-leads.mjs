#!/usr/bin/env node
// ============================================================================
// Backup LÓGICO do domínio de leads (S5.2) — enquanto no plano Free do Supabase.
// ============================================================================
// Exporta as tabelas de leads para JSON timestampado, via PostgREST + service role
// (read-only). Sem dependências (usa fetch nativo do Node 18+). Idempotente e seguro:
// só LÊ. NÃO substitui um pg_dump físico, mas cobre o essencial (recuperar os dados)
// sem precisar da senha do Postgres.
//
// USO:
//   node scripts/backup-leads.mjs                # exporta tudo p/ ./backups/leads-<ts>/
//   BACKUP_LIMIT=5 node scripts/backup-leads.mjs # só 5 linhas/tabela (teste rápido)
//   BACKUP_OUT_DIR=D:/dumps node scripts/backup-leads.mjs
//
// Credenciais: lê NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY do .env.local
// (ou do ambiente, p/ cron/CI). A service role NUNCA é escrita no output.
//
// AGENDAR (opções, decisão do dono):
//   • Make: um cenário "schedule" diário chamando este script num runner, ou replicando
//     a lógica (GET /rest/v1/<tabela>) e gravando no storage.
//   • Cloudflare R2: depois de gerar a pasta, subir com a S3 API ou:
//       wrangler r2 object put <bucket>/leads-<ts>/leads.json --file=backups/leads-<ts>/leads.json
//   • Quando virar dependência diária: migrar p/ Supabase Pro (backup gerenciado + PITR)
//     e aposentar este script.
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'

const envPath = path.resolve(process.cwd(), '.env.local')
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2]
  }
}

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) {
  console.error('Faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (no .env.local ou no ambiente).')
  process.exit(1)
}

const H = { apikey: KEY, Authorization: `Bearer ${KEY}` }
const OUT_DIR = process.env.BACKUP_OUT_DIR || path.resolve(process.cwd(), 'backups')
const LIMIT = Number(process.env.BACKUP_LIMIT || 0) // 0 = tudo
const PAGE = 1000
const TABLES = ['lead_phases', 'lead_agents', 'leads', 'lead_events']

async function fetchAll(table) {
  const out = []
  for (let from = 0; ; from += PAGE) {
    const res = await fetch(`${URL}/rest/v1/${table}?select=*`, {
      headers: { ...H, Range: `${from}-${from + PAGE - 1}`, Prefer: 'count=exact' },
    })
    if (!res.ok) throw new Error(`${table}: HTTP ${res.status} ${await res.text()}`)
    const rows = await res.json()
    out.push(...rows)
    const total = Number((res.headers.get('content-range') || '').split('/')[1] || out.length)
    if (LIMIT && out.length >= LIMIT) return out.slice(0, LIMIT)
    if (rows.length === 0 || out.length >= total) return out
  }
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const dir = path.join(OUT_DIR, `leads-${stamp}`)
fs.mkdirSync(dir, { recursive: true })

const manifest = { created_at: new Date().toISOString(), supabase_url: URL, limit: LIMIT || null, tables: {} }
console.log(`Backup do domínio de leads → ${dir}`)
for (const t of TABLES) {
  const rows = await fetchAll(t)
  fs.writeFileSync(path.join(dir, `${t}.json`), JSON.stringify(rows))
  manifest.tables[t] = rows.length
  console.log(`  ${t}: ${rows.length} linhas`)
}
fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2))
console.log(`\n✅ Backup concluído em ${dir}`)
