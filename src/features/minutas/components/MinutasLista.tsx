'use client'

import { useMemo, useState } from 'react'
import { Download, FileText, Check, RotateCcw, Trash2, Loader2 } from 'lucide-react'
import { updateParcela, deleteMinuta } from '@/app/actions/minutas'
import type { ProcMinutasData, ProcParcelaStatus } from '@/lib/types/database'
import { cn } from '@/lib/utils'
import {
  brl,
  nf,
  fmtDate,
  todayBRT,
  recorrenciaCurta,
  nomeCliente,
  dueLabel,
  STATUS_META,
  flattenRows,
  type MinutaRow,
} from '../shared'
import { MinutaForm } from './MinutaForm'

// PÁGINA 3 — controle/CRUD das minutas. Uma linha por PARCELA (achatado de acordo×parcela),
// com filtro por situação, marcação de pagamento, exclusão da minuta e export CSV. É o hub de
// edição; as outras abas (Visão Geral, Calendário) são leitura.

type StatusFilter = 'todas' | ProcParcelaStatus
const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: 'pendente', label: 'A pagar' },
  { key: 'pago', label: 'Pagas' },
  { key: 'vencida', label: 'Vencidas' },
  { key: 'todas', label: 'Todas' },
]

export function MinutasLista({ data, onChanged }: { data: ProcMinutasData; onChanged: () => void }) {
  const [status, setStatus] = useState<StatusFilter>('pendente')
  const [busy, setBusy] = useState<string | null>(null)

  const rows = useMemo(() => flattenRows(data.acordos), [data])

  const filtered = useMemo(() => {
    const r = status === 'todas' ? rows : rows.filter((x) => x.parcela.status === status)
    // ordena por vencimento (nulos por último), depois por cliente
    return [...r].sort((a, b) => {
      const av = a.parcela.vencimento ?? '9999-12-31'
      const bv = b.parcela.vencimento ?? '9999-12-31'
      if (av !== bv) return av < bv ? -1 : 1
      return nomeCliente(a.acordo).localeCompare(nomeCliente(b.acordo), 'pt-BR')
    })
  }, [rows, status])

  const totalValor = useMemo(
    () => filtered.reduce((acc, r) => acc + (r.parcela.valor ?? 0), 0),
    [filtered],
  )

  async function run(key: string, fn: () => Promise<{ ok: boolean }>) {
    setBusy(key)
    const res = await fn()
    setBusy(null)
    if (res.ok) onChanged()
  }

  function togglePago(r: MinutaRow) {
    const next = r.parcela.status === 'pago' ? null : todayBRT()
    run(`pay-${r.parcela.id}`, () => updateParcela(r.parcela.id, { dataPagamento: next }))
  }

  function excluir(r: MinutaRow) {
    const totalParc = r.acordo.parcelas.length
    const ok = window.confirm(
      `Excluir a minuta "${nomeCliente(r.acordo)}"?\nIsso remove o acordo e suas ${totalParc} parcela(s). Ação irreversível.`,
    )
    if (!ok) return
    run(`del-${r.acordo.id}`, () => deleteMinuta(r.acordo.id))
  }

  function exportCsv() {
    const head = [
      'Cliente', 'Número do processo', 'Título', 'Recorrência', 'Parcela', 'Total parcelas',
      'Valor', 'Vencimento', 'Data de pagamento', 'Situação', 'Observações',
    ]
    const cell = (v: string | number) => {
      const s = String(v ?? '')
      return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const lines = filtered.map((r) =>
      [
        nomeCliente(r.acordo),
        r.acordo.numeroProcesso ?? '',
        r.acordo.titulo ?? '',
        recorrenciaCurta(r.acordo.recorrencia),
        r.parcela.num,
        r.acordo.parcelaTotal,
        r.parcela.valor ?? '',
        fmtDate(r.parcela.vencimento),
        fmtDate(r.parcela.dataPagamento),
        STATUS_META[r.parcela.status].label,
        r.parcela.observacoes ?? '',
      ]
        .map(cell)
        .join(';'),
    )
    const csv = '﻿' + [head.map(cell).join(';'), ...lines].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `minutas-processuais-${todayBRT()}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Barra de controle */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-gradient-card p-3 shadow-card">
        <div
          className="inline-flex rounded-lg border border-border bg-background/50 p-0.5"
          role="tablist"
          aria-label="Filtrar por situação"
        >
          {STATUS_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={status === t.key}
              onClick={() => setStatus(t.key)}
              className={
                status === t.key
                  ? 'rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground shadow-glow'
                  : 'rounded-md px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground'
              }
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={exportCsv}
            disabled={filtered.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background/60 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-background disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" />
            Exportar
          </button>
          <MinutaForm onCreated={onChanged} />
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-border bg-gradient-card p-10 text-center shadow-card">
          <FileText className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            Nenhuma minuta cadastrada ainda. Clique em <span className="text-foreground">Nova minuta</span> para começar.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-gradient-card p-4 shadow-elevated">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-foreground">
              Minutas <span className="font-normal text-muted-foreground">· {STATUS_TABS.find((t) => t.key === status)?.label}</span>
            </h2>
            <span className="text-xs tabular-nums text-muted-foreground">
              {nf(filtered.length)} parcela(s) · {brl(totalValor)}
            </span>
          </div>

          {filtered.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Sem parcelas neste recorte.</p>
          ) : (
            <div className="scrollbar-slim max-h-[600px] overflow-auto rounded-xl border border-border">
              <table className="w-full border-collapse text-sm">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-background/95 backdrop-blur text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <th scope="col" className="px-3 py-2 text-left">Cliente</th>
                    <th scope="col" className="px-3 py-2 text-left">Processo</th>
                    <th scope="col" className="px-3 py-2 text-left">Recorrência</th>
                    <th scope="col" className="px-3 py-2 text-center">Parcela</th>
                    <th scope="col" className="px-3 py-2 text-right">Valor</th>
                    <th scope="col" className="px-3 py-2 text-center">Vencimento</th>
                    <th scope="col" className="px-3 py-2 text-center">Pagamento</th>
                    <th scope="col" className="px-3 py-2 text-center">Situação</th>
                    <th scope="col" className="px-3 py-2 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => {
                    const s = STATUS_META[r.parcela.status]
                    const rowBusy = busy === `pay-${r.parcela.id}` || busy === `del-${r.acordo.id}`
                    return (
                      <tr key={r.parcela.id} className={cn('border-t border-border/60 hover:bg-primary/5', rowBusy && 'opacity-50')}>
                        <th scope="row" className="max-w-[200px] truncate px-3 py-1.5 text-left text-xs font-medium text-foreground" title={nomeCliente(r.acordo)}>
                          {nomeCliente(r.acordo)}
                          {r.acordo.titulo && r.acordo.cliente && (
                            <span className="block truncate text-[10px] font-normal text-muted-foreground">{r.acordo.titulo}</span>
                          )}
                        </th>
                        <td className="max-w-[160px] truncate px-3 py-1.5 text-xs text-muted-foreground" title={r.acordo.numeroProcesso ?? undefined}>
                          {r.acordo.numeroProcesso ?? '—'}
                        </td>
                        <td className="px-3 py-1.5 text-xs text-muted-foreground">{recorrenciaCurta(r.acordo.recorrencia)}</td>
                        <td className="px-3 py-1.5 text-center text-xs tabular-nums text-muted-foreground">
                          {r.parcela.num}/{r.acordo.parcelaTotal}
                        </td>
                        <td className="px-3 py-1.5 text-right text-xs tabular-nums text-foreground">
                          {r.parcela.valor == null ? '—' : brl(r.parcela.valor)}
                        </td>
                        <td className="px-3 py-1.5 text-center text-xs tabular-nums text-muted-foreground" title={dueLabel(r.parcela.daysToDue)}>
                          {fmtDate(r.parcela.vencimento)}
                        </td>
                        <td className="px-3 py-1.5 text-center text-xs tabular-nums text-muted-foreground">
                          {fmtDate(r.parcela.dataPagamento)}
                        </td>
                        <td className="px-3 py-1.5 text-center">
                          <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', s.chip)}>
                            <span className={cn('h-1.5 w-1.5 rounded-full', s.dot)} />
                            {s.label}
                          </span>
                        </td>
                        <td className="px-3 py-1.5">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => togglePago(r)}
                              disabled={rowBusy}
                              title={r.parcela.status === 'pago' ? 'Estornar pagamento' : 'Marcar como paga (hoje)'}
                              className={cn(
                                'rounded-md p-1.5 transition-colors',
                                r.parcela.status === 'pago'
                                  ? 'text-muted-foreground hover:bg-muted hover:text-foreground'
                                  : 'text-success hover:bg-success/10',
                              )}
                            >
                              {busy === `pay-${r.parcela.id}` ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : r.parcela.status === 'pago' ? (
                                <RotateCcw className="h-3.5 w-3.5" />
                              ) : (
                                <Check className="h-3.5 w-3.5" />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => excluir(r)}
                              disabled={rowBusy}
                              title="Excluir minuta (acordo + parcelas)"
                              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                            >
                              {busy === `del-${r.acordo.id}` ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Trash2 className="h-3.5 w-3.5" />
                              )}
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          <p className="mt-2 text-[11px] text-muted-foreground">
            Uma linha por parcela. ✓ marca a parcela como paga (hoje) · ↺ estorna · 🗑 exclui a minuta
            inteira. Cadastre novas minutas em “Nova minuta”.
          </p>
        </div>
      )}
    </div>
  )
}
