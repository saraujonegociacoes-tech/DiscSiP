'use client'

import { useMemo, useState } from 'react'
import { Search, Smartphone } from 'lucide-react'
import { deleteAparelho, patchAparelho } from '@/app/actions/inventario'
import type { InvAparelho, InvInventarioData, InvStatus } from '@/lib/types/database'
import { cn } from '@/lib/utils'
import {
  STATUS_META,
  STATUS_OPCOES,
  STATUS_ORDEM,
  fmtImei,
  nf,
  ouTraco,
  pessoaDoAparelho,
} from '../shared'
import { AparelhoForm } from './AparelhoForm'
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

// ABA 2 — cadastro dos aparelhos. Responsável e status trocam DIRETO na linha
// (select), sem abrir o formulário: são as duas alterações do dia a dia ("fulano
// saiu, o celular voltou pro estoque"), e obrigar a abrir um diálogo para isso
// transformaria a tarefa mais comum na mais lenta. Modelo, IMEI e observações,
// que quase não mudam, ficam no formulário de edição.

type SortKey = 'modelo' | 'imei' | 'responsavel' | 'status' | 'chips'

const FILTROS: { key: InvStatus | 'todos'; label: string }[] = [
  { key: 'todos', label: 'Todos' },
  { key: 'em_uso', label: 'Em uso' },
  { key: 'estoque', label: 'Estoque' },
  { key: 'manutencao', label: 'Manutenção' },
]

