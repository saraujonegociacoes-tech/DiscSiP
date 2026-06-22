'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useDialerStore } from '@/store/dialerStore'
import { useSoftphoneStore } from '@/store/softphoneStore'
import { getNextContact, getNextContacts, updateContactStatus } from '@/app/actions/campaigns'
import { saveCallLog } from '@/app/actions/dialer'
import { sendDispositionNotification } from '@/app/actions/notifications'
import type { ContactStatus } from '@/lib/types/database'
import { helperFetch } from '@/lib/constants'

const onlyDigits = (s: string) => String(s || '').replace(/\D/g, '')

// Normaliza como o helper (formatNumber): tira não-dígitos e o código de país 55, para casar
// o número do contato com o número discado ('021' + DDD + número) que volta no /parallel-status.
function normalizeForMatch(raw: string): string {
  let d = onlyDigits(raw)
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2)
  return d
}

async function retryGetNextContact(
  campaignId: string,
  agentId: string,
  retries = 3
): Promise<Awaited<ReturnType<typeof getNextContact>>> {
  for (let i = 0; i < retries; i++) {
    try {
      return await getNextContact(campaignId, agentId)
    } catch {
      if (i < retries - 1) await new Promise((r) => setTimeout(r, 1000))
    }
  }
  return null
}

async function triggerMicroSIP(number: string): Promise<void> {
  const clean = onlyDigits(number)
  try {
    await helperFetch('/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ number: clean }),
    })
  } catch {
    // Helper offline — MicroSIP não será acionado automaticamente
  }
}

async function triggerParallel(numbers: string[]): Promise<void> {
  try {
    await helperFetch('/dial-parallel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ numbers: numbers.map(onlyDigits) }),
    })
  } catch {
    // Helper offline
  }
}

// Bipe curto no atendimento — o agente pode estar fazendo outra coisa enquanto disca N.
function playAnswerBeep(): void {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new Ctx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'sine'
    osc.frequency.value = 880
    gain.gain.setValueAtTime(0.0001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.03)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5)
    osc.start()
    osc.stop(ctx.currentTime + 0.52)
    osc.onended = () => ctx.close()
  } catch {
    // sem Web Audio — fica só o aviso visual
  }
}

