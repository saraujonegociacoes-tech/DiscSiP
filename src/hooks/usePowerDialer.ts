'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useDialerStore } from '@/store/dialerStore'
import { useSoftphoneStore } from '@/store/softphoneStore'
import {
  getNextContact,
  updateContactStatus,
  updateCampaignStatus,
} from '@/app/actions/campaigns'
import type { ContactStatus } from '@/lib/types/database'

interface UsePowerDialerOptions {
  onCall: (phoneNumber: string) => Promise<void>
}

export function usePowerDialer({ onCall }: UsePowerDialerOptions) {
  const {
    campaign,
    currentContact,
    dialerStatus,
    pauseBetweenCalls,
    setCurrentContact,
    setDialerStatus,
    setPendingDisposition,
  } = useDialerStore()

  const { agentId, callStatus } = useSoftphoneStore()

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
    await onCall(contact.phone_number)
  }, [campaign, agentId, setCurrentContact, setDialerStatus, onCall])

  // Quando a chamada termina com discador rodando, pede disposição ao agente
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
    if (callStatus === 'ringing') {
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

  // Agente define resultado da chamada e discador avança para o próximo
  const submitDisposition = useCallback(
    async (status: ContactStatus, disposition?: string) => {
      if (!currentContact) return

      await updateContactStatus(currentContact.id, status, disposition)
      setPendingDisposition(false)

      if (dialerStatus !== 'running') return

      pauseTimerRef.current = setTimeout(() => {
        dialNext()
      }, pauseBetweenCalls * 1000)
    },
    [currentContact, dialerStatus, pauseBetweenCalls, setPendingDisposition, dialNext]
  )

  useEffect(() => {
    return () => {
      if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current)
    }
  }, [])

  return { start, pause, resume, submitDisposition, dialNext }
}
