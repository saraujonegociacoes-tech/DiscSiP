'use client'

import { useEffect, useId, useState } from 'react'
import { cn } from '@/lib/utils'

// Campo de data em DD/MM/AAAA, sempre — em todo navegador, em todo sistema.
//
// ── Por que não usar <input type="date"> ────────────────────────────────────
// O controle nativo renderiza no locale do NAVEGADOR/SISTEMA OPERACIONAL, não no da
// página. Num Windows configurado em inglês, 6 de maio aparece como "05/06/2026" — dia
// e mês trocados de lugar para quem lê em português. Não há CSS, atributo, `lang` nem
// prop de React que mude isso: é decisão do agente de usuário. A única saída é não usar
// o controle nativo.
//
// Foi reportado pelo dono em 05/ago/2026 com a regra: TODOS os campos de data de TODOS
// os painéis em DD/MM/AAAA.
//
// ── Contrato: drop-in do <input type="date"> ───────────────────────────────
// `value` e `onChange` falam ISO ('YYYY-MM-DD'), igual ao nativo — então trocar um pelo
// outro não mexe em nenhuma lógica de período, action ou estado em volta. O que muda é
// só o que o usuário vê e digita.
//
// `onChange('')` quando o campo está vazio ou incompleto: um campo pela metade não é uma
// data, e emitir '2026-05-' faria o consumidor tratar lixo como valor.

const soDigitos = (s: string) => s.replace(/\D/g, '')

/** 'YYYY-MM-DD' → 'DD/MM/AAAA' (vazio se não for uma data completa). */
function isoParaBr(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '')
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ''
}

/**
 * 'DDMMYYYY' (só dígitos) → 'YYYY-MM-DD', ou null se não for data real.
 * Valida de verdade: 31/02 não passa, e o ano tem que ser plausível (1900–2999).
 */
function digitosParaIso(d: string): string | null {
  if (d.length !== 8) return null
  const dia = Number(d.slice(0, 2))
  const mes = Number(d.slice(2, 4))
  const ano = Number(d.slice(4, 8))
  if (ano < 1900 || ano > 2999 || mes < 1 || mes > 12 || dia < 1) return null
  // Dia 0 do mês seguinte = último dia deste mês. Pega 31/04 e 29/02 de ano não bissexto.
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate()
  if (dia > ultimo) return null
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
}

/** Insere as barras conforme digita, sem atrapalhar quem apaga. */
function mascara(d: string): string {
  const x = d.slice(0, 8)
  if (x.length <= 2) return x
  if (x.length <= 4) return `${x.slice(0, 2)}/${x.slice(2)}`
  return `${x.slice(0, 2)}/${x.slice(2, 4)}/${x.slice(4)}`
}

export function BrDateInput({
  value,
  onChange,
  min,
  max,
  disabled,
  className,
  id,
  'aria-label': ariaLabel,
}: {
  /** ISO 'YYYY-MM-DD' (ou '' quando vazio) — mesmo contrato do input nativo. */
  value: string
  onChange: (iso: string) => void
  /** Limites em ISO. Fora do intervalo o campo fica marcado, mas não bloqueia a digitação. */
  min?: string
  max?: string
  disabled?: boolean
  className?: string
  id?: string
  'aria-label'?: string
}) {
  const [txt, setTxt] = useState(() => isoParaBr(value))
  const autoId = useId()

  // Ressincroniza quando o valor muda POR FORA (trocar de período, resetar formulário).
  // Só quando o texto atual não representa o mesmo dia — senão apagaria o que a pessoa
  // está digitando no meio da edição.
  useEffect(() => {
    const atual = digitosParaIso(soDigitos(txt))
    if (atual !== (value || null)) setTxt(isoParaBr(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const digitos = soDigitos(txt)
  const iso = digitosParaIso(digitos)
  const incompleto = digitos.length > 0 && digitos.length < 8
  const invalido = digitos.length === 8 && iso === null
  const foraDoIntervalo = iso !== null && ((min && iso < min) || (max && iso > max))
  const problema = incompleto || invalido || foraDoIntervalo

  function handle(next: string) {
    const d = soDigitos(next).slice(0, 8)
    setTxt(mascara(d))
    const novoIso = digitosParaIso(d)
    // Só emite data completa e válida; incompleto vira '' (equivalente a campo vazio).
    onChange(novoIso ?? '')
  }

  return (
    <input
      id={id ?? autoId}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      placeholder="dd/mm/aaaa"
      maxLength={10}
      value={txt}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-invalid={problema || undefined}
      onChange={(e) => handle(e.target.value)}
      onBlur={() => setTxt(isoParaBr(value))}
      className={cn(
        'w-[7.5rem] rounded-lg border border-border bg-background px-3 py-1.5 text-sm tabular-nums text-foreground shadow-card outline-none focus:border-primary disabled:opacity-50',
        problema && 'border-destructive focus:border-destructive',
        className,
      )}
    />
  )
}
