'use client'

import { useEffect, useState } from 'react'
import { Loader2, Plus, Trash2, Pencil } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  updateMinuta,
  updateParcela,
  addParcela,
  deleteParcela,
  type MinutaActionResult,
} from '@/app/actions/minutas'
import type { ProcAcordo, UpdateMinutaInput } from '@/lib/types/database'
import { BrDateInput } from '@/components/bluedesk/BrDateInput'
import { cn } from '@/lib/utils'
import { brl, moneyToInput, parseMoney, recorrenciaCurta } from '../shared'

// Diálogo "Editar minuta" — o que faltava pra corrigir dado já cadastrado.
//
// Duas seções, porque são duas coisas diferentes:
//   1. DADOS DA MINUTA (acordo): cliente, processo, título, dados bancários, PIX, observações.
//   2. PARCELAS: valor, vencimento, DATA DE PAGAMENTO e observação de cada uma, com acrescentar
//      e remover.
//
// ⚠️ Recorrência e nº de parcelas NÃO são editáveis aqui. Mudá-los significaria regerar o plano
// de pagamento, e regerar apaga `data_pagamento` — o histórico de quem já pagou. Quem precisa de
// mais (ou menos) parcelas usa "Acrescentar parcela" / a lixeira da linha, que mexem só na
// parcela pedida. O `parcela_total` do acordo é reacertado no servidor a cada uma dessas
// operações (ver syncParcelaTotal em app/actions/minutas.ts).
//
// Tudo é aplicado num "Salvar alterações" só: o rascunho vive no estado local até lá, então dá
// pra ajustar várias linhas e desistir sem ter gravado nada pela metade.

const inputCls =
  'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground shadow-card outline-none focus:border-primary disabled:opacity-50'
const cellCls =
  'w-full rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground outline-none focus:border-primary'
const labelCls = 'mb-1 block text-xs font-medium text-muted-foreground'

// Rascunho de uma parcela. `id: null` = linha nova, ainda não existe no banco.
type ParcelaDraft = {
  id: string | null
  key: string // estável entre renders (o id do banco, ou um id local pras novas)
  num: number | null // null enquanto o servidor não atribuiu (é ele quem escolhe o próximo livre)
  valor: string
  vencimento: string
  dataPagamento: string
  observacoes: string
}

function hydrate(acordo: ProcAcordo): ParcelaDraft[] {
  return [...acordo.parcelas]
    .sort((a, b) => a.num - b.num)
    .map((p) => ({
      id: p.id,
      key: p.id,
      num: p.num,
      valor: moneyToInput(p.valor),
      vencimento: p.vencimento ?? '',
      dataPagamento: p.dataPagamento ?? '',
      observacoes: p.observacoes ?? '',
    }))
}