export function AparelhosLista({
  data,
  podeEscrever,
  onChanged,
}: {
  data: InvInventarioData
  podeEscrever: boolean
  onChanged: () => void
}) {
  const [filtro, setFiltro] = useState<InvStatus | 'todos'>('todos')
  const [busca, setBusca] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const { sort, toggle } = useTableSort<SortKey>('modelo')

  const COLS: Record<SortKey, Col<InvAparelho>> = useMemo(
    () => ({
      modelo: { label: 'Modelo', kind: 'texto', get: (a) => a.modelo },
      imei: { label: 'IMEI', kind: 'texto', get: (a) => a.imei },
      responsavel: {
        label: 'Responsável',
        kind: 'texto',
        get: (a) => pessoaDoAparelho(a, data.pessoas)?.nome ?? null,
      },
      status: { label: 'Status', align: 'center', kind: 'texto', get: (a) => STATUS_ORDEM[a.status] },
      chips: { label: 'Chips', align: 'center', kind: 'numero', get: (a) => a.chips.length },
    }),
    [data.pessoas],
  )

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    let r = filtro === 'todos' ? data.aparelhos : data.aparelhos.filter((a) => a.status === filtro)

    // A busca varre modelo, IMEI e responsável de uma vez: quem procura um aparelho
    // tem na mão um desses três, e não sabe de antemão qual coluna consultar.
    if (termo) {
      r = r.filter((a) => {
        const pessoa = pessoaDoAparelho(a, data.pessoas)
        return (
          a.modelo.toLowerCase().includes(termo) ||
          (a.imei ?? '').toLowerCase().includes(termo) ||
          (pessoa?.nome ?? '').toLowerCase().includes(termo)
        )
      })
    }

    return ordenar(r, COLS, sort, (a, b) => a.modelo.localeCompare(b.modelo, 'pt-BR'))
  }, [data.aparelhos, data.pessoas, filtro, busca, sort, COLS])

  async function run(key: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(key)
    const res = await fn()
    setBusy(null)
    if (res.ok) onChanged()
    else if (res.error) window.alert(res.error)
  }

  function excluir(a: InvAparelho) {
    const aviso = a.chips.length
      ? `\nOs ${a.chips.length} chip(s) vinculados continuam cadastrados, mas ficam sem aparelho.`
      : ''
    if (!window.confirm(`Excluir o aparelho "${a.modelo}"?${aviso}\nAção irreversível.`)) return
    run(`del-${a.id}`, () => deleteAparelho(a.id))
  }

  return (
    <div className="flex flex-col gap-4">
      <BarraDeControle>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-border bg-background/50 p-0.5" role="tablist" aria-label="Filtrar por status">
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
              placeholder="Modelo, IMEI ou responsável"
              aria-label="Buscar aparelho"
              className="w-56 rounded-lg border border-border bg-background py-1.5 pl-8 pr-2.5 text-xs text-foreground shadow-card outline-none focus:border-primary"
            />
          </div>
        </div>

        {podeEscrever && <AparelhoForm pessoas={data.pessoas} onSalvo={onChanged} />}
      </BarraDeControle>

      {data.aparelhos.length === 0 ? (
        <Vazio icone={Smartphone}>
          Nenhum aparelho cadastrado ainda.
          {podeEscrever ? (
            <>
              {' '}
              Clique em <span className="text-foreground">Novo aparelho</span> para começar.
            </>
          ) : (
            ' Peça a um gerente ou admin para cadastrar.'
          )}
        </Vazio>
      ) : (
        <PainelTabela
          titulo="Aparelhos"
          resumo={`${nf(filtrados.length)} de ${nf(data.aparelhos.length)}`}
          rodape={
            podeEscrever
              ? 'Responsável e status trocam direto na linha. O lápis edita modelo, IMEI e observações; a lixeira exclui o aparelho (os chips ficam soltos, não são apagados).'
              : 'Somente leitura — cadastro e alterações são de gerente/admin.'
          }
        >
          {filtrados.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Nenhum aparelho neste recorte.</p>
          ) : (
            <RolagemTabela>
              <CabecalhoTabela>
                {cabecalhos(COLS, ['modelo', 'imei', 'responsavel', 'status', 'chips'], sort, toggle)}
                <th scope="col" className="px-3 py-2 text-right">
                  Ações
                </th>
              </CabecalhoTabela>
              <tbody>
                {filtrados.map((a) => {
                  const linhaBusy = busy?.endsWith(a.id) ?? false
                  return (
                    <tr key={a.id} className={cn('border-t border-border/60 hover:bg-primary/5', linhaBusy && 'opacity-50')}>
                      <th scope="row" className="max-w-[220px] truncate px-3 py-1.5 text-left text-xs font-medium text-foreground" title={a.modelo}>
                        {a.modelo}
                        {a.observacoes && (
                          <span className="block truncate text-[10px] font-normal text-muted-foreground">{a.observacoes}</span>
                        )}
                      </th>
                      <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground">{fmtImei(a.imei)}</td>
                      <td className="px-3 py-1.5">
                        <select
                          value={a.pessoaId ?? ''}
                          disabled={!podeEscrever || linhaBusy}
                          aria-label={`Responsável por ${a.modelo}`}
                          onChange={(e) => run(`pes-${a.id}`, () => patchAparelho(a.id, { pessoaId: e.target.value || null }))}
                          className={selectLinhaCls}
                        >
                          <option value="">Sem responsável (estoque)</option>
                          {data.pessoas.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.nome}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-1.5 text-center">
                        <select
                          value={a.status}
                          disabled={!podeEscrever || linhaBusy}
                          aria-label={`Status de ${a.modelo}`}
                          onChange={(e) => run(`sta-${a.id}`, () => patchAparelho(a.id, { status: e.target.value as InvStatus }))}
                          className={selectLinhaCls}
                        >
                          {STATUS_OPCOES.map((s) => (
                            <option key={s} value={s}>
                              {STATUS_META[s].label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-1.5 text-center text-xs tabular-nums text-muted-foreground">
                        {a.chips.length}/2
                        {a.chips.length > 0 && (
                          <span className="ml-1 hidden text-[10px] sm:inline">
                            · {a.chips.map((c) => ouTraco(c.operadora)).join(', ')}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-1.5">
                        <AcoesLinha
                          podeEscrever={podeEscrever}
                          editar={<AparelhoForm aparelho={a} pessoas={data.pessoas} onSalvo={onChanged} />}
                          onExcluir={() => excluir(a)}
                          excluindo={busy === `del-${a.id}`}
                          tituloExcluir="Excluir aparelho"
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
