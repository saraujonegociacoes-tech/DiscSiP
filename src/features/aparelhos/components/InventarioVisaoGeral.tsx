'use client'

import { useMemo } from 'react'
import { Download, Signal, Smartphone, SmartphoneNfc, Users } from 'lucide-react'
import { KpiCard } from '@/components/bluedesk/KpiCard'
import { downloadCsv, type CsvValue } from '@/lib/csv'
import type { InvAparelho, InvInventarioData } from '@/lib/types/database'
import { cn } from '@/lib/utils'
import {
  STATUS_META,
  STATUS_ORDEM,
  TIPO_META,
  fmtImei,
  fmtNumero,
  nf,
  ocupacaoSlots,
  ouTraco,
  pessoaDoAparelho,
  todayBRT,
} from '../shared'
import { CabecalhoTabela, PainelTabela, RolagemTabela, Vazio } from './tableKit'

// ABA 1 — a foto do parque: quatro KPIs e uma linha por APARELHO com responsável,
// os dois chips e o status. É a única aba de leitura pura (as outras três são
// cadastro), e é a que responde "quem está com o quê" sem precisar cruzar abas.
//
// Ordenação FIXA por urgência (manutenção → estoque → em uso, depois modelo), sem
// clique no cabeçalho: aqui a pergunta é "o que precisa de atenção", e as abas de
// cadastro é que existem pra procurar um registro específico.

/**
 * Ocupação dos dois slots do aparelho. No arquivo original isto eram barrinhas de
 * sinal de celular com cor fixa; aqui é o mesmo dado com os tokens do tema — dois
 * traços, o cheio marcando slot ocupado. Lê igual de rápido e funciona nos dois temas.
 */
function Slots({ aparelho }: { aparelho: InvAparelho }) {
  const [s1, s2] = ocupacaoSlots(aparelho)
  const n = aparelho.chips.length
  return (
    <span
      className="inline-flex items-center gap-1"
      title={n === 0 ? 'Sem chip' : `${n} chip(s) de 2`}
      aria-label={n === 0 ? 'Sem chip' : `${n} de 2 slots ocupados`}
    >
      <span className={cn('block h-3 w-1 rounded-full', s1 ? 'bg-primary' : 'bg-border')} />
      <span className={cn('block h-3 w-1 rounded-full', s2 ? 'bg-primary' : 'bg-border')} />
    </span>
  )
}

/** Uma célula "Chip N": número + plano + operadora, ou travessão quando o slot está livre. */
function CelulaChip({ aparelho, slot }: { aparelho: InvAparelho; slot: 1 | 2 }) {
  const chip = aparelho.chips.find((c) => c.slot === slot)
  if (!chip) return <span className="text-muted-foreground">—</span>
  const t = TIPO_META[chip.tipo]
  return (
    <div className="flex flex-col gap-0.5">
      <span className="flex items-center gap-1.5">
        <span className="font-mono text-xs text-foreground">{fmtNumero(chip.numero)}</span>
        <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-medium', t.chip)}>{t.label}</span>
      </span>
      <span className="text-[10px] text-muted-foreground">{ouTraco(chip.operadora)}</span>
    </div>
  )
}

