'use server'

export interface DispositionNotification {
  contact: {
    name: string | null
    phone_number: string
    extra_data: Record<string, string>
  }
  agent: {
    name: string | null
    extension: number
  }
  campaign: {
    id: string
    name: string
  }
  disposition: {
    value: string
    label: string
  }
  occurred_at: string
}

// Dispara o webhook do Make com o resultado da chamada.
// A URL fica em MAKE_WEBHOOK_URL (secret no Cloudflare). Sem URL, é no-op.
// Falhas não bloqueiam o fluxo do agente.
export async function sendDispositionNotification(
  payload: DispositionNotification
): Promise<void> {
  const url = process.env.MAKE_WEBHOOK_URL
  if (!url) return

  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch {
    // Notificação é best-effort; não interrompe a discagem se o Make estiver fora
  }
}
