'use client'

import { useEffect, useRef, useCallback } from 'react'
import {
  UserAgent,
  Registerer,
  RegistererState,
  Inviter,
  SessionState,
} from 'sip.js'
import { useSoftphoneStore } from '@/store/softphoneStore'

export interface SipCredentials {
  extension: number
  password: string
  sipServer: string
  sipDomain: string
}

export function useSipAgent(audioRef: React.RefObject<HTMLAudioElement | null>) {
  const userAgentRef = useRef<UserAgent | null>(null)
  const registererRef = useRef<Registerer | null>(null)
  const sessionRef = useRef<Inviter | null>(null)
  const { setSipStatus, setCallStatus, resetCall } = useSoftphoneStore()

  const connect = useCallback(
    async (credentials: SipCredentials) => {
      setSipStatus('connecting')
      try {
        const uri = UserAgent.makeURI(
          `sip:${credentials.extension}@${credentials.sipDomain}`
        )
        if (!uri) throw new Error('URI SIP inválida')

        const ua = new UserAgent({
          uri,
          authorizationUsername: String(credentials.extension),
          authorizationPassword: credentials.password,
          transportOptions: { server: credentials.sipServer },
          logLevel: 'error',
        })

        userAgentRef.current = ua
        await ua.start()

        const registerer = new Registerer(ua)
        registererRef.current = registerer

        registerer.stateChange.addListener((state) => {
          switch (state) {
            case RegistererState.Registered:
              setSipStatus('registered')
              break
            case RegistererState.Unregistered:
              setSipStatus('disconnected')
              break
            case RegistererState.Failed:
              setSipStatus('error', 'Falha no registro SIP')
              break
          }
        })

        await registerer.register()
      } catch (err) {
        setSipStatus('error', err instanceof Error ? err.message : 'Erro SIP')
      }
    },
    [setSipStatus]
  )

  const disconnect = useCallback(async () => {
    try {
      if (registererRef.current) {
        await registererRef.current.unregister()
        registererRef.current = null
      }
      if (userAgentRef.current) {
        await userAgentRef.current.stop()
        userAgentRef.current = null
      }
    } catch {
      // ignore disconnect errors
    }
    setSipStatus('disconnected')
  }, [setSipStatus])

  const call = useCallback(
    async (phoneNumber: string) => {
      const ua = userAgentRef.current
      if (!ua) return

      const sipDomain = process.env.NEXT_PUBLIC_SIP_DOMAIN
      const target = UserAgent.makeURI(`sip:${phoneNumber}@${sipDomain}`)
      if (!target) return

      const inviter = new Inviter(ua, target, {
        sessionDescriptionHandlerOptions: {
          constraints: { audio: true, video: false },
        },
      })
      sessionRef.current = inviter
      setCallStatus('ringing', phoneNumber)

      inviter.stateChange.addListener((state) => {
        switch (state) {
          case SessionState.Established: {
            setCallStatus('answered', phoneNumber)
            const sdh = inviter.sessionDescriptionHandler as unknown as { peerConnection?: RTCPeerConnection }
            const pc = sdh?.peerConnection
            if (pc && audioRef.current) {
              const stream = new MediaStream()
              pc.getReceivers().forEach((r) => {
                if (r.track) stream.addTrack(r.track)
              })
              audioRef.current.srcObject = stream
              audioRef.current.play().catch(console.error)
            }
            break
          }
          case SessionState.Terminated:
            setCallStatus('ended')
            if (audioRef.current) {
              audioRef.current.srcObject = null
            }
            setTimeout(resetCall, 2000)
            sessionRef.current = null
            break
        }
      })

      await inviter.invite()
    },
    [audioRef, setCallStatus, resetCall]
  )

  const hangup = useCallback(async () => {
    const session = sessionRef.current
    if (!session) return
    try {
      if (
        session.state === SessionState.Initial ||
        session.state === SessionState.Establishing
      ) {
        await session.cancel()
      } else if (session.state === SessionState.Established) {
        await session.bye()
      }
    } catch {
      // ignore hangup errors
    }
  }, [])

  useEffect(() => {
    return () => {
      disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { connect, disconnect, call, hangup }
}
