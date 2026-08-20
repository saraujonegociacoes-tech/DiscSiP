'use client'

import { useMemo, useState } from 'react'
import { BadgeCheck, Search, Users } from 'lucide-react'
import { deletePessoa } from '@/app/actions/inventario'
import type { InvInventarioData, InvPessoa } from '@/lib/types/database'
import { cn } from '@/lib/utils'
import { aparelhosDaPessoa, nf, ouTraco } from '../shared'
import { PessoaForm } from './PessoaForm'
import {
  AcoesLinha,
  BarraDeControle,
  CabecalhoTabela,
  PainelTabela,
  RolagemTabela,
  Vazio,
  cabecalhos,
  ordenar,
  useTableSort,
  type Col,
} from './tableKit'

// ABA 4 — quem pode ficar responsável por um aparelho. Lista PRÓPRIA do inventário,
// não `profiles`: quem tem celular da empresa nem sempre usa o Blue Desk. Quando
// usa, o vínculo opcional aparece com o selo ao lado do nome.

type SortKey = 'nome' | 'departamento' | 'usuario' | 'aparelhos'

export function PessoasLista({
  data,
  podeEscrever,
  onChanged,
}: {
  data: InvInventarioData
  podeEscrever: boolean
  onChanged: () => void
}) {
  const [busca, setBusca] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const { sort, toggle } = useTableSort<SortKey>('nome')

  const COLS: Record<SortKey, Col<InvPessoa>> = useMemo(
    () => ({
      nome: { label: 'Nome', kind: 'texto', get: (p) => p.nome },
      departamento: { label: 'Departamento', kind: 'texto', get: (p) => p.departamento },
      usuario: { label: 'Usuário do Blue Desk', kind: 'texto', get: (p) => p.profileNome },
      aparelhos: {
        label: 'Aparelhos',
        align: 'center',
        kind: 'numero',
        get: (p) => aparelhosDaPessoa(p.id, data.aparelhos).length,
      },
    }),
    [data.aparelhos],
  )

  const filtradas = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    let r = data.pessoas
    if (termo) {
      r = r.filter(
        (p) =>
          p.nome.toLowerCase().includes(termo) || (p.departamento ?? '').toLowerCase().includes(termo),
      )
    }
    return ordenar(r, COLS, sort, (a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
  }, [data.pessoas, busca, sort, COLS])

  async function run(key: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(key)
    const res = await fn()
    setBusy(null)
    if (res.ok) onChanged()
    else if (res.error) window.alert(res.error)
  }

  function excluir(p: InvPessoa) {
    const meus = aparelhosDaPessoa(p.id, data.aparelhos)
    const aviso = meus.length
      ? `\nOs ${meus.length} aparelho(s) sob responsabilidade dela ficam sem responsável (não são apagados).`
      : ''
    if (!window.confirm(`Excluir "${p.nome}" do inventário?${aviso}\nAção irreversível.`)) return
    run(`del-${p.id}`, () => deletePessoa(p.id))
  }

  return (
    <div className="flex flex-col gap-4">
      <BarraDeControle>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Nome ou departamento"
            aria-label="Buscar pessoa"
            className="w-56 rounded-lg border border-border bg-background py-1.5 pl-8 pr-2.5 text-xs text-foreground shadow-card outline-none focus:border-primary"
          />
        </div>

        {podeEscrever && (
          <PessoaForm pessoas={data.pessoas} profiles={data.profiles} onSalvo={onChanged} />
        )}
      </BarraDeControle>

      {data.pessoas.length === 0 ? (
        <Vazio icone={Users}>
          Nenhuma pessoa cadastrada ainda.
          {podeEscrever ? (
            <>
              {' '}
              Comece por aqui: sem pessoas, os aparelhos só podem ficar em estoque.
            </>
          ) : (
            ' Peça a um gerente ou admin para cadastrar.'
          )}
        </Vazio>
      ) : (
        <PainelTabela
          titulo="Pessoas"
          resumo={`${nf(filtradas.length)} de ${nf(data.pessoas.length)}`}
          rodape={
            podeEscrever
              ? 'Excluir uma pessoa não apaga os aparelhos dela — eles voltam a ficar sem responsável, que é o que de fato acontece quando alguém sai.'
              : 'Somente leitura — cadastro e alterações são de gerente/admin.'
          }
        >
          {filtradas.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Nenhuma pessoa neste recorte.</p>
          ) : (
            <RolagemTabela>
              <CabecalhoTabela>
                {cabecalhos(COLS, ['nome', 'departamento', 'usuario', 'aparelhos'], sort, toggle)}
                <th scope="col" className="px-3 py-2 text-right">
                  Ações
                </th>
              </CabecalhoTabela>
              <tbody>
                {filtradas.map((p) => {
                  const meus = aparelhosDaPessoa(p.id, data.aparelhos)
                  const linhaBusy = busy === `del-${p.id}`
                  return (
                    <tr key={p.id} className={cn('border-t border-border/60 hover:bg-primary/5', linhaBusy && 'opacity-50')}>
                      <th scope="row" className="max-w-[220px] truncate px-3 py-1.5 text-left text-xs font-medium text-foreground" title={p.nome}>
                        {p.nome}
                        {p.observacoes && (
                          <span className="block truncate text-[10px] font-normal text-muted-foreground">{p.observacoes}</span>
                        )}
                      </th>
                      <td className="px-3 py-1.5 text-xs text-muted-foreground">{ouTraco(p.departamento)}</td>
                      <td className="px-3 py-1.5 text-xs text-muted-foreground">
                        {p.profileNome ? (
                          <span className="inline-flex items-center gap-1 text-primary">
                            <BadgeCheck className="h-3.5 w-3.5 shrink-0" aria-hidden />
                            {p.profileNome}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-center text-xs tabular-nums text-muted-foreground">
                        {meus.length === 0 ? (
                          '—'
                        ) : (
                          <span title={meus.map((a) => a.modelo).join(', ')}>
                            {meus.length}
                            <span className="ml-1 hidden text-[10px] sm:inline">
                              · {meus.map((a) => a.modelo).join(', ')}
                            </span>
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-1.5">
                        <AcoesLinha
                          podeEscrever={podeEscrever}
                          editar={
                            <PessoaForm
                              pessoa={p}
                              pessoas={data.pessoas}
                              profiles={data.profiles}
                              onSalvo={onChanged}
                            />
                          }
                          onExcluir={() => excluir(p)}
                          excluindo={linhaBusy}
                          tituloExcluir="Excluir pessoa"
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
