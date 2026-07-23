'use client'

import { useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Play, FlaskConical, Radio, Timer, CalendarRange, Square } from 'lucide-react'
import { AppShell } from '@/components/blueline/AppShell'
import { PageHeader } from '@/components/blueline/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { NumbersConfigSection } from './NumbersConfigSection'
import { TemplatesSection } from './TemplatesSection'
import { HistoryTable } from './HistoryTable'
import {
  updateWarmupSettings,
  runWarmupTickManually,
  startWarmupSession,
  stopWarmupSession,
} from '@/app/actions/warmup'
import type { TickSummary } from '@/lib/warmup/tick'
import type {
  WarmupNumber,
  WarmupSettings,
  WarmupMode,
  WarmupTemplate,
  WarmupMessage,
  WarmupNumberStats,
} from '@/lib/types/database'

type Tab = 'numbers' | 'templates' | 'history'

interface Props {
  initialNumbers: WarmupNumber[]
  initialSettings: WarmupSettings
  initialTemplates: WarmupTemplate[]
  stats: Record<string, WarmupNumberStats>
  initialHistory: WarmupMessage[]
  historyHasMore: boolean
}

export function WarmupDashboardClient({
  initialNumbers,
  initialSettings,
  initialTemplates,
  stats,
  initialHistory,
  historyHasMore,
}: Props) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('numbers')
  const [settings, setSettings] = useState(initialSettings)
  const [running, setRunning] = useState(false)
  const [summary, setSummary] = useState<TickSummary | null>(null)
  const [error, setError] = useState('')

  const patchSettings = async (patch: Partial<WarmupSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }))
    await updateWarmupSettings(patch)
    router.refresh()
  }

  const handleStartSession = async () => {
    setSettings((prev) => ({ ...prev, sessao_iniciada_em: new Date().toISOString() }))
    await startWarmupSession()
    router.refresh()
  }

  const handleStopSession = async () => {
    setSettings((prev) => ({ ...prev, sessao_iniciada_em: null }))
    await stopWarmupSession()
    router.refresh()
  }

  // Estado da sessão (modo 'sessao').
  const sessaoInicio = settings.sessao_iniciada_em ? new Date(settings.sessao_iniciada_em) : null
  const sessaoFim = sessaoInicio
    ? new Date(sessaoInicio.getTime() + settings.sessao_duracao_horas * 3_600_000)
    : null
  const sessaoAtiva = !!(sessaoFim && sessaoFim.getTime() > Date.now())
  const horasRestantes = sessaoFim
    ? Math.max(0, Math.round(((sessaoFim.getTime() - Date.now()) / 3_600_000) * 10) / 10)
    : 0

  const handleRunTick = async () => {
    setRunning(true)
    setError('')
    setSummary(null)
    const result = await runWarmupTickManually()
    setRunning(false)
    if ('error' in result) {
      setError(result.error)
      return
    }
    setSummary(result)
    router.refresh()
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'numbers', label: 'Números' },
    { id: 'templates', label: 'Mensagens' },
    { id: 'history', label: 'Histórico' },
  ]

  return (
    <AppShell>
      <PageHeader
        title="Aquecimento WhatsApp"
        description="Números novos conversam entre si para construir reputação antes das campanhas de disparo."
      />

      {/* Barra de controle */}
      <div className="mb-6 space-y-4 rounded-2xl border border-border bg-gradient-card p-4 shadow-card">
        {/* Linha 1: liga/desliga o envio real + seletor de modo + rodada de teste */}
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            {settings.dry_run ? (
              <FlaskConical className="h-4 w-4 text-warning" />
            ) : (
              <Radio className="h-4 w-4 text-success" />
            )}
            <span className="text-sm font-medium text-foreground">
              {settings.dry_run ? 'Simulador do Warmup' : 'Warmup Ativado'}
            </span>
            <Switch
              checked={!settings.dry_run}
              onCheckedChange={(v) => patchSettings({ dry_run: !v })}
              aria-label="Ativar o Warmup (enviar de verdade) ou usar o Simulador"
            />
            <span className="text-xs text-muted-foreground">
              {settings.dry_run ? '(nada é enviado — só ensaia)' : '(envia mensagens de verdade)'}
            </span>
          </div>

          {/* Seletor de modo */}
          <div className="flex items-center gap-1 rounded-xl border border-border bg-card p-1">
            {(
              [
                { id: 'sessao', label: 'Sessão (24h)', icon: Timer },
                { id: 'gradual', label: 'Gradual (dias)', icon: CalendarRange },
              ] as { id: WarmupMode; label: string; icon: typeof Timer }[]
            ).map((m) => (
              <button
                key={m.id}
                onClick={() => patchSettings({ warmup_mode: m.id })}
                className={cn(
                  'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                  settings.warmup_mode === m.id
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent/40'
                )}
              >
                <m.icon className="h-3.5 w-3.5" />
                {m.label}
              </button>
            ))}
          </div>

          <div className="ml-auto flex items-center gap-3">
            {summary && (
              <span className="text-xs text-muted-foreground">
                Rodada: {summary.sent} enviada(s) · {summary.opened} nova(s) · {summary.continued} resposta(s)
                {summary.skipped.length > 0 && ` · ${summary.skipped.join('; ')}`}
              </span>
            )}
            {error && <span className="text-xs text-destructive">{error}</span>}
            <Button onClick={handleRunTick} disabled={running}>
              <Play className="mr-2 h-4 w-4" />
              {running ? 'Rodando...' : 'Rodar uma rodada agora (teste)'}
            </Button>
          </div>
        </div>

        {/* Linha 2: parâmetros do modo escolhido */}
        <div className="grid grid-cols-2 gap-x-5 gap-y-4 border-t border-border pt-4 sm:grid-cols-3 lg:grid-cols-4">
          <Field label="Números no aquecimento" hint={`de até ${settings.max_numbers_cap}`}>
            <NumInput
              value={settings.qntd_numbers}
              min={1}
              max={settings.max_numbers_cap}
              onCommit={(n) => patchSettings({ qntd_numbers: n })}
            />
          </Field>

          <Field label="Intervalo entre mensagens" hint="em minutos">
            <NumInput value={settings.min_gap_minutes} min={0} onCommit={(n) => patchSettings({ min_gap_minutes: n })} />
            <span className="text-sm text-muted-foreground">–</span>
            <NumInput value={settings.max_gap_minutes} min={0} onCommit={(n) => patchSettings({ max_gap_minutes: n })} />
          </Field>

          <Field label="Máx. por rodada" hint="mensagens por vez">
            <NumInput value={settings.tick_max_sends} min={1} onCommit={(n) => patchSettings({ tick_max_sends: n })} />
          </Field>

          {settings.warmup_mode === 'sessao' ? (
            <>
              <Field label="Duração" hint="horas">
                <NumInput
                  value={settings.sessao_duracao_horas}
                  min={1}
                  onCommit={(n) => patchSettings({ sessao_duracao_horas: n })}
                />
              </Field>
              <Field label="Mensagens por número" hint="no período todo">
                <NumInput
                  value={settings.sessao_msgs_por_numero}
                  min={1}
                  onCommit={(n) => patchSettings({ sessao_msgs_por_numero: n })}
                />
              </Field>
              <Field label="Conversas por número" hint="quantos pares abre">
                <NumInput
                  value={settings.sessao_conversas_por_numero}
                  min={1}
                  onCommit={(n) => patchSettings({ sessao_conversas_por_numero: n })}
                />
              </Field>
            </>
          ) : (
            <p className="col-span-2 self-center text-xs text-muted-foreground sm:col-span-3 lg:col-span-4">
              No modo gradual, o volume por dia sobe conforme os dias de aquecimento de cada número
              (rampa fixa: 6/dia nos primeiros dias, até 40/dia após 2 semanas).
            </p>
          )}
        </div>

        {/* Linha 3: controle da sessão (só no modo sessao) */}
        {settings.warmup_mode === 'sessao' && (
          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
            {sessaoAtiva ? (
              <>
                <span className="flex items-center gap-1.5 text-sm font-medium text-success">
                  <Radio className="h-4 w-4" />
                  Sessão ativa — termina em ~{horasRestantes}h
                </span>
                <Button variant="outline" size="sm" onClick={handleStopSession}>
                  <Square className="mr-2 h-3.5 w-3.5" />
                  Encerrar sessão
                </Button>
              </>
            ) : (
              <>
                <span className="text-sm text-muted-foreground">
                  {settings.sessao_iniciada_em
                    ? 'Sessão anterior encerrada (duração atingida).'
                    : 'Nenhuma sessão em andamento.'}
                </span>
                <Button size="sm" onClick={handleStartSession}>
                  <Timer className="mr-2 h-3.5 w-3.5" />
                  Iniciar aquecimento ({settings.sessao_duracao_horas}h)
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Abas */}
      <div className="mb-4 flex gap-1 rounded-xl border border-border bg-card p-1 text-sm">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'rounded-lg px-4 py-1.5 font-medium transition-colors',
              tab === t.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent/40'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'numbers' && (
        <NumbersConfigSection numbers={initialNumbers} stats={stats} maxCap={settings.max_numbers_cap} />
      )}
      {tab === 'templates' && <TemplatesSection templates={initialTemplates} />}
      {tab === 'history' && (
        <HistoryTable initialRows={initialHistory} hasMore={historyHasMore} numbers={initialNumbers} />
      )}
    </AppShell>
  )
}

// Campo rotulado em pilha (label em cima, controle no meio, dica embaixo) para um
// grid alinhado e legível.
function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-foreground">{label}</label>
      <div className="flex items-center gap-1.5">{children}</div>
      {hint && <span className="text-[11px] leading-tight text-muted-foreground">{hint}</span>}
    </div>
  )
}

// Input numérico com estado local que só grava (onCommit) ao sair do foco,
// clampando ao mínimo (e opcionalmente ao máximo).
function NumInput({
  value,
  min,
  max,
  onCommit,
}: {
  value: number
  min: number
  max?: number
  onCommit: (n: number) => void
}) {
  const [v, setV] = useState(String(value))
  const commit = () => {
    let n = Math.max(min, Math.round(Number(v) || min))
    if (max !== undefined) n = Math.min(max, n)
    setV(String(n))
    if (n !== value) onCommit(n)
  }
  return (
    <Input
      type="number"
      min={min}
      max={max}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      className="h-9 w-16 text-center tabular-nums"
    />
  )
}
