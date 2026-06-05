'use client'

import { useEffect, useRef, useCallback } from 'react'
import {
  UserAgent,
  Registerer,
  RegistererState,
  Inviter,
  Invitation,
  SessionState,
} from 'sip.js'
import { useSoftphoneStore } from '@/store/softphoneStore'

export interface SipCredentials {
  extension: number
  password: string
  sipServer: string
  sipDomain: string
}

type WebRTCSessionDescriptionHandler = { peerConnection?: RTCPeerConnection }

function attachRemoteAudio(sdh: unknown, el: HTMLAudioElement) {
  const handler = sdh as WebRTCSessionDescriptionHandler
  const pc = handler?.peerConnection
  if (!pc) return
  const stream = new MediaStream()
  pc.getReceivers().forEach((r) => {
    if (r.track) stream.addTrack(r.track)
  })
  el.srcObject = stream
  el.play().catch(console.error)
}

export function useSipAgent(audioRef: React.RefObject<HTMLAudioElement | null>) {
  const userAgentRef = useRef<UserAgent | null>(null)
  const registererRef = useRef<Registerer | null>(null)
  const sessionRef = useRef<Inviter | null>(null)
  const invitationRef = useRef<Invitation | null>(null)
  const { setSipStatus, setCallStatus, setIncomingCall, resetCall } = useSoftphoneStore()

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
          delegate: {
            onInvite(invitation: Invitation) {
              const from = invitation.remoteIdentity.uri.user ?? 'Desconhecido'
              invitationRef.current = invitation
              setIncomingCall(from)

              invitation.stateChange.addListener((state) => {
                switch (state) {
                  case SessionState.Established:
                    setCallStatus('answered', from)
                    if (audioRef.current) {
                      attachRemoteAudio(invitation.sessionDescriptionHandler, audioRef.current)
                    }
                    break
                  case SessionState.Terminated:
                    setCallStatus('ended')
                    if (audioRef.current) audioRef.current.srcObject = null
                    setTimeout(resetCall, 2000)
                    invitationRef.current = null
                    break
                }
              })
            },
          },
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
            case RegistererState.Terminated:
              setSipStatus('error', 'Registro SIP encerrado')
              break
          }
        })

        await registerer.register()
      } catch (err) {
        setSipStatus('error', err instanceof Error ? err.message : 'Erro SIP')
      }
    },
    [setSipStatus, setIncomingCall, setCallStatus, resetCall, audioRef]
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
          case SessionState.Established:
            setCallStatus('answered', phoneNumber)
            if (audioRef.current) {
              attachRemoteAudio(inviter.sessionDescriptionHandler, audioRef.current)
            }
            break
          case SessionState.Terminated:
            setCallStatus('ended')
            if (audioRef.current) audioRef.current.srcObject = null
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
    const session = sessionRef.current ?? invitationRef.current
    if (!session) return
    try {
      if (
        session.state === SessionState.Initial ||
        session.state === SessionState.Establishing
      ) {
        if (session instanceof Inviter) {
          await session.cancel()
        } else {
          await (session as Invitation).reject()
        }
      } else if (session.state === SessionState.Established) {
        await session.bye()
      }
    } catch {
      // ignore hangup errors
    }
  }, [])

  const answerCall = useCallback(async () => {
    const invitation = invitationRef.current
    if (!invitation) return
    try {
      await invitation.accept({
        sessionDescriptionHandlerOptions: {
          constraints: { audio: true, video: false },
        },
      })
    } catch (err) {
      console.error('Erro ao atender chamada:', err)
    }
  }, [])

  const rejectCall = useCallback(async () => {
    const invitation = invitationRef.current
    if (!invitation) return
    try {
      await invitation.reject()
      invitationRef.current = null
      resetCall()
    } catch {
      // ignore
    }
  }, [resetCall])

  useEffect(() => {
    return () => {
      disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { connect, disconnect, call, hangup, answerCall, rejectCall }
}
