'use client'

// Transporte "helper" — o fluxo que roda em produção hoje: helper local (localhost:3001) +
// MicroSIP na máquina do agente.
//
// Este arquivo NÃO muda comportamento nenhum: é o mesmo `helperFetch` que estava espalhado por
// usePowerDialer, ManualDialTab, CallControls, SoftphoneClient e DialerTab, agora atrás da
// interface TelephonyTransport. Nada aqui é novo — cada método é o fetch que já existia, com o
// mesmo timeout, o mesmo tratamento de erro e os mesmos textos de mensagem.
//
// Continua sendo o padrão até o WebRTC provar paridade em produção (ver o plano §4, Etapa 5).

import { helperFetch } from '@/lib/constants'
import type {
  CallEvent,
  ParallelResult,
  ParallelStatus,
  TelephonyTransport,
  TransportStatus,
} from './types'
import { digitsOf } from './number'

const EMPTY_EVENT: CallEvent = { id: 0, type: null, number: null }

export function createHelperTransport(): TelephonyTransport {
  // Último estado conhecido do /ping. A UI lê isso de forma síncrona (banner "Helper online").
  let status: TransportStatus = { ready: false, version: null, multiCall: null }

  const refreshStatus = async (): Promise<TransportStatus> => {
    try {
      const res = await helperFetch('/ping', { signal: AbortSignal.timeout(2000) })
      const data = res.ok ? await res.json().catch(() => null) : null
      // Um 200 NÃO basta: qualquer processo pode estar na 3001 e responder OK. Aconteceu de
      // verdade — um segundo `next dev` achou a 3000 ocupada, pulou para a 3001 e passou a
      // responder HTML ali; o app dizia "Helper online" (sem versão) e nada funcionava. Só
      // contamos como helper se vier o payload dele.
      const isHelper = res.ok && data?.ok === true
      status = {
        ready: isHelper,
        version: isHelper ? (data?.version ?? status.version) : null,
        // `multiCall` só existe no helper >= 1.8; em helper antigo fica undefined e mantemos o
        // valor anterior (null = desconhecido), sem inventar um estado.
        multiCall: isHelper ? (data?.multiCall === undefined ? status.multiCall : data.multiCall) : null,
      }
    } catch {
      status = { ready: false, version: null, multiCall: null }
    }
    return status
  }

  return {
    kind: 'helper',

    async init() {
      await refreshStatus()
    },

    async dispose() {
      // O helper é um processo externo — não há nada para liberar do lado do navegador.
    },

    getStatus: () => status,
    refreshStatus,

    async call(number, opts) {
      // LANÇA em falha, de propósito: a discagem manual mostra o erro ao agente, enquanto o
      // power dialer engole (só o banner de offline). Quem decide é o chamador — se este método
      // engolisse, a discagem manual perderia o aviso "a ligação não foi disparada".
      let res: Response
      try {
        res = await helperFetch('/call', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ number: digitsOf(number), raw: opts?.raw ?? false }),
        })
      } catch {
        throw new Error('Helper offline — a ligação não foi disparada.')
      }
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error ?? 'O helper recusou a discagem.')
      }
    },

    async dialParallel(numbers): Promise<ParallelResult> {
      try {
        const res = await helperFetch('/dial-parallel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ numbers: numbers.map(digitsOf) }),
        })
        const data = await res.json().catch(() => null)
        if (!res.ok) {
          return {
            sessionId: null,
            error: data?.message ?? data?.error ?? 'O helper recusou a discagem.',
          }
        }
        return { sessionId: typeof data?.session === 'number' ? data.session : null }
      } catch {
        return { sessionId: null, error: 'Helper offline — a discagem não foi disparada.' }
      }
    },

    async getParallelStatus(): Promise<ParallelStatus> {
      try {
        const res = await helperFetch('/parallel-status', { signal: AbortSignal.timeout(2000) })
        return (await res.json()) as ParallelStatus
      } catch {
        // helper offline — o chamador tenta de novo no próximo tick
        return { active: false }
      }
    },

    async hangup() {
      try {
        await helperFetch('/hangup', { method: 'POST' })
      } catch {
        // helper offline — a UI avança de qualquer forma
      }
    },

    async hangupCalling() {
      try {
        // /hangup-calling (helper >= 1.8) poupa uma linha que tenha acabado de ser atendida.
        // Em helper antigo a rota não existe (404) e as linhas caem sozinhas por não-atendimento.
        await helperFetch('/hangup-calling', { method: 'POST' })
      } catch {
        // idem
      }
    },

    async setMuted(device, muted) {
      try {
        const res = await helperFetch('/mute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ device, muted }),
        })
        // Só confirma se o helper aplicou (assertividade: a UI não mente).
        return res.ok
      } catch {
        return false
      }
    },

    async getLastEvent(): Promise<CallEvent> {
      try {
        const res = await helperFetch('/events', { signal: AbortSignal.timeout(2000) })
        const ev = await res.json()
        return {
          id: typeof ev?.id === 'number' ? ev.id : 0,
          type: ev?.type ?? null,
          number: ev?.number ?? null,
        }
      } catch {
        // helper offline — sem detecção automática; o botão Encerrar ainda funciona
        return EMPTY_EVENT
      }
    },

    async prepareMultiCall() {
      try {
        const res = await helperFetch('/microsip-multicall', { method: 'POST' })
        const data = await res.json().catch(() => null)
        if (!res.ok) return { ok: false, error: data?.error ?? 'falhou' }
        await refreshStatus()
        return { ok: true }
      } catch {
        return { ok: false, error: 'falhou' }
      }
    },
  }
}
