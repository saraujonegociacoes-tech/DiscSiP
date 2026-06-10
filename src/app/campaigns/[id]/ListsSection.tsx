'use client'

import { useState } from 'react'
import { createList, deleteList, getLists } from '@/app/actions/lists'
import { parseMailingFile, normalizePhone, slugify } from '@/lib/mailing'
import type { ContactStatus, List } from '@/lib/types/database'

const RECYCLE_OPTIONS: Array<{ value: ContactStatus; label: string }> = [
  { value: 'no_answer', label: 'Não atendeu' },
  { value: 'busy', label: 'Ocupado' },
  { value: 'failed', label: 'Falha' },
]

const PHONE_HINT = /tel|fone|phone|celular|whats|contato|numero|número/i
const NAME_HINT = /nome|name|cliente|raz/i

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
  const [recycleStatuses, setRecycleStatuses] = useState<ContactStatus[]>(['no_answer', 'busy'])
  const [afterHours, setAfterHours] = useState(24)
  const [maxAttempts, setMaxAttempts] = useState(3)

  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)

  const resetForm = () => {
    setHeaders([])
    setRows([])
    setListName('')
    setNameCol('')
    setPhoneCol('')
    setExtras([])
    setRecycleEnabled(false)
    setRecycleStatuses(['no_answer', 'busy'])
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
      <section className="bg-[#1e293b] border border-slate-700/60 rounded-2xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-white text-sm font-medium">Nova lista</h2>
          <button
            onClick={() => {
              setConfiguring(false)
              resetForm()
            }}
            className="text-slate-400 hover:text-white text-xs transition-colors"
          >
            Cancelar
          </button>
        </div>

        {/* Upload */}
        {headers.length === 0 ? (
          <div>
            <label className="flex flex-col items-center justify-center gap-2 border border-dashed border-slate-600 rounded-xl py-8 cursor-pointer hover:border-blue-500 transition-colors">
              <span className="text-3xl opacity-30">⬆</span>
              <span className="text-slate-300 text-sm font-medium">
                {parsing ? 'Lendo arquivo...' : 'Selecionar arquivo .csv ou .xlsx'}
              </span>
              <span className="text-slate-600 text-xs">
                Primeira linha deve conter os títulos das colunas
              </span>
              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
              />
            </label>
            {parseError && <p className="text-red-400 text-xs mt-2">{parseError}</p>}
          </div>
        ) : (
          <>
            {/* Nome da lista */}
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Nome da lista</label>
              <input
                type="text"
                value={listName}
                onChange={(e) => setListName(e.target.value)}
                className="w-full bg-[#111827] border border-slate-600 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:border-blue-500 transition-colors text-sm"
              />
            </div>

            {/* Preview */}
            <div>
              <p className="text-xs text-slate-400 mb-2">
                Prévia — {rows.length} linha{rows.length !== 1 ? 's' : ''}
              </p>
              <div className="overflow-x-auto border border-slate-700 rounded-xl">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-[#111827] text-slate-400">
                      {headers.map((h) => (
                        <th key={h} className="text-left px-3 py-2 font-medium whitespace-nowrap">
                          {h || <span className="text-slate-600 italic">sem título</span>}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {previewRows.map((r, i) => (
                      <tr key={i} className="text-slate-300">
                        {headers.map((h) => (
                          <td key={h} className="px-3 py-1.5 whitespace-nowrap">{r[h]}</td>
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
                <label className="block text-xs text-slate-400 mb-1.5">
                  Coluna do telefone *
                </label>
                <select
                  value={phoneCol}
                  onChange={(e) => setPhoneCol(e.target.value)}
                  className="w-full bg-[#111827] border border-slate-600 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:border-blue-500 transition-colors text-sm"
                >
                  <option value="">Selecione…</option>
                  {headers.map((h) => (
                    <option key={h} value={h}>{h || '(sem título)'}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Coluna do nome</label>
                <select
                  value={nameCol}
                  onChange={(e) => setNameCol(e.target.value)}
                  className="w-full bg-[#111827] border border-slate-600 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:border-blue-500 transition-colors text-sm"
                >
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
                <p className="text-xs text-slate-400 mb-2">
                  Campos adicionais (ficam disponíveis ao agente)
                </p>
                <div className="space-y-2">
                  {extras.map((ex) => (
                    <div key={ex.column} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={ex.enabled}
                        onChange={(e) => updateExtra(ex.column, { enabled: e.target.checked })}
                        className="accent-blue-500 w-4 h-4 shrink-0"
                      />
                      <span className="text-slate-500 text-xs w-28 truncate shrink-0">{ex.column}</span>
                      <span className="text-slate-600 text-xs shrink-0">→</span>
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
                        className="flex-1 bg-[#111827] border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-xs focus:outline-none focus:border-blue-500 transition-colors disabled:opacity-40"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Reciclagem */}
            <div className="border-t border-slate-700/60 pt-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={recycleEnabled}
                  onChange={(e) => setRecycleEnabled(e.target.checked)}
                  className="accent-blue-500 w-4 h-4"
                />
                <span className="text-white text-sm font-medium">Reciclar contatos</span>
              </label>
              <p className="text-slate-500 text-xs mt-1 ml-6">
                Recoloca na fila contatos com certos resultados, até um limite de tentativas.
              </p>

              {recycleEnabled && (
                <div className="ml-6 mt-3 space-y-3">
                  <div>
                    <p className="text-xs text-slate-400 mb-1.5">Reciclar quando o resultado for:</p>
                    <div className="flex flex-wrap gap-2">
                      {RECYCLE_OPTIONS.map((o) => {
                        const on = recycleStatuses.includes(o.value)
                        return (
                          <button
                            key={o.value}
                            onClick={() => toggleStatus(o.value)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                              on
                                ? 'bg-blue-600 border-blue-500 text-white'
                                : 'bg-[#111827] border-slate-700 text-slate-400 hover:text-white'
                            }`}
                          >
                            {o.label}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <label className="block text-xs text-slate-400 mb-1.5">Esperar (horas)</label>
                      <input
                        type="number"
                        min={1}
                        value={afterHours}
                        onChange={(e) => setAfterHours(Math.max(1, Number(e.target.value)))}
                        className="w-full bg-[#111827] border border-slate-600 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500 transition-colors"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="block text-xs text-slate-400 mb-1.5">Máx. tentativas</label>
                      <input
                        type="number"
                        min={1}
                        value={maxAttempts}
                        onChange={(e) => setMaxAttempts(Math.max(1, Number(e.target.value)))}
                        className="w-full bg-[#111827] border border-slate-600 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500 transition-colors"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Resultado / ação */}
            {result && (
              <div
                className={`rounded-xl px-3 py-2.5 text-sm ${
                  result.error
                    ? 'bg-red-900/30 border border-red-700/50 text-red-300'
                    : 'bg-green-900/20 border border-green-700/40 text-green-300'
                }`}
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
                  className="flex-1 bg-slate-700 hover:bg-slate-600 text-white py-2.5 rounded-xl text-sm font-medium transition-colors"
                >
                  Concluir
                </button>
              ) : (
                <button
                  onClick={handleImport}
                  disabled={importing || !phoneCol || !listName.trim()}
                  className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 text-white py-2.5 rounded-xl text-sm font-semibold transition-colors"
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
    <section className="bg-[#1e293b] border border-slate-700/60 rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-white text-sm font-medium">Listas (mailing)</h2>
        <button
          onClick={() => setConfiguring(true)}
          className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
        >
          + Adicionar lista
        </button>
      </div>

      {lists.length === 0 ? (
        <p className="text-slate-500 text-sm py-2">
          Nenhuma lista. Suba um arquivo .csv/.xlsx para popular a campanha com contatos.
        </p>
      ) : (
        <div className="space-y-2">
          {lists.map((l) => (
            <div
              key={l.id}
              className="flex items-center justify-between bg-[#111827] border border-slate-800 rounded-xl px-4 py-3"
            >
              <div className="min-w-0">
                <p className="text-white text-sm font-medium truncate">{l.name}</p>
                <p className="text-slate-500 text-xs mt-0.5">
                  {l.recycle_enabled
                    ? `Reciclagem: ${l.recycle_statuses.length} status · até ${l.recycle_max_attempts}x`
                    : 'Sem reciclagem'}
                </p>
              </div>
              <button
                onClick={() => handleDelete(l.id)}
                className="text-slate-500 hover:text-red-400 text-xs transition-colors shrink-0 ml-3"
              >
                Excluir
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
