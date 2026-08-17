// Normalização e casamento de números de telefone.
//
// PORTADO LITERALMENTE de `local-helper/index.js` (formatNumber / digitsOf / sameNumber). Estas
// funções não foram reescritas de propósito: são regras já validadas em ligação real, e cada
// uma existe por causa de um bug concreto que já aconteceu em produção. Ao migrar para o
// softphone WebRTC, quem disca passa a ser o navegador — a regra do que discar continua a mesma.
//
// Ver docs/discadora-docs/updates/softphone-webrtc-navegador.md §3.

/** CSP da operadora. Sem ele o interurbano não completa. Era `DIAL_PREFIX` no helper. */
export const DIAL_PREFIX = '021'

/** Até este tamanho, o número é um ramal interno e disca SEM o CSP. */
export const EXTENSION_MAX_DIGITS = 6

/** Só os dígitos de uma string. */
export function digitsOf(s: string): string {
  return String(s || '').replace(/\D/g, '')
}

/** Um número curto é ramal interno (discagem manual disca direto, sem CSP). */
export function isExtension(raw: string): boolean {
  const d = digitsOf(raw)
  return d.length > 0 && d.length <= EXTENSION_MAX_DIGITS
}

/**
 * Normaliza para o formato que o PABX espera: tira não-dígitos e o código de país (+55 / 55),
 * e prefixa o CSP — sempre `021 + DDD + número` (ex.: `11952085529` → `02111952085529`).
 */
export function formatNumber(raw: string): string {
  let digits = digitsOf(raw)
  if (digits.length > 11 && digits.startsWith('55')) digits = digits.slice(2)
  return DIAL_PREFIX + digits
}

/**
 * O número que efetivamente sai na linha: ramal interno vai cru, o resto leva o CSP.
 * Equivale ao `raw ? digits : formatNumber(number)` do `POST /call` do helper.
 */
export function dialString(raw: string, opts?: { raw?: boolean }): string {
  const digits = digitsOf(raw)
  if (opts?.raw) return digits
  return formatNumber(raw)
}

/**
 * Tira o código de país para casar o telefone do contato com o número discado que volta no
 * status do lote. Era `normalizeForMatch` em `usePowerDialer.ts`.
 */
export function normalizeForMatch(raw: string): string {
  let d = digitsOf(raw)
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2)
  return d
}

/**
 * Dois números são "o mesmo" se os dígitos batem, ou se um termina com os últimos 8 dígitos do
 * outro.
 *
 * ⚠️ NÃO simplificar para igualdade exata. O softphone nem sempre devolve o número no formato
 * em que foi discado (pode vir sem o CSP, com o domínio SIP junto), e um evento que não casa
 * deixava a linha eternamente em 'calling' — travando o lote inteiro em "Discando 3…" para
 * sempre. Foi um dos três bugs que derrubavam a preditiva antes da v1.8.
 */
export function sameNumber(a: string, b: string): boolean {
  const x = digitsOf(a)
  const y = digitsOf(b)
  if (!x || !y) return false
  if (x === y) return true
  const tail = x.slice(-8)
  return tail.length >= 8 && y.endsWith(tail)
}
