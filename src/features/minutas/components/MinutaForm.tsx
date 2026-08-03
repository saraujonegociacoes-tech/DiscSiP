'use client'

import { useMemo, useState } from 'react'
import { Loader2, Plus } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { createMinuta } from '@/app/actions/minutas'
import type { CreateMinutaInput, Recorrencia } from '@/lib/types/database'
import { RECORRENCIAS, brl } from '../shared'

// Formulário "Nova minuta": cria o acordo e gera as parcelas (RPC proc_create_acordo). A
// recorrência define o intervalo entre parcelas; 'avulsa' força 1 parcela; 'personalizada'
// pede o intervalo em dias. Preview do plano de parcelas ao vivo.

const inputCls =
  'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground shadow-card outline-none focus:border-primary disabled:opacity-50'
const labelCls = 'mb-1 block text-xs font-medium text-muted-foreground'

function parseMoney(s: string): number | null {
  const t = s.trim()
  if (!t) return null
  // aceita "5.013,96", "5013.96" ou "5013,96"
  const norm = /,[0-9]{1,2}$/.test(t) ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '')
  const n = Number(norm.replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

export function MinutaForm({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [cliente, setCliente] = useState('')
  const [numeroProcesso, setNumeroProcesso] = useState('')
  const [titulo, setTitulo] = useState('')
  const [recorrencia, setRecorrencia] = useState<Recorrencia>('mensal')
  const [intervaloDias, setIntervaloDias] = useState('30')
  const [numParcelas, setNumParcelas] = useState('1')
  const [valor, setValor] = useState('')
  const [primeiroVencimento, setPrimeiroVencimento] = useState('')
  const [observacoes, setObservacoes] = useState('')

  const isAvulsa = recorrencia === 'avulsa'
  const isPersonalizada = recorrencia === 'personalizada'
  const valorNum = parseMoney(valor)

  const dias = useMemo(() => {
    if (isAvulsa) return null
    if (isPersonalizada) return Number(intervaloDias) || null
    return RECORRENCIAS.find((r) => r.value === recorrencia)?.dias ?? null
  }, [recorrencia, intervaloDias, isAvulsa, isPersonalizada])

  const parcelasCount = isAvulsa ? 1 : Math.max(Number(numParcelas) || 1, 1)

  // Preview: datas de vencimento geradas (mesma regra do banco — venc + n·dias).
  const preview = useMemo(() => {
    if (!primeiroVencimento) return []
    const [y, m, d] = primeiroVencimento.split('-').map(Number)
    return Array.from({ length: Math.min(parcelasCount, 6) }, (_, i) => {
      const base = Date.UTC(y, m - 1, d) + (dias ?? 0) * i * 86_400_000
      const dt = new Date(base)
      return `${String(dt.getUTCDate()).padStart(2, '0')}/${String(dt.getUTCMonth() + 1).padStart(2, '0')}/${dt.getUTCFullYear()}`
    })
  }, [primeiroVencimento, parcelasCount, dias])

  function reset() {
    setCliente('')
    setNumeroProcesso('')
    setTitulo('')
    setRecorrencia('mensal')
    setIntervaloDias('30')
    setNumParcelas('1')
    setValor('')
    setPrimeiroVencimento('')
    setObservacoes('')
    setError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!cliente.trim() && !titulo.trim()) {
      setError('Informe ao menos o nome da cliente ou um título.')
      return
    }
    setSaving(true)
    const input: CreateMinutaInput = {
      cliente: cliente.trim(),
      numeroProcesso: numeroProcesso.trim(),
      titulo: titulo.trim(),
      recorrencia,
      intervaloDias: isPersonalizada ? Number(intervaloDias) || null : null,
      numParcelas: parcelasCount,
      valorParcela: valorNum,
      primeiroVencimento: primeiroVencimento || null,
      observacoes: observacoes.trim(),
    }
    const res = await createMinuta(input)
    setSaving(false)
    if (!res.ok) {
      setError(res.error ?? 'Não foi possível salvar. Tente novamente.')
      return
    }
    setOpen(false)
    reset()
    onCreated()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) reset()
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-primary px-3.5 py-2 text-sm font-medium text-primary-foreground shadow-glow transition-opacity hover:opacity-90"
        >
          <Plus className="h-4 w-4" />
          Nova minuta
        </button>
      </DialogTrigger>

      <DialogContent className="max-h-[90vh] overflow-y-auto rounded-2xl border-border bg-gradient-card sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Nova minuta processual</DialogTitle>
          <DialogDescription>
            Cadastre a minuta e escolha a recorrência — as parcelas são geradas automaticamente.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={labelCls}>Nome da cliente</label>
              <input className={inputCls} value={cliente} onChange={(e) => setCliente(e.target.value)} placeholder="Ex.: Djaci Nunes de Azevedo" />
            </div>
            <div>
              <label className={labelCls}>Número do processo</label>
              <input className={inputCls} value={numeroProcesso} onChange={(e) => setNumeroProcesso(e.target.value)} placeholder="Ex.: 0001234-56.2026.8.26.0100" />
            </div>
          </div>

          <div>
            <label className={labelCls}>Título</label>
            <input className={inputCls} value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex.: Minuta Acordo" />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={labelCls}>Recorrência</label>
              <select className={inputCls} value={recorrencia} onChange={(e) => setRecorrencia(e.target.value as Recorrencia)}>
                {RECORRENCIAS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
            {isPersonalizada ? (
              <div>
                <label className={labelCls}>Intervalo entre parcelas (dias)</label>
                <input type="number" min={1} className={inputCls} value={intervaloDias} onChange={(e) => setIntervaloDias(e.target.value)} />
              </div>
            ) : (
              <div>
                <label className={labelCls}>Nº de parcelas</label>
                <input type="number" min={1} disabled={isAvulsa} className={inputCls} value={isAvulsa ? '1' : numParcelas} onChange={(e) => setNumParcelas(e.target.value)} />
              </div>
            )}
          </div>

          {isPersonalizada && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className={labelCls}>Nº de parcelas</label>
                <input type="number" min={1} className={inputCls} value={numParcelas} onChange={(e) => setNumParcelas(e.target.value)} />
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={labelCls}>Valor por parcela (R$)</label>
              <input className={inputCls} value={valor} onChange={(e) => setValor(e.target.value)} placeholder="Ex.: 5.013,96" inputMode="decimal" />
            </div>
            <div>
              <label className={labelCls}>1º vencimento</label>
              <input type="date" className={inputCls} value={primeiroVencimento} onChange={(e) => setPrimeiroVencimento(e.target.value)} />
            </div>
          </div>

          <div>
            <label className={labelCls}>Observações</label>
            <textarea className={inputCls} rows={2} value={observacoes} onChange={(e) => setObservacoes(e.target.value)} placeholder="Opcional" />
          </div>

          {/* Preview do plano */}
          {preview.length > 0 && (
            <div className="rounded-lg border border-border bg-background/50 p-3 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{nfPlural(parcelasCount)}</span>
              {valorNum != null && <> de {brl(valorNum)} cada</>} — vencimentos:{' '}
              {preview.join(' · ')}
              {parcelasCount > preview.length && ` · … (+${parcelasCount - preview.length})`}
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter className="mt-1 gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg border border-border bg-background px-3.5 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-primary px-3.5 py-2 text-sm font-medium text-primary-foreground shadow-glow transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Salvar minuta
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function nfPlural(n: number): string {
  return n === 1 ? '1 parcela' : `${n} parcelas`
}
