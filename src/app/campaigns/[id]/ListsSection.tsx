'use client'

import { useState } from 'react'
import { Upload, Trash2, Plus, RefreshCw } from 'lucide-react'
import { createList, deleteList, getLists, updateListRecycle } from '@/app/actions/lists'
import { parseMailingFile, normalizePhone, slugify } from '@/lib/mailing'
import { cn } from '@/lib/utils'
import type { ContactStatus, List } from '@/lib/types/database'

const RECYCLE_OPTIONS: Array<{ value: ContactStatus; label: string }> = [
  { value: 'no_answer', label: 'Não atendeu' },
  { value: 'busy', label: 'Ocupado' },
  { value: 'failed', label: 'Falha' },
  // 'abandoned' = a própria discadora derrubou a linha (outra atendeu primeiro, ou o corte de
  // toque cortou antes da caixa postal). O contato nunca chegou a falar com ninguém, então é o
  // status MAIS reciclável de todos — vem marcado por padrão.
  { value: 'abandoned', label: 'Abandonada (derrubada pela discadora)' },
]

const PHONE_HINT = /tel|fone|phone|celular|whats|contato|numero|número/i
const NAME_HINT = /nome|name|cliente|raz/i

// estilo compartilhado para inputs/selects nativos
const fieldClass =
  'w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15'

interface ExtraField {
  column: string
  key: string
  label: string
  enabled: boolean
}

interface ImportResult {
  inserted: number
  duplicates: number
  invalid: number
  error?: string
}

interface Props {
  campaignId: string
  lists: List[]
  onListsChange: (lists: List[]) => void
}

