'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import { Users, Wallet, TrendingUp, Building2, Loader2, AlertTriangle, Check, Pencil } from 'lucide-react'
import { KpiCard } from '@/components/bluedesk/KpiCard'
import { CeoPeriodPicker, type CeoPeriodMode } from './CeoPeriodPicker'
import { currentCivilMonth, type LeadPeriod } from '@/lib/period'
import { getCeoSaudeEquipe, setCeoCustoGeral, setCeoPessoaCusto } from '@/app/actions/ceo'
import { cn } from '@/lib/utils'
import type { CeoSaudeEquipeData, CeoSaudeDepartamento, CeoSaudePessoa } from '@/lib/types/database'

// ABA 3 do painel do CEO — SAÚDE DA EQUIPE.
// Fonte: get_ceo_saude_empresa v2 (20260805b_saude_custos.sql).
//
// A aba responde UMA pergunta: quanto cada departamento e cada pessoa coloca para dentro,
// contra quanto custam. Por isso saíram os cartões de TI e de Discador da v1 — nenhum dos
// dois responde "quanto essa pessoa trouxe", que é o conceito da aba (decisão do dono,
// 05/ago).
//
// ⚠️ Ela se chamava "Saúde da Empresa" e era a Sprint 3; a Sprint 4 seria uma aba separada
// "Saúde da Equipe", por pessoa. Ao virar receita/custo por PESSOA, esta aba passou a ser o
// que a Sprint 4 seria — o dono fundiu as duas em 06/ago e a aba placeholder saiu.
// A RPC manteve o nome antigo (`get_ceo_saude_empresa`) de propósito: renomear exigiria
// outra migration em objeto já aplicado, e este projeto já se queimou com isso.
//
// O que a Sprint 4 previa e ficou de fora: atividade por pessoa de Leads/CS/Monday/Discador.
// Só 9 das 30 pessoas do Financeiro cruzam com aqueles cadastros (medido em 06/ago) — viraria
// coluna vazia em 2 de cada 3 linhas.
//
// A receita vem do MESMO `fin_entries` da aba Financeiro, quebrada pelo campo "Vendedor"
// do pipe. As duas abas não podem divergir sobre dinheiro.
//
// ⚠️ A linha "sem vendedor" existe porque a soma das pessoas NÃO fecha com o total em
// período antigo: só 28% dos cards do histórico têm o campo preenchido (94% do valor de
// 2026, 100% de julho). Um total que não bate sem explicação é pior que um total menor
// com a diferença nomeada.

const brl = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 })
const brl0 = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
const nf = (n: number) => n.toLocaleString('pt-BR')

// Campo de dinheiro que aceita o que o usuário digita em pt-BR ("4.200,00" ou "4200").
// Devolve null quando vazio — e null tem significado: apaga o custo próprio da pessoa,
// que volta a herdar o geral.
function parseBrl(s: string): number | null {
  const t = s.trim()
  if (t === '') return null
  const n = Number(t.replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) && n >= 0 ? n : null
}

