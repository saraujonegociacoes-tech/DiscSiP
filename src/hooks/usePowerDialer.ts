'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useDialerStore } from '@/store/dialerStore'
import { useSoftphoneStore } from '@/store/softphoneStore'
import {
  getNextContact,
  updateContactStatus,
  updateCampaignStatus,
} from '@/app/actions/campaigns'
import { saveCallLog } from '@/app/actions/dialer'
import type { ContactStatus } from '@/lib/types/database'
import { HELPER_URL } from '@/lib/constants'

async function triggerMicroSIP(number: string): Promise<void> {
  const clean = number.replace(/\D/g, '')
  try {
    await fetch(`${HELPER_URL}/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ number: clean }),
    })
  } catch {
    // Helper offline — MicroSIP não será acionado automaticamente
  }
}

export function usePowerDialer() {
  const {
    campaign,
    currentContact,
    dialerStatus,
    pauseBetweenCalls,
    setCurrentContact,
    setDialerStatus,
    setPendingDisposition,
  } = useDialerStore()

  const { agentId, extension, callStatus, callStartedAt, setCallStatus } =
    useSoftphoneStore()

  const pauseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const callEndHandledRef = useRef(false)

  const dialNext = useCallback(async () => {
    if (!campaign || !agentId) return

    const contact = await getNextContact(campaign.id, agentId)

    if (!contact) {
      setDialerStatus('completed')
      await updateCampaignStatus(campaign.id, 'completed')
      return
    }

    setCurrentContact(contact)
    setCallStatus('calling', contact.phone_number)
    await triggerMicroSIP(contact.phone_number)
  }, [campaign, agentId, setCurrentContact, setDialerStatus, setCallStatus])

  // Quando chamada termina com discador rodando, pede disposição ao agente
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

  // Reseta flag quando nova chamada começa
  useEffect(() => {
    if (callStatus === 'calling') {
      callEndHandledRef.current = false
    }
  }, [callStatus])

  const start = useCallback(async () => {
    if (!campaign) return
    setDialerStatus('running')
    await dialNext()
  }, [campaign, setDialerStatus, dialNext])

  const pause = useCallback(() => {
    if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current)
    setDialerStatus('paused')
  }, [setDialerStatus])

  const resume = useCallback(async () => {
    if (!campaign) return
    setDialerStatus('running')
    await dialNext()
  }, [campaign, setDialerStatus, dialNext])

  const submitDisposition = useCallback(
    async (status: ContactStatus, disposition?: string) => {
      if (!currentContact || !agentId || !extension) return

      const durationSeconds = callStartedAt
        ? Math.floor((Date.now() - callStartedAt.getTime()) / 1000)
        : 0

      const callStatus: 'answered' | 'no_answer' | 'busy' | 'failed' =
        status === 'answered' ? 'answered'
        : status === 'busy' ? 'busy'
        : 'no_answer'

      await saveCallLog({
        agentId,
        extension,
        phoneNumber: currentContact.phone_number,
        direction: 'outbound',
        status: callStatus,
        durationSeconds,
        startedAt: callStartedAt?.toISOString() ?? null,
        endedAt: new Date().toISOString(),
        campaignId: campaign?.id,
      })

      await updateContactStatus(currentContact.id, status, disposition)
      setPendingDisposition(false)
      setCallStatus('idle')

      if (dialerStatus !== 'running') return

      pauseTimerRef.current = setTimeout(() => {
        dialNext()
      }, pauseBetweenCalls * 1000)
    },
    [
      currentContact,
      agentId,
      extension,
      campaign,
      callStartedAt,
      dialerStatus,
      pauseBetweenCalls,
      setPendingDisposition,
      setCallStatus,
      dialNext,
    ]
  )

  useEffect(() => {
    return () => {
      if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current)
    }
  }, [])

  return { start, pause, resume, submitDisposition, dialNext }
}
