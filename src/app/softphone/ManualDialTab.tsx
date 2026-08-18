'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Phone, PhoneOff, Delete, AlertTriangle, Check } from 'lucide-react'
import { useSoftphoneStore } from '@/store/softphoneStore'
import { useDialerStore } from '@/store/dialerStore'
import { saveCallLog } from '@/app/actions/dialer'
import { DISPOSITIONS } from '@/lib/dispositions'
import { getTransport } from '@/lib/telephony'
import { cn } from '@/lib/utils'

// Discagem manual: o agente digita o número e liga. Fora de campanha — não consome mailing,
// não tabula contato; só disca pelo mesmo helper/MicroSIP e grava a ligação no histórico.

type ManualStatus = 'idle' | 'calling' | 'answered' | 'ended'

const onlyDigits = (s: string) => s.replace(/\D/g, '')

// Até 6 dígitos = ramal interno do PABX: disca cru, sem o CSP (021). Com o prefixo, "0215125"
// sairia como interurbano e a ligação falharia.
const EXTENSION_MAX_DIGITS = 6
const isExtension = (d: string) => d.length > 0 && d.length <= EXTENSION_MAX_DIGITS

// Formata para leitura: (11) 91234-5678 / (11) 1234-5678. Ramal fica cru; número no meio da
// digitação só ganha o DDD entre parênteses (traço só quando o formato já é reconhecível).
function formatBR(d: string): string {
  if (d.length <= EXTENSION_MAX_DIGITS) return d
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  return `(${d.slice(0, 2)}) ${d.slice(2)}`
}

// Um número discável é um ramal (até 6 dígitos) ou um fixo/celular com DDD (10 ou 11).
function isDialable(d: string): boolean {
  return isExtension(d) || d.length === 10 || d.length === 11
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '']

