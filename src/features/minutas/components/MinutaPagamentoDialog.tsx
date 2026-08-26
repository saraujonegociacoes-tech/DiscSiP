'use client'

import { useEffect, useState } from 'react'
import { Loader2, CircleDollarSign } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { updateParcela } from '@/app/actions/minutas'
import { BrDateInput } from '@/components/bluedesk/BrDateInput'
import { brl, fmtDate, nomeCliente, todayBRT, type MinutaRow } from '../shared'

// Diálogo "Registrar pagamento" — PERGUNTA a data em vez de carimbar hoje.
//
// ⚠️ É a correção de um viés de relatório, não um refinamento de UX. Até 26/ago/2026 o ✓ da
// lista gravava `data_pagamento = hoje`, então a data no banco era "quando alguém clicou",
// não "quando a cliente pagou". Como o KPI "Pago na janela" (Visão Geral) e o filtro de
// período (Lista) recortam a parcela PAGA pela data de pagamento, uma parcela de junho que
// só foi marcada em agosto era contada em agosto: o mês fechava mostrando muito mais do que
// realmente saiu. Deixar a data editável na hora de marcar resolve na origem — o relatório
// passa a ler a data real.
//
// Hoje continua sendo o DEFAULT (é o caso comum: marcar no dia). O que mudou é que agora dá
// pra corrigir antes de gravar. Para consertar o que já foi gravado errado, a data também é
// editável no diálogo "Editar minuta".

export function MinutaPagamentoDialog({
  row,
  onClose,
  onSaved,
}: {
  row: MinutaRow | null
  onClose: () => void
  onSaved: () => void
}) {
  const [data, setData] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reabre sempre com a data já paga (se estiver corrigindo) ou hoje (caso comum).
  useEffect(() => {
    if (!row) return
    setData(row.parcela.dataPagamento ?? todayBRT())
    setError(null)
  }, [row])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!row) return
    if (!data) {
      setError('Informe a data em que o pagamento foi feito.')
      return
    }
    setSaving(true)
    const res = await updateParcela(row.parcela.id, { dataPagamento: data })
    setSaving(false)
    if (!res.ok) {
      setError(res.error ?? 'Não foi possível salvar. Tente novamente.')
      return
    }
    onSaved()
    onClose()
  }

  const hoje = todayBRT()
  const futura = data !== '' && data > hoje
  const antesDoVencimento =
    data !== '' && row?.parcela.vencimento != null && data < row.parcela.vencimento

  return (
    <Dialog open={row !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rounded-2xl border-border bg-gradient-card sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CircleDollarSign className="h-4 w-4 text-success" />
            Registrar pagamento
          </DialogTitle>
          <DialogDescription>
            {row
              ? `${nomeCliente(row.acordo)} · parcela ${row.parcela.num}/${row.acordo.parcelaTotal}${
                  row.parcela.valor == null ? '' : ` · ${brl(row.parcela.valor)}`
                }`
              : ''}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Data em que foi pago
            </label>
            <BrDateInput value={data} onChange={setData} aria-label="Data em que foi pago" />
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              É esta data que o relatório usa — não a de hoje. Se a parcela foi paga em outro
              mês, corrija aqui para o mês fechar certo.
              {row?.parcela.vencimento && <> Vencimento: {fmtDate(row.parcela.vencimento)}.</>}
            </p>
          </div>

          {/* Avisos, não bloqueios: pagamento antecipado é normal, e data futura pode ser um
              agendamento já confirmado. Quem decide é o jurídico. */}
          {futura && (
            <p className="text-xs text-warning">
              A data é no futuro — confira se o pagamento já aconteceu.
            </p>
          )}
          {antesDoVencimento && !futura && (
            <p className="text-xs text-muted-foreground">Pagamento antes do vencimento.</p>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter className="mt-1 gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border bg-background px-3.5 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving || !data}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-primary px-3.5 py-2 text-sm font-medium text-primary-foreground shadow-glow transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Confirmar pagamento
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