export function ListsSection({ campaignId, lists, onListsChange }: Props) {
  const [configuring, setConfiguring] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState('')

  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<Record<string, string>[]>([])
  const [listName, setListName] = useState('')
  const [nameCol, setNameCol] = useState<string>('')
  const [phoneCol, setPhoneCol] = useState<string>('')
  const [extras, setExtras] = useState<ExtraField[]>([])

  const [recycleEnabled, setRecycleEnabled] = useState(false)
  const [recycleStatuses, setRecycleStatuses] = useState<ContactStatus[]>([
    'no_answer',
    'busy',
    'abandoned',
  ])
  const [afterHours, setAfterHours] = useState(24)
  const [maxAttempts, setMaxAttempts] = useState(3)

  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)

  // Edição da reciclagem de uma lista já existente (id da lista em edição + rascunho do form)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<{
    enabled: boolean
    statuses: ContactStatus[]
    hours: number
    attempts: number
  } | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)

  const openEdit = (l: List) => {
    setEditingId(l.id)
    setEditDraft({
      enabled: l.recycle_enabled,
      statuses: l.recycle_statuses ?? [],
      hours: l.recycle_after_hours,
      attempts: l.recycle_max_attempts,
    })
  }

  const saveEdit = async () => {
    if (!editingId || !editDraft) return
    setSavingEdit(true)
    await updateListRecycle(editingId, {
      recycle_enabled: editDraft.enabled,
      recycle_statuses: editDraft.statuses,
      recycle_after_hours: editDraft.hours,
      recycle_max_attempts: editDraft.attempts,
    })
    onListsChange(await getLists(campaignId))
    setSavingEdit(false)
    setEditingId(null)
    setEditDraft(null)
  }

  const resetForm = () => {
    setHeaders([])
    setRows([])
    setListName('')
    setNameCol('')
    setPhoneCol('')
    setExtras([])
    setRecycleEnabled(false)
    setRecycleStatuses(['no_answer', 'busy', 'abandoned'])
    setAfterHours(24)
    setMaxAttempts(3)
    setResult(null)
    setParseError('')
  }

  const handleFile = async (file: File) => {
    setParsing(true)
    setParseError('')
    setResult(null)
    try {
      const { headers: h, rows: r } = await parseMailingFile(file)
      if (h.length === 0 || r.length === 0) {
        setParseError('Arquivo vazio ou sem cabeçalho na primeira linha.')
        setParsing(false)
        return
      }
      const detectedPhone = h.find((x) => PHONE_HINT.test(x)) ?? ''
      const detectedName = h.find((x) => NAME_HINT.test(x)) ?? ''
      setHeaders(h)
      setRows(r)
      setPhoneCol(detectedPhone)
      setNameCol(detectedName)
      setExtras(
        h
          .filter((x) => x !== detectedPhone && x !== detectedName)
          .map((column) => ({ column, key: slugify(column), label: column, enabled: true }))
      )
      setListName(file.name.replace(/\.[^.]+$/, ''))
    } catch {
      setParseError('Não foi possível ler o arquivo. Use .csv ou .xlsx.')
    }
    setParsing(false)
  }

  const toggleStatus = (s: ContactStatus) =>
    setRecycleStatuses((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    )

  const updateExtra = (column: string, patch: Partial<ExtraField>) =>
    setExtras((prev) => prev.map((e) => (e.column === column ? { ...e, ...patch } : e)))

  const handleImport = async () => {
    if (!phoneCol || !listName.trim()) return
    setImporting(true)
    setResult(null)

    const enabledExtras = extras.filter((e) => e.enabled && e.key.trim())
    const contacts: Array<{ phone_number: string; name: string | null; extra_data: Record<string, string> }> = []
    let invalid = 0

    for (const row of rows) {
      const phone = normalizePhone(row[phoneCol])
      if (!phone) {
        invalid++
        continue
      }
      const name = nameCol ? row[nameCol]?.trim() || null : null
      const extra_data: Record<string, string> = {}
      for (const ex of enabledExtras) extra_data[ex.key] = row[ex.column] ?? ''
      contacts.push({ phone_number: phone, name, extra_data })
    }

    const res = await createList(
      campaignId,
      {
        name: listName.trim(),
        column_mapping: {
          name: nameCol || null,
          phone: phoneCol,
          extras: enabledExtras.map(({ key, label, column }) => ({ key, label, column })),
        },
        recycle_enabled: recycleEnabled,
        recycle_statuses: recycleEnabled ? recycleStatuses : [],
        recycle_after_hours: afterHours,
        recycle_max_attempts: maxAttempts,
      },
      contacts
    )

    setImporting(false)
    setResult({ inserted: res.inserted, duplicates: res.duplicates, invalid, error: res.error })

    if (!res.error) {
      onListsChange(await getLists(campaignId))
    }
  }

  const handleDelete = async (listId: string) => {
    const res = await deleteList(listId)
    if (!res.error) onListsChange(await getLists(campaignId))
  }

  // ─── Modo configuração (upload + mapeamento) ───────────────────────────────
  if (configuring) {
    const previewRows = rows.slice(0, 5)
    return (
      <section className="space-y-4 rounded-2xl border border-border bg-gradient-card p-5 shadow-card">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Nova lista</h2>
          <button
            onClick={() => {
              setConfiguring(false)
              resetForm()
            }}
            className="text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            Cancelar
          </button>
        </div>

        {/* Upload */}
        {headers.length === 0 ? (
          <div>
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border py-8 transition-colors hover:border-primary">
              <Upload className="h-7 w-7 text-muted-foreground/50" />
              <span className="text-sm font-medium text-foreground">
                {parsing ? 'Lendo arquivo...' : 'Selecionar arquivo .csv ou .xlsx'}
              </span>
              <span className="text-xs text-muted-foreground">
                Primeira linha deve conter os títulos das colunas
              </span>
              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
              />
            </label>
            {parseError && <p className="mt-2 text-xs text-destructive">{parseError}</p>}
          </div>
        ) : (
          <>
            {/* Nome da lista */}
            <div>
              <label className="mb-1.5 block text-xs text-muted-foreground">Nome da lista</label>
              <input
                type="text"
                value={listName}
                onChange={(e) => setListName(e.target.value)}
                className={fieldClass}
              />
            </div>

            {/* Preview */}
            <div>
              <p className="mb-2 text-xs text-muted-foreground">
                Prévia — {rows.length} linha{rows.length !== 1 ? 's' : ''}
              </p>
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-background/40 text-muted-foreground">
                      {headers.map((h) => (
                        <th key={h} className="whitespace-nowrap px-3 py-2 text-left font-medium">
                          {h || <span className="italic text-muted-foreground/60">sem título</span>}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {previewRows.map((r, i) => (
                      <tr key={i} className="text-foreground/80">
                        {headers.map((h) => (
                          <td key={h} className="whitespace-nowrap px-3 py-1.5">{r[h]}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Mapeamento */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-xs text-muted-foreground">Coluna do telefone *</label>
                <select value={phoneCol} onChange={(e) => setPhoneCol(e.target.value)} className={fieldClass}>
                  <option value="">Selecione…</option>
                  {headers.map((h) => (
                    <option key={h} value={h}>{h || '(sem título)'}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-xs text-muted-foreground">Coluna do nome</label>
                <select value={nameCol} onChange={(e) => setNameCol(e.target.value)} className={fieldClass}>
                  <option value="">(nenhuma)</option>
                  {headers.map((h) => (
                    <option key={h} value={h}>{h || '(sem título)'}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Campos extras */}
            {extras.length > 0 && (
              <div>
                <p className="mb-2 text-xs text-muted-foreground">
                  Campos adicionais (ficam disponíveis ao agente)
                </p>
                <div className="space-y-2">
                  {extras.map((ex) => (
                    <div key={ex.column} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={ex.enabled}
                        onChange={(e) => updateExtra(ex.column, { enabled: e.target.checked })}
                        className="h-4 w-4 shrink-0 accent-primary"
                      />
                      <span className="w-28 shrink-0 truncate text-xs text-muted-foreground">{ex.column}</span>
                      <span className="shrink-0 text-xs text-muted-foreground/60">→</span>
                      <input
                        type="text"
                        value={ex.label}
                        disabled={!ex.enabled}
                        onChange={(e) =>
                          updateExtra(ex.column, {
                            label: e.target.value,
                            key: slugify(e.target.value),
                          })
                        }
                        className="flex-1 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-xs text-foreground outline-none transition-colors focus:border-primary disabled:opacity-40"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Reciclagem */}
            <div className="border-t border-border pt-4">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={recycleEnabled}
                  onChange={(e) => setRecycleEnabled(e.target.checked)}
                  className="h-4 w-4 accent-primary"
                />
                <span className="text-sm font-medium text-foreground">Reciclar contatos</span>
              </label>
              <p className="ml-6 mt-1 text-xs text-muted-foreground">
                Recoloca na fila contatos com certos resultados, até um limite de tentativas.
              </p>

              {recycleEnabled && (
                <div className="ml-6 mt-3 space-y-3">
                  <div>
                    <p className="mb-1.5 text-xs text-muted-foreground">Reciclar quando o resultado for:</p>
                    <div className="flex flex-wrap gap-2">
                      {RECYCLE_OPTIONS.map((o) => {
                        const on = recycleStatuses.includes(o.value)
                        return (
                          <button
                            key={o.value}
                            onClick={() => toggleStatus(o.value)}
                            className={cn(
                              'rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
                              on
                                ? 'border-primary bg-primary text-primary-foreground'
                                : 'border-border bg-background/40 text-muted-foreground hover:text-foreground'
                            )}
                          >
                            {o.label}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <label className="mb-1.5 block text-xs text-muted-foreground">Esperar (horas)</label>
                      <input
                        type="number"
                        min={1}
                        value={afterHours}
                        onChange={(e) => setAfterHours(Math.max(1, Number(e.target.value)))}
                        className={fieldClass}
                      />
                    </div>
                    <div className="flex-1">
                      <label className="mb-1.5 block text-xs text-muted-foreground">Máx. tentativas</label>
                      <input
                        type="number"
                        min={1}
                        value={maxAttempts}
                        onChange={(e) => setMaxAttempts(Math.max(1, Number(e.target.value)))}
                        className={fieldClass}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Resultado / ação */}
            {result && (
              <div
                className={cn(
                  'rounded-xl border px-3 py-2.5 text-sm',
                  result.error
                    ? 'border-destructive/50 bg-destructive/10 text-destructive'
                    : 'border-success/40 bg-success/10 text-success'
                )}
              >
                {result.error ? (
                  <>Erro: {result.error} (inseridos: {result.inserted})</>
                ) : (
                  <>
                    ✓ {result.inserted} importados · {result.duplicates} duplicados ignorados ·{' '}
                    {result.invalid} inválidos
                  </>
                )}
              </div>
            )}

            <div className="flex gap-2">
              {result && !result.error ? (
                <button
                  onClick={() => {
                    setConfiguring(false)
                    resetForm()
                  }}
                  className="flex-1 rounded-xl bg-muted py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
                >
                  Concluir
                </button>
              ) : (
                <button
                  onClick={handleImport}
                  disabled={importing || !phoneCol || !listName.trim()}
                  className="flex-1 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
                >
                  {importing ? 'Importando...' : `Importar ${rows.length} contatos`}
                </button>
              )}
            </div>
          </>
        )}
      </section>
    )
  }

  // ─── Modo visualização (listas existentes) ─────────────────────────────────
  return (
    <section className="rounded-2xl border border-border bg-gradient-card p-5 shadow-card">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">Listas (mailing)</h2>
        <button
          onClick={() => setConfiguring(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Plus className="h-3.5 w-3.5" /> Adicionar lista
        </button>
      </div>

      {lists.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">
          Nenhuma lista. Suba um arquivo .csv/.xlsx para popular a campanha com contatos.
        </p>
      ) : (
        <div className="space-y-2">
          {lists.map((l) => (
            <div key={l.id} className="rounded-xl border border-border bg-background/40 px-4 py-3">
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{l.name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {l.recycle_enabled
                      ? `Reciclagem: ${l.recycle_statuses.length} status · até ${l.recycle_max_attempts}x`
                      : 'Sem reciclagem'}
                  </p>
                  {/* A discadora tabula sozinha como 'abandoned' (corte de toque / linha
                      derrubada). Sem esse status na reciclagem, o contato fica parado. */}
                  {l.recycle_enabled && !l.recycle_statuses.includes('abandoned') && (
                    <p className="mt-1 text-xs text-warning">
                      Não recicla <strong>abandonadas</strong> — contatos derrubados pela discadora
                      não voltam para a fila.
                    </p>
                  )}
                </div>
                <div className="ml-3 flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => (editingId === l.id ? setEditingId(null) : openEdit(l))}
                    title="Editar reciclagem"
                    className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
                  >
                    <RefreshCw className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(l.id)}
                    title="Excluir lista"
                    className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {editingId === l.id && editDraft && (
                <div className="mt-3 space-y-3 border-t border-border pt-3">
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={editDraft.enabled}
                      onChange={(e) => setEditDraft({ ...editDraft, enabled: e.target.checked })}
                      className="h-4 w-4 accent-primary"
                    />
                    <span className="text-sm font-medium text-foreground">Reciclar contatos</span>
                  </label>

                  {editDraft.enabled && (
                    <>
                      <div>
                        <p className="mb-1.5 text-xs text-muted-foreground">
                          Reciclar quando o resultado for:
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {RECYCLE_OPTIONS.map((o) => {
                            const on = editDraft.statuses.includes(o.value)
                            return (
                              <button
                                key={o.value}
                                onClick={() =>
                                  setEditDraft({
                                    ...editDraft,
                                    statuses: on
                                      ? editDraft.statuses.filter((x) => x !== o.value)
                                      : [...editDraft.statuses, o.value],
                                  })
                                }
                                className={cn(
                                  'rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
                                  on
                                    ? 'border-primary bg-primary text-primary-foreground'
                                    : 'border-border bg-background/40 text-muted-foreground hover:text-foreground'
                                )}
                              >
                                {o.label}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                      <div className="flex gap-3">
                        <div className="flex-1">
                          <label className="mb-1.5 block text-xs text-muted-foreground">
                            Esperar (horas)
                          </label>
                          <input
                            type="number"
                            min={1}
                            value={editDraft.hours}
                            onChange={(e) =>
                              setEditDraft({ ...editDraft, hours: Math.max(1, Number(e.target.value)) })
                            }
                            className={fieldClass}
                          />
                        </div>
                        <div className="flex-1">
                          <label className="mb-1.5 block text-xs text-muted-foreground">
                            Máx. tentativas
                          </label>
                          <input
                            type="number"
                            min={1}
                            value={editDraft.attempts}
                            onChange={(e) =>
                              setEditDraft({
                                ...editDraft,
                                attempts: Math.max(1, Number(e.target.value)),
                              })
                            }
                            className={fieldClass}
                          />
                        </div>
                      </div>
                    </>
                  )}

                  <div className="flex gap-2">
                    <button
                      onClick={saveEdit}
                      disabled={savingEdit}
                      className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                    >
                      {savingEdit ? 'Salvando…' : 'Salvar'}
                    </button>
                    <button
                      onClick={() => { setEditingId(null); setEditDraft(null) }}
                      className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