export function InventarioVisaoGeral({ data }: { data: InvInventarioData }) {
  const linhas = useMemo(
    () =>
      [...data.aparelhos].sort((a, b) => {
        const d = STATUS_ORDEM[a.status] - STATUS_ORDEM[b.status]
        return d !== 0 ? d : a.modelo.localeCompare(b.modelo, 'pt-BR')
      }),
    [data.aparelhos],
  )

  const kpis = useMemo(() => {
    const semChip = data.aparelhos.filter((a) => a.chips.length === 0).length
    const chipsAvulsos = data.chips.filter((c) => c.aparelhoId === null).length
    return {
      aparelhos: data.aparelhos.length,
      chips: data.chips.length,
      pessoas: data.pessoas.length,
      semChip,
      chipsAvulsos,
      emUso: data.aparelhos.filter((a) => a.status === 'em_uso').length,
      manutencao: data.aparelhos.filter((a) => a.status === 'manutencao').length,
    }
  }, [data])

  // O CSV sai com uma linha por APARELHO e os dois chips em colunas — mesmo recorte
  // da tabela, que é como a planilha do inventário é conferida. Usa o escritor
  // compartilhado (lib/csv.ts): separador `;`, BOM UTF-8, aspas só quando precisa.
  function exportar() {
    const head = [
      'Modelo', 'IMEI', 'Responsável', 'Departamento',
      'Chip 1 - Número', 'Chip 1 - Operadora', 'Chip 1 - Plano',
      'Chip 2 - Número', 'Chip 2 - Operadora', 'Chip 2 - Plano',
      'Status', 'Observações',
    ]
    const rows: CsvValue[][] = linhas.map((a) => {
      const pessoa = pessoaDoAparelho(a, data.pessoas)
      const c1 = a.chips.find((c) => c.slot === 1)
      const c2 = a.chips.find((c) => c.slot === 2)
      return [
        a.modelo,
        a.imei ?? '',
        pessoa?.nome ?? '',
        pessoa?.departamento ?? '',
        c1 ? fmtNumero(c1.numero) : '',
        c1?.operadora ?? '',
        c1 ? TIPO_META[c1.tipo].label : '',
        c2 ? fmtNumero(c2.numero) : '',
        c2?.operadora ?? '',
        c2 ? TIPO_META[c2.tipo].label : '',
        STATUS_META[a.status].label,
        a.observacoes ?? '',
      ]
    })
    downloadCsv(`inventario-aparelhos-${todayBRT()}`, head, rows)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label="Aparelhos"
          value={nf(kpis.aparelhos)}
          icon={Smartphone}
          delta={kpis.aparelhos > 0 ? { value: `${nf(kpis.emUso)} em uso`, positive: true } : undefined}
        />
        <KpiCard
          label="Chips"
          value={nf(kpis.chips)}
          icon={Signal}
          delta={kpis.chipsAvulsos > 0 ? { value: `${nf(kpis.chipsAvulsos)} sem aparelho`, positive: false } : undefined}
        />
        <KpiCard label="Pessoas" value={nf(kpis.pessoas)} icon={Users} />
        {/* "Sem chip" é o KPI acionável do painel: aparelho sem linha é aparelho
            que não serve pra nada até alguém resolver. */}
        <KpiCard
          label="Sem chip"
          value={nf(kpis.semChip)}
          icon={SmartphoneNfc}
          delta={
            kpis.manutencao > 0 ? { value: `${nf(kpis.manutencao)} em manutenção`, positive: false } : undefined
          }
        />
      </div>

      {data.aparelhos.length === 0 ? (
        <Vazio icone={Smartphone}>
          Inventário vazio. Cadastre as <span className="text-foreground">pessoas</span>, depois os{' '}
          <span className="text-foreground">aparelhos</span> e os{' '}
          <span className="text-foreground">chips</span> nas abas ao lado.
        </Vazio>
      ) : (
        <PainelTabela
          titulo="Visão geral"
          resumo={`${nf(data.aparelhos.length)} aparelho(s)`}
          rodape="Uma linha por aparelho, com os dois slots de chip. Ordem fixa: manutenção primeiro, depois estoque, depois em uso — o que precisa de atenção fica no topo."
        >
          <div className="mb-3 flex justify-end">
            <button
              type="button"
              onClick={exportar}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background/60 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-background"
            >
              <Download className="h-3.5 w-3.5" />
              Exportar CSV
            </button>
          </div>

          <RolagemTabela>
            <CabecalhoTabela>
              <th scope="col" className="w-8 px-3 py-2" aria-label="Slots de chip ocupados" />
              <th scope="col" className="px-3 py-2 text-left">Aparelho</th>
              <th scope="col" className="px-3 py-2 text-left">Responsável</th>
              <th scope="col" className="px-3 py-2 text-left">Chip 1</th>
              <th scope="col" className="px-3 py-2 text-left">Chip 2</th>
              <th scope="col" className="px-3 py-2 text-center">Status</th>
            </CabecalhoTabela>
            <tbody>
              {linhas.map((a) => {
                const pessoa = pessoaDoAparelho(a, data.pessoas)
                const s = STATUS_META[a.status]
                return (
                  <tr key={a.id} className="border-t border-border/60 hover:bg-primary/5">
                    <td className="px-3 py-2">
                      <Slots aparelho={a} />
                    </td>
                    <th scope="row" className="max-w-[200px] px-3 py-2 text-left text-xs font-medium text-foreground">
                      <span className="block truncate" title={a.modelo}>{a.modelo}</span>
                      <span className="block truncate font-mono text-[10px] font-normal text-muted-foreground">
                        {a.imei ? fmtImei(a.imei) : 'sem IMEI'}
                      </span>
                    </th>
                    <td className="max-w-[180px] px-3 py-2 text-xs">
                      {pessoa ? (
                        <>
                          <span className="block truncate text-foreground" title={pessoa.nome}>{pessoa.nome}</span>
                          {pessoa.departamento && (
                            <span className="block truncate text-[10px] text-muted-foreground">
                              {pessoa.departamento}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-muted-foreground">Sem responsável (estoque)</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <CelulaChip aparelho={a} slot={1} />
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <CelulaChip aparelho={a} slot={2} />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', s.chip)}>
                        <span className={cn('h-1.5 w-1.5 rounded-full', s.dot)} />
                        {s.label}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </RolagemTabela>
        </PainelTabela>
      )}
    </div>
  )
}