/** Campo de custo com salvar embutido. Só re-renderiza a si mesmo enquanto edita. */
function CustoInput({
  valor,
  herdado,
  onSave,
  compact,
}: {
  valor: number
  /** true = está usando o custo geral, não tem custo próprio cadastrado. */
  herdado?: boolean
  onSave: (v: number | null) => Promise<void>
  compact?: boolean
}) {
  const [editando, setEditando] = useState(false)
  const [txt, setTxt] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [ok, setOk] = useState(false)

  async function salvar() {
    setSalvando(true)
    await onSave(parseBrl(txt))
    setSalvando(false)
    setEditando(false)
    setOk(true)
    setTimeout(() => setOk(false), 1500)
  }

  if (!editando) {
    return (
      <button
        type="button"
        onClick={() => {
          setTxt(valor ? String(valor).replace('.', ',') : '')
          setEditando(true)
        }}
        className={cn(
          'group inline-flex items-center gap-1.5 rounded-lg px-2 py-1 tabular-nums transition-colors hover:bg-primary/10',
          compact ? 'text-xs' : 'text-sm',
          herdado ? 'text-muted-foreground' : 'text-foreground',
        )}
        title={herdado ? 'Herdando o custo geral — clique para definir um próprio' : 'Clique para editar'}
      >
        {brl(valor)}
        {herdado && <span className="text-[10px] uppercase tracking-wide">(geral)</span>}
        {ok ? (
          <Check className="h-3 w-3 text-success" />
        ) : (
          <Pencil className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-60" />
        )}
      </button>
    )
  }

  return (
    <span className="inline-flex items-center gap-1">
      <input
        autoFocus
        value={txt}
        onChange={(e) => setTxt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void salvar()
          if (e.key === 'Escape') setEditando(false)
        }}
        placeholder="0,00"
        inputMode="decimal"
        className={cn(
          'w-28 rounded-lg border border-primary bg-background px-2 py-1 tabular-nums text-foreground outline-none',
          compact ? 'text-xs' : 'text-sm',
        )}
        aria-label="Custo mensal"
      />
      <button
        type="button"
        onClick={() => void salvar()}
        disabled={salvando}
        className="rounded-lg bg-gradient-primary px-2 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
      >
        {salvando ? '…' : 'ok'}
      </button>
    </span>
  )
}

/** Cartão de um departamento: o total dele, separado dos outros. */
function DeptCard({ d, ativo, onClick }: { d: CeoSaudeDepartamento; ativo: boolean; onClick: () => void }) {
  const positiva = d.margem >= 0
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group relative overflow-hidden rounded-2xl border p-5 text-left shadow-card transition-all lift',
        ativo ? 'border-primary bg-gradient-card ring-1 ring-primary/40' : 'border-border bg-gradient-card',
      )}
    >
      <div className="pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full bg-primary/15 blur-3xl" />
      <div className="relative flex items-start justify-between gap-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {d.nome.replace(/^Departamento - /, '')}
        </div>
        <div className="rounded-xl bg-gradient-primary p-2 text-primary-foreground shadow-glow">
          <Building2 className="h-4 w-4" />
        </div>
      </div>

      <div className="relative mt-3 text-3xl font-semibold tracking-tight text-foreground">
        {brl0(d.margem)}
      </div>
      <div className="relative text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Margem</div>

      <dl className="relative mt-4 grid grid-cols-2 gap-2 border-t border-border/60 pt-3">
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Receita</dt>
          <dd className="mt-0.5 text-sm font-medium tabular-nums text-foreground">{brl0(d.receita)}</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Custo</dt>
          <dd className="mt-0.5 text-sm font-medium tabular-nums text-foreground">{brl0(d.custo)}</dd>
        </div>
      </dl>

      <p
        className={cn(
          'relative mt-3 text-[11px]',
          positiva ? 'text-muted-foreground' : 'text-destructive',
        )}
      >
        {nf(d.pessoas)} {d.pessoas === 1 ? 'pessoa' : 'pessoas'} · {nf(d.pagamentos)}{' '}
        {d.pagamentos === 1 ? 'pagamento' : 'pagamentos'}
        {!positiva && ' · margem negativa'}
      </p>
    </button>
  )
}

