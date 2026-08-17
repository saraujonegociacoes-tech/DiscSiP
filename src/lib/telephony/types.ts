// Camada de transporte de telefonia — a interface que o discador enxerga.
//
// POR QUE ISSO EXISTE: até aqui o front falava direto com o helper local (fetch em
// localhost:3001). Trocar o helper por um softphone WebRTC no navegador significaria mexer em
// usePowerDialer, ManualDialTab, CallControls, SoftphoneClient e DialerTab ao mesmo tempo — o
// núcleo do módulo que está em produção com 26 agentes.
//
// Em vez disso, a superfície que o helper já expunha (/call, /dial-parallel, /parallel-status,
// /hangup, /hangup-calling, /mute, /events, /ping) virou ESTA interface, com duas
// implementações: `helperTransport` (o de hoje) e `webrtcTransport` (sip.js, sem instalação).
// O front não sabe qual está ativo — é o que torna o rollout, o teste local e o rollback triviais.
//
// ⚠️ As assinaturas espelham o helper de propósito, inclusive o polling (getParallelStatus /
// getLastEvent). Trocar polling por callback é limpeza POSTERIOR, quando o WebRTC estiver
// estável em produção: misturar as duas mudanças é o que transformaria uma refatoração
// verificável em uma reescrita às cegas.
//
// Plano completo: docs/discadora-docs/updates/softphone-webrtc-navegador.md

/** Modo de telefonia de um agente. Definido por agente (não por build) para permitir migrar um de cada vez. */
export type TelephonyMode = 'helper' | 'webrtc'

/**
 * Desfecho de UMA linha dentro de um lote paralelo. Mesmos valores que o helper já usa —
 * `usePowerDialer` os traduz para `ContactStatus`:
 *   answered → tabulado pelo agente   ·  cut     → 'abandoned' (nós derrubamos, recicla)
 *   machine  → 'failed' (atendeu rápido demais)  ·  busy → 'busy'  ·  ended → 'no_answer'
 */
export type LineState = 'calling' | 'answered' | 'busy' | 'cut' | 'machine' | 'ended'

/** Estado agregado do lote paralelo — o que o `/parallel-status` do helper devolve. */
export interface ParallelStatus {
  active: boolean
  id?: number
  startedAt?: string
  calls?: Record<string, LineState>
  winner?: string | null
  answeredAt?: string | null
  resolved?: boolean
  finished?: boolean
  timedOut?: boolean
  ringCutoff?: boolean
  instantAnswer?: boolean
}

/** Último evento de chamada — o que o `/events` do helper devolve. */
export interface CallEvent {
  id: number
  type: 'call-start' | 'call-end' | 'call-busy' | null
  number: string | null
}

/**
 * Estado do transporte. Substitui o "helper online/offline" da UI: no modo webrtc `ready`
 * significa "registrado no PABX", no modo helper significa "helper respondeu no /ping".
 */
export interface TransportStatus {
  ready: boolean
  /** Versão do helper (modo helper) ou do transporte (modo webrtc) — mostrada na UI. */
  version: string | null
  /**
   * Modo multi-chamada do MicroSIP. Só existe no modo helper (>= 1.8):
   * true = liberado · false = chamada única (preditiva não funciona) · null = desconhecido.
   * No modo webrtc é sempre `true` — multi-linha é do nosso lado, não de um .ini de terceiro.
   */
  multiCall: boolean | null
  /** Mensagem de erro legível quando `ready` é false (ex.: falha de registro SIP). */
  error?: string | null
}

/** Resultado do disparo de um lote paralelo. */
export interface ParallelResult {
  sessionId: number | null
  error?: string
}

export interface TelephonyTransport {
  readonly kind: TelephonyMode

  /** Sobe o transporte (registra no PABX / confere o helper). Idempotente. */
  init(): Promise<void>
  /** Encerra o transporte e libera os recursos (mic, socket). */
  dispose(): Promise<void>

  /** ~ GET /ping — leitura síncrona do último estado conhecido. */
  getStatus(): TransportStatus
  /** ~ GET /ping — consulta ativa, atualiza o estado interno. */
  refreshStatus(): Promise<TransportStatus>

  /**
   * ~ POST /call — disca um número. `raw: true` disca sem o CSP (ramal interno).
   * **Lança** se a discagem não foi disparada: a discagem manual mostra a mensagem ao agente,
   * o power dialer engole. Quem decide o que fazer com a falha é o chamador.
   */
  call(number: string, opts?: { raw?: boolean }): Promise<void>

  /** ~ POST /dial-parallel — disca N em paralelo (modo preditivo). */
  dialParallel(numbers: string[]): Promise<ParallelResult>

  /** ~ GET /parallel-status */
  getParallelStatus(): Promise<ParallelStatus>

  /** ~ POST /hangup — encerra tudo, inclusive conversa em curso. */
  hangup(): Promise<void>

  /**
   * ~ POST /hangup-calling — derruba só o que ainda TOCA, poupando a chamada já atendida.
   * É o comando do corte de toque e do "pausar com lote tocando".
   */
  hangupCalling(): Promise<void>

  /** ~ POST /mute — devolve true se aplicou (a UI só vira o botão quando confirmado). */
  setMuted(device: 'mic' | 'speaker', muted: boolean): Promise<boolean>

  /** ~ GET /events — último evento de chamada (o 1-a-1 detecta o fim por aqui). */
  getLastEvent(): Promise<CallEvent>

  /**
   * Liga o modo multi-chamada do MicroSIP (botão "Preparar MicroSIP").
   * Só faz sentido no modo helper; no webrtc é no-op que devolve sucesso.
   */
  prepareMultiCall(): Promise<{ ok: boolean; error?: string }>
}
