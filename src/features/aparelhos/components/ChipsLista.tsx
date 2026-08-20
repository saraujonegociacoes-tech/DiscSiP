'use client'

import { useMemo, useState } from 'react'
import { Search, Signal } from 'lucide-react'
import { assignChip, deleteChip } from '@/app/actions/inventario'
import type { InvChip, InvChipTipo, InvInventarioData } from '@/lib/types/database'
import { cn } from '@/lib/utils'
import { TIPO_META, aparelhoDoChip, fmtNumero, nf, ouTraco, rotuloAparelho, slotsLivres } from '../shared'
import { ChipForm } from './ChipForm'
import {
  AcoesLinha,
  BarraDeControle,
  CabecalhoTabela,
  PainelTabela,
  RolagemTabela,
  Vazio,
  cabecalhos,
  ordenar,
  selectLinhaCls,
  useTableSort,
  type Col,
} from './tableKit'

// ABA 3 — cadastro dos chips. O vínculo com o aparelho troca direto na linha (é a
// operação do dia a dia: "esse chip foi pro celular novo"), e passa pela RPC
// inv_assign_chip, que escolhe o slot livre. Aparelho cheio aparece desabilitado
// com o motivo — mas quem recusa de fato é o banco.

type SortKey = 'numero' | 'operadora' | 'tipo' | 'aparelho'

type Filtro = 'todos' | InvChipTipo | 'avulsos'

const FILTROS: { key: Filtro; label: string }[] = [
  { key: 'todos', label: 'Todos' },
  { key: 'pos', label: 'Pós-pago' },
  { key: 'pre', label: 'Pré-pago' },
  { key: 'avulsos', label: 'Sem aparelho' },
]