export function ManualDialTab() {
  const {
    agentId,
    extension,
    helperOnline,
    callStatus,
    setCallStatus,
    setManualActive,
  } = useSoftphoneStore()
  const dialerStatus = useDialerStore((s) => s.dialerStatus)

  const [input, setInput] = useState('')
  const [status, setStatus] = useState<ManualStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState<string | null>(null)

  // Dados da ligação em curso — em refs porque quem os atualiza é o polling de eventos,
  // e re-render não pode reiniciar contagem nem perder o instante do atendimento.
  const dialedRef = useRef<string>('')
  const startedAtRef = useRef<Date | null>(null)
  const answeredAtRef = useRef<Date | null>(null)
  const endedAtRef = useRef<Date | null>(null)
  const outcomeRef = useRef<'answered' | 'no_answer' | 'busy'>('no_answer')
  const baselineRef = useRef<number | null>(null)

  const digits = onlyDigits(input)
  const inCall = status === 'calling' || status === 'answered'
  // O discador de campanha e a discagem manual disputam o mesmo MicroSIP: com a campanha
  // rodando/pausada, uma ligação manual entraria no meio do lote e bagunçaria a tabulação.
  const dialerBusy = dialerStatus === 'running' || dialerStatus === 'paused'
  const canDial =
    !!extension && helperOnline && !dialerBusy && !inCall && isDialable(digits) && !saving

  useEffect(() => {
    setManualActive(inCall || status === 'ended')
  }, [inCall, status, setManualActive])

  // O "Desligar" do painel de áudio mexe direto no store; aqui a tela acompanha na hora, sem
  // esperar o evento do MicroSIP chegar pelo polling.
  useEffect(() => {
    if (!inCall || callStatus !== 'ended') return
    if (!endedAtRef.current) endedAtRef.current = new Date()
    setStatus('ended')
  }, [inCall, callStatus])

  // Cronômetro: tempo tocando enquanto chama, tempo de conversa depois de atender.
  useEffect(() => {
    if (!inCall) return
    const from = status === 'answered' ? answeredAtRef.current : startedAtRef.current
    const tick = () => setElapsed(from ? Math.floor((Date.now() - from.getTime()) / 1000) : 0)
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [inCall, status])

  // Acompanha os eventos do MicroSIP para saber quando atendeu e quando terminou. A linha de
  // base é capturada ANTES de discar (em handleCall), então nenhum evento se perde entre o
  // disparo e o primeiro polling.
  useEffect(() => {
    if (!inCall) return
    let cancelled = false
    const poll = async () => {
      try {
        const ev = await getTransport().getLastEvent()
        if (cancelled || baselineRef.current === null || ev.id <= baselineRef.current) return
        if (ev.type === 'call-start' && !answeredAtRef.current) {
          answeredAtRef.current = new Date()
          outcomeRef.current = 'answered'
          setStatus('answered')
          setCallStatus('answered', dialedRef.current)
          return
        }
        if (ev.type === 'call-end' || ev.type === 'call-busy') {
          if (ev.type === 'call-busy' && !answeredAtRef.current) outcomeRef.current = 'busy'
          endedAtRef.current = new Date()
          setStatus('ended')
          setCallStatus('ended')
        }
      } catch {
        // helper offline — sem detecção automática; o botão Desligar encerra na mão
      }
    }
    poll()
    const id = setInterval(poll, 1000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [inCall, setCallStatus])

  const handleCall = async () => {
    if (!canDial) return
    setError(null)
    setSavedMsg(null)

    // Linha de base dos eventos: só contam os que vierem depois desta discagem.
    const baseEvent = await getTransport().getLastEvent()
    baselineRef.current = baseEvent.id

    dialedRef.current = digits
    startedAtRef.current = new Date()
    answeredAtRef.current = null
    endedAtRef.current = null
    outcomeRef.current = 'no_answer'

    try {
      await getTransport().call(digits, { raw: isExtension(digits) })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Helper offline — a ligação não foi disparada.')
      return
    }

    setStatus('calling')
    setCallStatus('calling', digits)
  }

  const handleHangup = async () => {
    await getTransport().hangup()
    endedAtRef.current = new Date()
    setStatus('ended')
    setCallStatus('ended')
  }

  // Grava a ligação no histórico. `status` é o que ACONTECEU na linha (evento do MicroSIP);
  // a disposição é o que o agente tabulou — opcional, porque ligação manual muitas vezes é só
  // um retorno rápido. call_logs é imutável por RLS, então grava-se uma vez, no fim.
  const finish = useCallback(
    async (disposition?: string) => {
      if (saving) return
      setSaving(true)
      const endedAt = endedAtRef.current ?? new Date()
      const durationSeconds = answeredAtRef.current
        ? Math.max(0, Math.floor((endedAt.getTime() - answeredAtRef.current.getTime()) / 1000))
        : 0
      try {
        if (agentId && extension) {
          await saveCallLog({
            agentId,
            extension,
            phoneNumber: dialedRef.current,
            direction: 'outbound',
            status: outcomeRef.current,
            durationSeconds,
            startedAt: startedAtRef.current?.toISOString() ?? null,
            endedAt: endedAt.toISOString(),
            disposition,
          })
          setSavedMsg('Ligação registrada no histórico.')
        }
      } catch {
        setError('Não foi possível registrar a ligação no histórico.')
      } finally {
        setSaving(false)
        setStatus('idle')
        setElapsed(0)
        setCallStatus('idle')
      }
    },
    [agentId, extension, saving, setCallStatus]
  )

  const press = (k: string) => {
    if (inCall) return
    setInput((v) => onlyDigits(v + k).slice(0, 11))
  }

  // Segundos entre a discagem e o atendimento. É o único sinal disponível para desconfiar de
  // caixa postal: no SIP ela atende com 200 OK igual a um humano. Suspeita nas DUAS pontas —
  // lento (~25-30s) é a caixa depois do toque; instantâneo (<4s) é bloqueio de spam, aparelho
  // desligado ou caixa direta, sem o telefone chegar a tocar. Não dá para afirmar, só sinalizar.
  const answerDelaySec =
    startedAtRef.current && answeredAtRef.current
      ? Math.round((answeredAtRef.current.getTime() - startedAtRef.current.getTime()) / 1000)
      : null
  const suspectSlow = answerDelaySec !== null && answerDelaySec >= 20
  const suspectFast = answerDelaySec !== null && answerDelaySec < 4
  const likelyVoicemail = suspectSlow || suspectFast

  const willDial = isExtension(digits)
    ? `ramal ${digits}`
    : digits.length >= 10
      ? `021 ${formatBR(digits)}`
      : null

  return (
    <div className="mx-auto max-w-md space-y-3">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Discagem manual</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Digite o número e ligue. Fora de campanha — não consome mailing.
        </p>
      </div>

      {/* Bloqueios */}
      {!extension && (
        <div className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm text-warning">
          <Phone className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Você não tem ramal atribuído. Peça a um administrador para definir seu ramal.</span>
        </div>
      )}
      {!helperOnline && (
        <div className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Helper offline. Abra o <strong>start.bat</strong> na pasta{' '}
            <code className="rounded bg-destructive/15 px-1">local-helper</code>.
          </span>
        </div>
      )}
      {dialerBusy && (
        <div className="flex items-start gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            A discagem por campanha está em andamento. Encerre ou conclua a campanha para usar a
            discagem manual.
          </span>
        </div>
      )}
      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {savedMsg && !inCall && status === 'idle' && (
        <div className="flex items-center gap-2 rounded-xl border border-success/40 bg-success/10 px-3 py-2.5 text-sm text-success">
          <Check className="h-4 w-4 shrink-0" /> {savedMsg}
        </div>
      )}

      {/* Ligação em curso */}
      {inCall && (
        <div
          className={cn(
            'rounded-2xl border p-5 text-center shadow-elevated',
            status === 'answered'
              ? 'border-2 border-success bg-success/15'
              : 'border-border bg-gradient-premium text-white'
          )}
        >
          <p
            className={cn(
              'text-xs uppercase tracking-wider',
              status === 'answered' ? 'font-bold text-success' : 'text-white/70'
            )}
          >
            {status === 'answered' ? 'Em ligação' : 'Chamando…'}
          </p>
          <p
            className={cn(
              'mt-1 font-mono text-2xl',
              status === 'answered' ? 'text-foreground' : 'animate-pulse text-white'
            )}
          >
            {formatBR(dialedRef.current)}
          </p>
          <p
            className={cn(
              'mt-1 font-mono text-sm tabular-nums',
              status === 'answered' ? 'text-muted-foreground' : 'text-white/70'
            )}
          >
            {String(Math.floor(elapsed / 60)).padStart(2, '0')}:
            {String(elapsed % 60).padStart(2, '0')}
          </p>
        </div>
      )}

      {/* Tabulação (opcional) ao fim da ligação */}
      {status === 'ended' && (
        <div className="rounded-2xl border border-primary/40 bg-gradient-card p-5 shadow-elevated">
          <p className="mb-1 text-xs font-medium uppercase tracking-wider text-primary">
            Resultado — {formatBR(dialedRef.current)}
          </p>
          {answerDelaySec !== null && (
            <p className={cn('mb-1 text-xs', likelyVoicemail ? 'text-warning' : 'text-muted-foreground')}>
              Atendeu {answerDelaySec}s após a discagem
              {suspectSlow && ' — nesse tempo costuma ser caixa postal, não a pessoa'}
              {suspectFast && ' — rápido demais para alguém atender: provável bloqueio de spam ou caixa direta'}
            </p>
          )}
          <p className="mb-3 text-xs text-muted-foreground">
            Tabular é opcional; a ligação vai para o histórico de qualquer forma.
          </p>
          <div className="grid grid-cols-2 gap-2">
            {DISPOSITIONS.map((d) => (
              <button
                key={d.value}
                disabled={saving}
                onClick={() => finish(d.value)}
                className="rounded-xl border border-border bg-background/40 px-3 py-3 text-left text-sm text-foreground transition-all hover:bg-accent/60 active:scale-95 disabled:opacity-50"
              >
                {d.label}
              </button>
            ))}
          </div>
          <button
            disabled={saving}
            onClick={() => finish()}
            className="mt-2 w-full rounded-xl border border-border py-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          >
            Salvar sem tabular
          </button>
        </div>
      )}

      {/* Teclado */}
      {status !== 'ended' && (
        <div className="rounded-2xl border border-border bg-gradient-card p-5 shadow-card">
          <div className="flex items-center gap-2">
            <input
              value={formatBR(digits)}
              onChange={(e) => setInput(onlyDigits(e.target.value).slice(0, 11))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canDial) handleCall()
              }}
              disabled={inCall}
              inputMode="tel"
              placeholder="DDD + número ou ramal"
              className="w-full rounded-xl border border-border bg-background/40 px-4 py-3 text-center font-mono text-xl tracking-wide text-foreground placeholder:font-sans placeholder:text-sm placeholder:tracking-normal placeholder:text-muted-foreground focus:border-primary focus:outline-none disabled:opacity-60"
            />
            <button
              onClick={() => setInput((v) => v.slice(0, -1))}
              disabled={inCall || digits.length === 0}
              title="Apagar"
              className="shrink-0 rounded-xl border border-border p-3 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
            >
              <Delete className="h-5 w-5" />
            </button>
          </div>

          <p className="mt-2 h-4 text-center text-xs text-muted-foreground">
            {willDial ? `Vai discar: ${willDial}` : 'Até 6 dígitos liga para um ramal interno'}
          </p>

          <div className="mt-3 grid grid-cols-3 gap-2">
            {KEYS.map((k, i) =>
              k === '' ? (
                <div key={i} />
              ) : (
                <button
                  key={i}
                  onClick={() => press(k)}
                  disabled={inCall}
                  className="rounded-xl border border-border bg-background/40 py-3.5 font-mono text-lg text-foreground transition-colors hover:bg-accent/60 active:scale-95 disabled:opacity-40"
                >
                  {k}
                </button>
              )
            )}
          </div>

          <div className="mt-3">
            {inCall ? (
              <button
                onClick={handleHangup}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-destructive py-3 text-sm font-semibold text-destructive-foreground transition-colors hover:bg-destructive/90"
              >
                <PhoneOff className="h-4 w-4" /> Desligar
              </button>
            ) : (
              <button
                onClick={handleCall}
                disabled={!canDial}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-success py-3 text-sm font-semibold text-success-foreground transition-colors hover:bg-success/90 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
              >
                <Phone className="h-4 w-4" /> Ligar
              </button>
            )}
          </div>
        </div>
      )}

      {/* Estado da chamada vindo do store (mute/desligar ficam no painel de áudio acima) */}
      {callStatus === 'answered' && status === 'answered' && (
        <p className="text-center text-xs text-muted-foreground">
          Use o painel de áudio acima para mutar o microfone ou encerrar.
        </p>
      )}
    </div>
  )
}
