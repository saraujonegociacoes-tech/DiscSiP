'use server'

// Contrato do webhook do aquecimento para o Make. Réplica do padrão de
// notifications.ts (sendDispositionNotification): fetch best-effort, no-op sem
// URL configurada. Variável própria (MAKE_WEBHOOK_URL_WARMUP) para não misturar
// com o cenário de disposição do discador.
//
// O Make só precisa de um Router por `message_type`: 'template' → chamada Graph
// API tipo template usando sender.sender_id no path e template.{name,language};
// 'session' → tipo text com session_text. `to` = receiver.receiver_number em
// ambos. Ver seção 6 do plano.

export interface WarmupMessagePayload {
  message_log_id: string          // warmup_messages.id — Make pode usar como idempotency key
  conversation_id: string | null
  message_type: 'template' | 'session'
  sender: {
    sender_id: string             // phone_number_id da Meta
    waba_id: string | null
    phone_number: string
  }
  receiver: {
    receiver_number: string       // E.164
  }
  template: {                     // presente só quando message_type='template'
    name: string
    language: string
  } | null
  session_text: string | null     // presente só quando message_type='session'
  dry_run: boolean
  occurred_at: string
}

// Dispara o webhook do Make com a mensagem a enviar. Em dry_run nunca sai daqui
// (a mecânica roda inteira, mas nada é enviado). Falha de rede é best-effort: o
// resultado real de entrega chega depois pelo callback /dispatch-result.
export async function sendWarmupNotification(
  payload: WarmupMessagePayload
): Promise<{ ok: boolean }> {
  if (payload.dry_run) return { ok: true }

  const url = process.env.MAKE_WEBHOOK_URL_WARMUP
  if (!url) return { ok: false }

  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    return { ok: true }
  } catch {
    return { ok: false }
  }
}