export function ChipsLista({
  data,
  podeEscrever,
  onChanged,
}: {
  data: InvInventarioData
  podeEscrever: boolean
  onChanged: () => void
}) {
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [busca, setBusca] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const { sort, toggle } = useTableSort<SortKey>('numero')

  const COLS: Record<SortKey, Col<InvChip>> = useMemo(
    () => ({
      numero: { label: 'Número', kind: 'texto', get: (c) => c.numero.replace(/\D/g, '') },
      operadora: { label: 'Operadora', kind: 'texto', get: (c) => c.operadora },
      tipo: { label: 'Plano', align: 'center', kind: 'texto', get: (c) => TIPO_META[c.tipo].label },
      aparelho: {
        label: 'Aparelho',
        kind: 'texto',
        get: (c) => aparelhoDoChip(c, data.aparelhos)?.modelo ?? null,
      },
    }),
    [data.aparelhos],
  )

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    const digitos = termo.replace(/\D/g, '')

    let r = data.chips
    if (filtro === 'avulsos') r = r.filter((c) => c.aparelhoId === null)
    else if (filtro !== 'todos') r = r.filter((c) => c.tipo === filtro)

    // Busca por número ignora a máscara: quem digita "91234" tem que achar
    // "(11) 91234-5678" mesmo que o cadastro tenha sido feito sem formatação.
    if (termo) {
      r = r.filter((c) => {
        const aparelho = aparelhoDoChip(c, data.aparelhos)
        return (
          (digitos !== '' && c.numero.replace(/\D/g, '').includes(digitos)) ||
          (c.operadora ?? '').toLowerCase().includes(termo) ||
          (aparelho?.modelo ?? '').toLowerCase().includes(termo)
        )
      })
    }

    return ordenar(r, COLS, sort, (a, b) => a.numero.localeCompare(b.numero, 'pt-BR'))
  }, [data.chips, data.aparelhos, filtro, busca, sort, COLS])

  async function run(key: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(key)
    const res = await fn()
    setBusy(null)
    if (res.ok) onChanged()
    else if (res.error) window.alert(res.error)
  }

  function excluir(c: InvChip) {
    if (!window.confirm(`Excluir o chip ${fmtNumero(c.numero)}?\nAção irreversível.`)) return
    run(`del-${c.id}`, () => deleteChip(c.id))
  }

  const avulsos = data.chips.filter((c) => c.aparelhoId === null).length

  return (
    <div className="flex flex-col gap-4">
      <BarraDeControle>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-border bg-background/50 p-0.5" role="tablist" aria-label="Filtrar chips">
            {FILTROS.map((f) => (
              <button
                key={f.key}
                type="button"
                role="tab"
                aria-selected={filtro === f.key}
                onClick={() => setFiltro(f.key)}
                className={
                  filtro === f.key
                    ? 'rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground shadow-glow'
                    : 'rounded-md px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground'
                }
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Número, operadora ou aparelho"
              aria-label="Buscar chip"
              className="w-56 rounded-lg border border-border bg-background py-1.5 pl-8 pr-2.5 text-xs text-foreground shadow-card outline-none focus:border-primary"
            />
          </div>
        </div>

        {podeEscrever && <ChipForm aparelhos={data.aparelhos} onSalvo={onChanged} />}
      </BarraDeControle>

      {data.chips.length === 0 ? (
        <Vazio icone={Signal}>
          Nenhum chip cadastrado ainda.
          {podeEscrever ? (
            <>
              {' '}
              Clique em <span className="text-foreground">Novo chip</span> para começar.
            </>
          ) : (
            ' Peça a um gerente ou admin para cadastrar.'
          )}
        </Vazio>
      ) : (
        <PainelTabela
          titulo="Chips"
          resumo={`${nf(filtrados.length)} de ${nf(data.chips.length)}${avulsos ? ` · ${nf(avulsos)} sem aparelho` : ''}`}
          rodape={
            podeEscrever
              ? 'O aparelho troca direto na linha. Cada aparelho aceita no máximo 2 chips — os cheios aparecem desabilitados na lista, e o próprio banco recusa um terceiro.'
              : 'Somente leitura — cadastro e alterações são de gerente/admin.'
          }
        >
          {filtrados.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Nenhum chip neste recorte.</p>
          ) : (
            <RolagemTabela>
              <CabecalhoTabela>
                {cabecalhos(COLS, ['numero', 'operadora', 'tipo', 'aparelho'], sort, toggle)}
                <th scope="col" className="px-3 py-2 text-right">
                  Ações
                </th>
              </CabecalhoTabela>
              <tbody>
                {filtrados.map((c) => {
                  const t = TIPO_META[c.tipo]
                  const linhaBusy = busy?.endsWith(c.id) ?? false
                  return (
                    <tr key={c.id} className={cn('border-t border-border/60 hover:bg-primary/5', linhaBusy && 'opacity-50')}>
                      <th scope="row" className="px-3 py-1.5 text-left font-mono text-xs font-medium text-foreground">
                        {fmtNumero(c.numero)}
                        {c.observacoes && (
                          <span className="block max-w-[200px] truncate font-sans text-[10px] font-normal text-muted-foreground">
                            {c.observacoes}
                          </span>
                        )}
                      </th>
                      <td className="px-3 py-1.5 text-xs text-muted-foreground">{ouTraco(c.operadora)}</td>
                      <td className="px-3 py-1.5 text-center">
                        <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium', t.chip)}>
                          {t.label}
                        </span>
                      </td>
                      <td className="px-3 py-1.5">
                        <select
                          value={c.aparelhoId ?? ''}
                          disabled={!podeEscrever || linhaBusy}
                          aria-label={`Aparelho do chip ${fmtNumero(c.numero)}`}
                          onChange={(e) => run(`ap-${c.id}`, () => assignChip(c.id, e.target.value || null))}
                          className={selectLinhaCls}
                        >
                          <option value="">Sem aparelho vinculado</option>
                          {data.aparelhos.map((a) => {
                            const atual = c.aparelhoId === a.id
                            const cheio = !atual && slotsLivres(a) === 0
                            return (
                              <option key={a.id} value={a.id} disabled={cheio}>
                                {rotuloAparelho(a)}
                                {cheio ? ' — já tem 2 chips' : ''}
                              </option>
                            )
                          })}
                        </select>
                        {c.slot && <span className="ml-2 text-[10px] text-muted-foreground">slot {c.slot}</span>}
                      </td>
                      <td className="px-3 py-1.5">
                        <AcoesLinha
                          podeEscrever={podeEscrever}
                          editar={<ChipForm chip={c} aparelhos={data.aparelhos} onSalvo={onChanged} />}
                          onExcluir={() => excluir(c)}
                          excluindo={busy === `del-${c.id}`}
                          tituloExcluir="Excluir chip"
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </RolagemTabela>
          )}
        </PainelTabela>
      )}
    </div>
  )
}