/** Lista de pessoas de um departamento, com o custo editável na própria linha. */
function PessoasDoDepto({
  d,
  onSaveCusto,
}: {
  d: CeoSaudeDepartamento
  onSaveCusto: (pessoa: string, v: number | null) => Promise<void>
}) {
  const maxReceita = Math.max(...d.people.map((p) => Math.abs(p.receita)), 1)
  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-card p-5 shadow-card">
      <div className="pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full bg-primary/10 blur-3xl" />
      <div className="relative mb-4 flex items-center gap-2">
        <Users className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">
          {d.nome.replace(/^Departamento - /, '')} — por pessoa
        </h3>
      </div>

      <div className="relative -mx-2 overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
              <th className="px-2 pb-2 text-left font-medium">Pessoa</th>
              <th className="px-2 pb-2 text-right font-medium">Receita</th>
              <th className="px-2 pb-2 text-right font-medium">Custo/mês</th>
              <th className="px-2 pb-2 text-right font-medium">Margem</th>
            </tr>
          </thead>
          <tbody>
            {d.people.map((p: CeoSaudePessoa) => (
              <tr key={p.nome} className="border-t border-border/50">
                <td className="px-2 py-2">
                  <div className="truncate text-foreground" title={p.nome}>
                    {p.nome}
                  </div>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-background/60">
                    <div
                      className="h-full rounded-full bg-gradient-primary"
                      style={{ width: `${(Math.abs(p.receita) / maxReceita) * 100}%` }}
                    />
                  </div>
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-foreground">{brl(p.receita)}</td>
                <td className="px-2 py-2 text-right">
                  <CustoInput
                    compact
                    valor={p.custo}
                    herdado={!p.custoProprio}
                    onSave={(v) => onSaveCusto(p.nome, v)}
                  />
                </td>
                <td
                  className={cn(
                    'px-2 py-2 text-right font-medium tabular-nums',
                    p.margem >= 0 ? 'text-foreground' : 'text-destructive',
                  )}
                >
                  {brl(p.margem)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* O custo mostrado aqui já vem rateado; sem dizer isso, um salário de R$ 4.200
          aparecendo como R$ 2.100 em dois departamentos parece erro. */}
      <p className="relative mt-3 text-[11px] text-muted-foreground">
        O custo é mensal e chega aqui já ajustado ao período. Quem atende mais de um
        departamento tem o custo dividido entre eles na proporção da receita — o mesmo salário
        não é cobrado duas vezes.
      </p>
    </div>
  )
}

export function CeoSaudeEquipe() {
  const [mode, setMode] = useState<CeoPeriodMode>('mes')
  const [period, setPeriod] = useState<LeadPeriod>(() => currentCivilMonth())
  const [data, setData] = useState<CeoSaudeEquipeData | null>(null)
  const [loading, setLoading] = useState(true)
  const [aberto, setAberto] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  const carregar = useCallback(
    (p: LeadPeriod) => {
      setLoading(true)
      getCeoSaudeEquipe(p)
        .then(setData)
        .catch(() => {
          // A action já degrada pra vazio; aqui só evitamos rejeição solta.
        })
        .finally(() => setLoading(false))
    },
    [],
  )

  useEffect(() => {
    carregar(period)
  }, [period, carregar])

  // Depois de gravar custo, recarrega: a margem de todo mundo pode mudar (o custo geral
  // vale para quem não tem o próprio, e o rateio depende da receita).
  const salvarGeral = useCallback(
    async (v: number | null) => {
      await setCeoCustoGeral(v ?? 0)
      startTransition(() => carregar(period))
    },
    [period, carregar],
  )

  const salvarPessoa = useCallback(
    async (pessoa: string, v: number | null) => {
      await setCeoPessoaCusto(pessoa, v)
      startTransition(() => carregar(period))
    },
    [period, carregar],
  )

  const deptos = data?.departamentos ?? []
  const deptoAberto = deptos.find((d) => d.nome === aberto) ?? null
  const totais = data?.totais
  const margem = (totais?.receita ?? 0) - (totais?.custo ?? 0)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Saúde da equipe</h2>
          <p className="text-xs text-muted-foreground">
            Quanto cada departamento e cada pessoa coloca para dentro, contra quanto custam.
          </p>
        </div>
        <CeoPeriodPicker
          value={period}
          mode={mode}
          disabled={loading}
          onChange={(p, m) => {
            setMode(m)
            setPeriod(p)
          }}
        />
      </div>

      {loading && !data ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-border bg-gradient-card py-16 text-sm text-muted-foreground shadow-card">
          <Loader2 className="h-4 w-4 animate-spin" />
          Compondo receita e custo…
        </div>
      ) : (
        data && (
          <div className={cn('space-y-6', loading && 'opacity-60')}>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <KpiCard label="Receita no período" value={brl0(totais?.receita ?? 0)} icon={Wallet} />
              <KpiCard label="Custo no período" value={brl0(totais?.custo ?? 0)} icon={Users} />
              <KpiCard
                label="Margem"
                value={brl0(margem)}
                icon={TrendingUp}
                delta={
                  (totais?.receita ?? 0) > 0
                    ? {
                        value: `${((margem / (totais?.receita ?? 1)) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% da receita`,
                        positive: margem >= 0,
                      }
                    : undefined
                }
              />
              <KpiCard label="Pessoas" value={nf(totais?.pessoas ?? 0)} icon={Building2} />
            </div>

            {/* Custo geral — o valor que vale para quem não tem custo próprio. */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-border bg-gradient-card px-5 py-4 shadow-card">
              <span className="text-sm font-semibold text-foreground">Custo geral padrão</span>
              <CustoInput valor={data.custoGeral} onSave={salvarGeral} />
              <span className="text-xs text-muted-foreground">
                por mês, aplicado a quem não tem custo próprio
                {(totais?.semCusto ?? 0) > 0 && (
                  <>
                    {' '}
                    — hoje são <strong className="text-foreground">{nf(totais?.semCusto ?? 0)}</strong> de{' '}
                    {nf(totais?.pessoas ?? 0)} pessoas
                  </>
                )}
                . Fator do período: {data.fatorMes.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}×
              </span>
            </div>

            {data.custoGeral === 0 && (totais?.semCusto ?? 0) > 0 && (
              <p className="rounded-2xl border border-warning/30 bg-warning/5 px-5 py-3 text-xs text-warning">
                <AlertTriangle className="mr-1.5 inline h-3.5 w-3.5" />
                O custo geral está em R$ 0,00, então a margem de{' '}
                {nf(totais?.semCusto ?? 0)} pessoas é igual à receita delas. Defina o custo geral
                acima, ou o custo de cada uma na tabela, para a margem significar alguma coisa.
              </p>
            )}

            {/* Cartões de departamento — um separado do outro. Clicar abre a lista de
                pessoas daquele departamento logo abaixo. */}
            {deptos.length === 0 ? (
              <p className="rounded-2xl border border-border bg-gradient-card px-5 py-4 text-xs text-muted-foreground shadow-card">
                Nenhuma receita com vendedor identificado neste período.
              </p>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {deptos.map((d) => (
                    <DeptCard
                      key={d.nome}
                      d={d}
                      ativo={aberto === d.nome}
                      onClick={() => setAberto(aberto === d.nome ? null : d.nome)}
                    />
                  ))}
                </div>

                {/* Individual por pessoa. Sem departamento selecionado, mostra todos —
                    clicar num cartão acima filtra para aquele. */}
                <div className="space-y-4">
                  {(deptoAberto ? [deptoAberto] : deptos).map((d) => (
                    <PessoasDoDepto key={d.nome} d={d} onSaveCusto={salvarPessoa} />
                  ))}
                </div>
              </>
            )}

            {/* A diferença entre o total do Financeiro e a soma das pessoas, nomeada. */}
            {data.semVendedor.receita !== 0 && (
              <p className="rounded-2xl border border-border bg-gradient-card px-5 py-4 text-xs text-muted-foreground shadow-card">
                <strong className="text-foreground">{brl(data.semVendedor.receita)}</strong> em{' '}
                {nf(data.semVendedor.pagamentos)}{' '}
                {data.semVendedor.pagamentos === 1 ? 'pagamento' : 'pagamentos'} não têm vendedor
                preenchido no Pipefy e por isso não aparecem em nenhuma pessoa acima. Eles{' '}
                <strong className="text-foreground">estão</strong> na receita total e na aba
                Financeiro — é a diferença entre os dois números.
              </p>
            )}
          </div>
        )
      )}
    </div>
  )
}
