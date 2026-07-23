import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

// Callback do Make com o resultado real do envio à Graph API. Fecha o loop:
// marca em warmup_messages se a Meta aceitou (graph_message_id) ou falhou, e
// bloqueia o número quando a Meta reporta que ele está indisponível. Ver plano
// seção 6.2, passos 4-5.
export const dynamic = 'force-dynamic'

// Códigos da Graph API que indicam que o número REMETENTE está inutilizável
// (bloqueado/removido) — não um problema transitório de janela/rate.
const BLOCKING_ERROR_CODES = new Set([131026, 131031, 368])

function secretOk(req: NextRequest): boolean {
  const expected = process.env.MAKE_CALLBACK_SECRET
  if (!expected) return false
  const got = req.headers.get('x-warmup-callback-secret') ?? ''
  if (got.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i)
  return diff === 0
}

interface CallbackBody {
  message_log_id?: string
  ok?: boolean
  graph_message_id?: string | null
  error_code?: number | null
  error_detail?: string | null
}

export async function POST(req: NextRequest) {
  if (!secretOk(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: CallbackBody
  try {
    body = (await req.json()) as CallbackBody
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  if (!body.message_log_id) {
    return NextResponse.json({ error: 'message_log_id obrigatório' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const detail =
    body.error_detail ?? (body.error_code != null ? `Meta error ${body.error_code}` : null)

  const { data: updated, error } = await supabase
    .from('warmup_messages')
    .update({
      make_dispatch_ok: body.ok ?? false,
      graph_message_id: body.graph_message_id ?? null,
      error_detail: body.ok ? null : detail,
    })
    .eq('id', body.message_log_id)
    .select('from_number_id')
    .single()

  if (error || !updated) {
    return NextResponse.json({ error: 'message_log_id não encontrado' }, { status: 404 })
  }

  // Número remetente reportado como indisponível → bloqueia (sai do pool ativo).
  if (!body.ok && body.error_code != null && BLOCKING_ERROR_CODES.has(body.error_code)) {
    await supabase
      .from('warmup_numbers')
      .update({ status: 'blocked', updated_at: new Date().toISOString() })
      .eq('id', updated.from_number_id)
  }

  return NextResponse.json({ ok: true })
}