export function MinutaEditDialog({
  acordo,
  onClose,
  onSaved,
}: {
  acordo: ProcAcordo | null
  onClose: () => void
  onSaved: () => void
}) {
  const [cliente, setCliente] = useState('')
  const [numeroProcesso, setNumeroProcesso] = useState('')
  const [titulo, setTitulo] = useState('')
  const [dadosBancarios, setDadosBancarios] = useState('')
  const [pix, setPix] = useState('')
  const [observacoes, setObservacoes] = useState('')
  const [parcelas, setParcelas] = useState<ParcelaDraft[]>([])
  const [removidas, setRemovidas] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Recarrega o rascunho a cada ABERTURA. A dependência é o id (que vira `undefined` quando o
  // diálogo fecha, então reabrir a mesma minuta também dispara): assim um refresh do painel-pai
  // enquanto o diálogo está aberto não apaga o que a pessoa está digitando.
  useEffect(() => {
    if (!acordo) return
    setCliente(acordo.cliente ?? '')
    setNumeroProcesso(acordo.numeroProcesso ?? '')
    setTitulo(acordo.titulo ?? '')
    setDadosBancarios(acordo.dadosBancarios ?? '')
    setPix(acordo.pix ?? '')
    setObservacoes(acordo.observacoes ?? '')
    setParcelas(hydrate(acordo))
    setRemovidas([])
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acordo?.id])

  function patchParcela(key: string, patch: Partial<ParcelaDraft>) {
    setParcelas((prev) => prev.map((p) => (p.key === key ? { ...p, ...patch } : p)))
  }

  function novaParcela() {
    setParcelas((prev) => [
      ...prev,
      {
        id: null,
        key: `nova-${Date.now()}-${prev.length}`,
        num: null,
        valor: moneyToInput(acordo?.valorParcela ?? null),
        vencimento: '',
        dataPagamento: '',
        observacoes: '',
      },
    ])
  }

  function removerParcela(d: ParcelaDraft) {
    // Linha nova nunca chegou ao banco: some sem confirmação. A que já existe carrega histórico.
    if (d.id && !window.confirm(`Remover a parcela ${d.num} desta minuta? Ação irreversível.`)) return
    setParcelas((prev) => prev.filter((p) => p.key !== d.key))
    if (d.id) setRemovidas((prev) => [...prev, d.id as string])
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!acordo) return
    if (!cliente.trim() && !titulo.trim()) {
      setError('Informe ao menos o nome da cliente ou um título.')
      return
    }
    setSaving(true)
    setError(null)

    const falhou = (r: MinutaActionResult) => !r.ok

    const input: UpdateMinutaInput = {
      cliente: cliente.trim(),
      numeroProcesso: numeroProcesso.trim(),
      titulo: titulo.trim(),
      observacoes: observacoes.trim(),
      dadosBancarios: dadosBancarios.trim(),
      pix: pix.trim(),
    }

    // Ordem: remove → atualiza → acrescenta. Remover primeiro deixa o `parcela_total` acertado
    // antes das inserções, e o número da nova parcela sai do maior que SOBROU.
    const results: MinutaActionResult[] = [await updateMinuta(acordo.id, input)]

    for (const id of removidas) results.push(await deleteParcela(id, acordo.id))

    const originais = new Map(acordo.parcelas.map((p) => [p.id, p]))
    for (const d of parcelas) {
      if (!d.id) continue
      const o = originais.get(d.id)
      if (!o) continue
      const valor = parseMoney(d.valor)
      const vencimento = d.vencimento || null
      const dataPagamento = d.dataPagamento || null
      const obs = d.observacoes.trim() || null
      // Só manda o que mudou de verdade — evita UPDATE inútil (e o updated_at do trigger).
      if (
        valor === o.valor &&
        vencimento === o.vencimento &&
        dataPagamento === o.dataPagamento &&
        obs === o.observacoes
      )
        continue
      results.push(await updateParcela(d.id, { valor, vencimento, dataPagamento, observacoes: obs }))
    }

    for (const d of parcelas) {
      if (d.id) continue
      results.push(
        await addParcela(acordo.id, {
          valor: parseMoney(d.valor),
          vencimento: d.vencimento || null,
          dataPagamento: d.dataPagamento || null,
          observacoes: d.observacoes.trim() || null,
        }),
      )
    }

    setSaving(false)
    const erro = results.find(falhou)
    if (erro) {
      // Parcial: parte pode ter gravado. Recarrega o painel pra tela mostrar o estado REAL.
      onSaved()
      setError(erro.error ?? 'Parte das alterações não foi salva. Confira a lista e tente de novo.')
      return
    }
    onSaved()
    onClose()
  }

  const totalParcelas = parcelas.length
  const somaValores = parcelas.reduce((a, p) => a + (parseMoney(p.valor) ?? 0), 0)

  return (
    <Dialog open={acordo !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto rounded-2xl border-border bg-gradient-card sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-4 w-4 text-primary" />
            Editar minuta
          </DialogTitle>
          <DialogDescription>
            Corrija os dados da minuta e das parcelas — inclusive a{' '}
            <span className="text-foreground">data em que cada parcela foi paga</span>.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* ── 1 · Dados da minuta ── */}
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className={labelCls}>Nome da cliente</label>
                <input className={inputCls} value={cliente} onChange={(e) => setCliente(e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Número do processo</label>
                <input
                  className={inputCls}
                  value={numeroProcesso}
                  onChange={(e) => setNumeroProcesso(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className={labelCls}>Título</label>
              <input className={inputCls} value={titulo} onChange={(e) => setTitulo(e.target.value)} />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className={labelCls}>Dados bancários (opcional)</label>
                <textarea
                  className={inputCls}
                  rows={2}
                  value={dadosBancarios}
                  onChange={(e) => setDadosBancarios(e.target.value)}
                  placeholder="Banco, agência, conta, favorecido"
                />
              </div>
              <div>
                <label className={labelCls}>Chave PIX (opcional)</label>
                <textarea
                  className={inputCls}
                  rows={2}
                  value={pix}
                  onChange={(e) => setPix(e.target.value)}
                  placeholder="CPF/CNPJ, e-mail, telefone ou chave aleatória"
                />
              </div>
            </div>

            <div>
              <label className={labelCls}>Observações</label>
              <textarea
                className={inputCls}
                rows={2}
                value={observacoes}
                onChange={(e) => setObservacoes(e.target.value)}
              />
            </div>

            {acordo && (
              <p className="text-[11px] text-muted-foreground">
                Recorrência: <span className="text-foreground">{recorrenciaCurta(acordo.recorrencia)}</span>
                {acordo.intervaloDias ? ` · ${acordo.intervaloDias} dias entre parcelas` : ''} — não é
                editável aqui: mudar a recorrência regeraria o plano e apagaria as datas de pagamento
                já registradas. Ajuste parcela a parcela abaixo.
              </p>
            )}
          </div>

          {/* ── 2 · Parcelas ── */}
          <div className="rounded-xl border border-border bg-background/50 p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-foreground">
                Parcelas{' '}
                <span className="font-normal text-muted-foreground">
                  · {totalParcelas} · {brl(somaValores)}
                </span>
              </h3>
              <button
                type="button"
                onClick={novaParcela}
                className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted"
              >
                <Plus className="h-3.5 w-3.5" />
                Acrescentar parcela
              </button>
            </div>

            {parcelas.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">
                Sem parcelas. Use “Acrescentar parcela”.
              </p>
            ) : (
              <div className="scrollbar-slim max-h-[320px] overflow-auto">
                <table className="w-full border-collapse text-xs">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-background/95 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground backdrop-blur">
                      <th scope="col" className="px-1.5 py-1.5 text-center">#</th>
                      <th scope="col" className="px-1.5 py-1.5 text-right">Valor</th>
                      <th scope="col" className="px-1.5 py-1.5 text-center">Vencimento</th>
                      <th scope="col" className="px-1.5 py-1.5 text-center">Pago em</th>
                      <th scope="col" className="px-1.5 py-1.5 text-left">Observações</th>
                      <th scope="col" className="px-1.5 py-1.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {parcelas.map((d) => (
                      <tr key={d.key} className="border-t border-border/60">
                        <td className="px-1.5 py-1 text-center tabular-nums text-muted-foreground">
                          {d.num ?? 'nova'}
                        </td>
                        <td className="px-1.5 py-1">
                          <input
                            className={cn(cellCls, 'w-24 text-right tabular-nums')}
                            inputMode="decimal"
                            value={d.valor}
                            onChange={(e) => patchParcela(d.key, { valor: e.target.value })}
                            aria-label={`Valor da parcela ${d.num ?? 'nova'}`}
                          />
                        </td>
                        <td className="px-1.5 py-1">
                          <BrDateInput
                            value={d.vencimento}
                            onChange={(v) => patchParcela(d.key, { vencimento: v })}
                            className="w-[6.75rem] px-2 py-1 text-xs"
                            aria-label={`Vencimento da parcela ${d.num ?? 'nova'}`}
                          />
                        </td>
                        <td className="px-1.5 py-1">
                          {/* Vazio = parcela em aberto; preenchido = paga NAQUELE dia. É esta
                              data que o KPI "Pago na janela" e o filtro de período leem. */}
                          <BrDateInput
                            value={d.dataPagamento}
                            onChange={(v) => patchParcela(d.key, { dataPagamento: v })}
                            className="w-[6.75rem] px-2 py-1 text-xs"
                            aria-label={`Data de pagamento da parcela ${d.num ?? 'nova'}`}
                          />
                        </td>
                        <td className="px-1.5 py-1">
                          <input
                            className={cellCls}
                            value={d.observacoes}
                            onChange={(e) => patchParcela(d.key, { observacoes: e.target.value })}
                            aria-label={`Observações da parcela ${d.num ?? 'nova'}`}
                          />
                        </td>
                        <td className="px-1.5 py-1 text-right">
                          <button
                            type="button"
                            onClick={() => removerParcela(d)}
                            title="Remover esta parcela"
                            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <p className="mt-2 text-[11px] text-muted-foreground">
              Deixe “Pago em” vazio para a parcela voltar a contar como em aberto. Nada é gravado
              antes de “Salvar alterações”.
            </p>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter className="gap-2">
            <button
              type="button"
              onClick={onClose}
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
              Salvar alterações
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