export function usePowerDialer() {
  const {
    campaign,
    currentContact,
    dialerStatus,
    pauseBetweenCalls,
    parallelBatch,
    setCurrentContact,
    setDialerStatus,
    setPendingDisposition,
    setParallelBatch,
  } = useDialerStore()

  const { agentId, agentName, extension, callStatus, callStartedAt, setCallStatus } =
    useSoftphoneStore()

  const parallelLines = campaign?.parallel_lines ?? 1
  const isParallel = parallelLines >= 2

  const pauseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const callEndHandledRef = useRef(false)

  // ─── Modo 1-a-1 (power dialer atual) ───────────────────────────────────────────
  const dialNext = useCallback(async () => {
    if (!campaign || !agentId) return
    const contact = await retryGetNextContact(campaign.id, agentId)
    if (!contact) {
      setDialerStatus('completed')
      return
    }
    setCurrentContact(contact)
    setCallStatus('calling', contact.phone_number)
    await triggerMicroSIP(contact.phone_number)
  }, [campaign, agentId, setCurrentContact, setDialerStatus, setCallStatus])

  // ─── Modo paralelo (preditivo) ─────────────────────────────────────────────────
  const dialNextBatch = useCallback(async () => {
    if (!campaign || !agentId) return
    const contacts = await getNextContacts(campaign.id, agentId, parallelLines)
    if (!contacts.length) {
      setDialerStatus('completed')
      return
    }
    setParallelBatch(contacts)
    setCurrentContact(null)
    setCallStatus('calling') // "discando N" — ainda sem número específico
    await triggerParallel(contacts.map((c) => c.phone_number))
  }, [
    campaign,
    agentId,
    parallelLines,
    setParallelBatch,
    setCurrentContact,
    setCallStatus,
    setDialerStatus,
  ])

  // Ref para o effect de polling chamar o "próximo lote" sem recriar o intervalo a cada render.
  const dialNextBatchRef = useRef(dialNextBatch)
  useEffect(() => {
    dialNextBatchRef.current = dialNextBatch
  }, [dialNextBatch])

  // ─── Resolução do lote paralelo: vencedor × ninguém atendeu ────────────────────
  // Enquanto "discando N", faz polling em /parallel-status (só para a UI — o helper já derruba
  // as outras sozinho em <100ms). Quando alguém atende, o vencedor vira o contato atual e os
  // derrubados viram 'abandoned'. Se ninguém atende, marca cada um (busy/no_answer) e segue.
  useEffect(() => {
    if (!isParallel || callStatus !== 'calling' || parallelBatch.length === 0) return
    let done = false

    const resolve = async () => {
      try {
        const res = await helperFetch('/parallel-status', { signal: AbortSignal.timeout(2000) })
        const st = await res.json()
        if (done || !st.active) return
        const calls: Record<string, string> = st.calls || {}
        const values = Object.values(calls)

        if (st.winner) {
          done = true
          const winnerDigits = onlyDigits(st.winner)
          const winner = parallelBatch.find((c) =>
            winnerDigits.endsWith(normalizeForMatch(c.phone_number))
          )
          const losers = parallelBatch.filter((c) => c !== winner)
          // derrubados (tocaram, não atenderam a tempo) → 'abandoned' (recicláveis)
          await Promise.all(losers.map((c) => updateContactStatus(c.id, 'abandoned')))
          setParallelBatch([])
          if (winner) {
            setCurrentContact(winner)
            setCallStatus('answered', winner.phone_number)
            playAnswerBeep()
          } else {
            // vencedor não casou com nenhum contato (não deveria acontecer) — segue o baile
            setCallStatus('idle')
            if (dialerStatus === 'running') dialNextBatchRef.current()
          }
          return
        }

        // ninguém atendeu: todas as linhas terminaram (nenhuma ainda 'calling')
        if (values.length > 0 && !values.includes('calling')) {
          done = true
          await Promise.all(
            parallelBatch.map((c) => {
              const key = Object.keys(calls).find((k) =>
                onlyDigits(k).endsWith(normalizeForMatch(c.phone_number))
              )
              const final: ContactStatus = key && calls[key] === 'busy' ? 'busy' : 'no_answer'
              return updateContactStatus(c.id, final)
            })
          )
          setParallelBatch([])
          setCallStatus('idle')
          if (dialerStatus === 'running') {
            pauseTimerRef.current = setTimeout(
              () => dialNextBatchRef.current(),
              pauseBetweenCalls * 1000
            )
          }
        }
      } catch {
        // helper offline — tenta de novo no próximo tick
      }
    }

    resolve()
    const id = setInterval(resolve, 800)
    return () => {
      done = true
      clearInterval(id)
    }
  }, [
    isParallel,
    callStatus,
    parallelBatch,
    dialerStatus,
    pauseBetweenCalls,
    setParallelBatch,
    setCurrentContact,
    setCallStatus,
  ])

  // ─── Fim da chamada atendida (paralelo): detecta quando o vencedor desliga ──────
  useEffect(() => {
    if (!isParallel || callStatus !== 'answered') return
    let cancelled = false
    const poll = async () => {
      try {
        const res = await helperFetch('/parallel-status', { signal: AbortSignal.timeout(2000) })
        const st = await res.json()
        if (cancelled || !st.active || !st.winner) return
        const w = st.calls?.[st.winner]
        if (w && w !== 'answered') setCallStatus('ended')
      } catch {
        // helper offline
      }
    }
    poll()
    const id = setInterval(poll, 1000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [isParallel, callStatus, setCallStatus])

  // ─── Modo 1-a-1: detecta o fim da chamada pelos eventos do MicroSIP ─────────────
  useEffect(() => {
    if (isParallel || callStatus !== 'calling') return
    let cancelled = false
    let baseline: number | null = null
    const poll = async () => {
      try {
        const res = await helperFetch('/events', { signal: AbortSignal.timeout(2000) })
        const ev = await res.json()
        if (cancelled) return
        if (baseline === null) {
          baseline = ev.id
          return
        }
        if (ev.id > baseline && (ev.type === 'call-end' || ev.type === 'call-busy')) {
          setCallStatus('ended')
        }
      } catch {
        // helper offline — sem detecção automática; o botão Encerrar ainda funciona
      }
    }
    poll()
    const interval = setInterval(poll, 1000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [isParallel, callStatus, setCallStatus])

  // Quando a chamada termina (qualquer modo) com o discador rodando, pede disposição ao agente.
  useEffect(() => {
    if (
      callStatus === 'ended' &&
      dialerStatus === 'running' &&
      currentContact &&
      !callEndHandledRef.current
    ) {
      callEndHandledRef.current = true
      setPendingDisposition(true)
    }
  }, [callStatus, dialerStatus, currentContact, setPendingDisposition])

  // Reseta a flag quando uma nova chamada/lote começa
  useEffect(() => {
    if (callStatus === 'calling' || callStatus === 'answered') {
      callEndHandledRef.current = false
    }
  }, [callStatus])

  const start = useCallback(async () => {
    if (!campaign) return
    setDialerStatus('running')
    if (isParallel) await dialNextBatch()
    else await dialNext()
  }, [campaign, isParallel, dialNext, dialNextBatch, setDialerStatus])

  const pause = useCallback(() => {
    if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current)
    setDialerStatus('paused')
  }, [setDialerStatus])

  const resume = useCallback(async () => {
    if (!campaign) return
    setDialerStatus('running')
    if (isParallel) await dialNextBatch()
    else await dialNext()
  }, [campaign, isParallel, dialNext, dialNextBatch, setDialerStatus])

  const submitDisposition = useCallback(
    async (status: ContactStatus, disposition?: string, label?: string) => {
      if (!currentContact || !agentId || !extension) return

      const durationSeconds = callStartedAt
        ? Math.floor((Date.now() - callStartedAt.getTime()) / 1000)
        : 0

      const callStatusLog: 'answered' | 'no_answer' | 'busy' | 'failed' =
        status === 'answered' ? 'answered' : status === 'busy' ? 'busy' : 'no_answer'

      await saveCallLog({
        agentId,
        extension,
        phoneNumber: currentContact.phone_number,
        direction: 'outbound',
        status: callStatusLog,
        durationSeconds,
        startedAt: callStartedAt?.toISOString() ?? null,
        endedAt: new Date().toISOString(),
        campaignId: campaign?.id,
      })

      await updateContactStatus(currentContact.id, status, disposition)

      // Notifica o Make se a disposição estiver entre as que disparam aviso na campanha
      if (disposition && campaign?.notify_dispositions?.includes(disposition)) {
        await sendDispositionNotification({
          contact: {
            name: currentContact.name,
            phone_number: currentContact.phone_number,
            extra_data: currentContact.extra_data ?? {},
          },
          agent: { name: agentName, extension },
          campaign: { id: campaign.id, name: campaign.name },
          disposition: { value: disposition, label: label ?? disposition },
          occurred_at: new Date().toISOString(),
        })
      }

      setPendingDisposition(false)
      setCallStatus('idle')

      if (dialerStatus !== 'running') return

      pauseTimerRef.current = setTimeout(() => {
        if (isParallel) dialNextBatch()
        else dialNext()
      }, pauseBetweenCalls * 1000)
    },
    [
      currentContact,
      agentId,
      agentName,
      extension,
      campaign,
      callStartedAt,
      dialerStatus,
      isParallel,
      pauseBetweenCalls,
      setPendingDisposition,
      setCallStatus,
      dialNext,
      dialNextBatch,
    ]
  )

  useEffect(() => {
    return () => {
      if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current)
    }
  }, [])

  return { start, pause, resume, submitDisposition, dialNext, dialNextBatch, isParallel }
}
