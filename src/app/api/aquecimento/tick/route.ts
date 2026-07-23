import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { runWarmupTick } from '@/lib/warmup/tick'

// Endpoint do "tick" do aquecimento, chamado pelo cron externo (GitHub Actions —
// ver .github/workflows/aquecimento-tick.yml) já que Cloudflare Pages não tem
// Cron Triggers. Protegido por header secreto; roda sem sessão de usuário e
// escreve via service_role. Ver plano seção 3.
export const dynamic = 'force-dynamic'

function secretOk(req: NextRequest): boolean {
  const expected = process.env.WARMUP_CRON_SECRET
  if (!expected) return false
  const got = req.headers.get('x-warmup-cron-secret') ?? ''
  // Comparação de tempo (quase) constante para não vazar o tamanho via timing.
  if (got.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i)
  return diff === 0
}

export async function POST(req: NextRequest) {
  if (!secretOk(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  try {
    const summary = await runWarmupTick(createServiceClient())
    return NextResponse.json(summary)
  } catch (e) {
    return NextResponse.json(
      { error: 'tick failed', detail: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    )
  }
}
