import { Radio, AlertTriangle } from 'lucide-react'
import type { ChannelStat } from '@/app/actions/leads'

// Desempenho por canal de captação (S5.1). O campo virou obrigatório no Pipefy, mas o
// histórico ainda tem muitos "Não informado" — por isso o painel mostra um selo de "dado
// incompleto" enquanto `fillRate` estiver abaixo do piso. Volume com barra inline; conversão
// e lead morto por canal. Visão do supervisor.

const pct = (n: number) => `${Math.round(n * 100)}%`
const CHANNEL_FILL_OK = 0.8 // ≥ 80% preenchido no período → confiar nos números

export function ChannelBreakdown({
  data,
  fillRate,
}: {
  data: ChannelStat[]
  fillRate: number
}) {
  const incomplete = fillRate < CHANNEL_FILL_OK
  const maxVol = data.reduce((m, c) => Math.max(m, c.totalLeads), 0) || 1

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-gradient-card shadow-elevated">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div className="flex items-center gap-2">
          <Radio className="h-4 w-4 text-primary" />
          <div>
            <h2 className="text-sm font-semibold text-foreground">Canais de captação</h2>
            <p className="text-xs text-muted-foreground">
              Volume, conversão e lead morto por canal, no período.
            </p>
          </div>
        </div>
        {incomplete && (
          <span
            className="inline-flex items-center gap-1.5 rounded-full border border-warning/30 bg-warning/10 px-2.5 py-1 text-xs font-medium text-warning"
            title="O campo virou obrigatório no Pipefy; o histórico ainda enche. Os números por canal ficam confiáveis quando o preenchimento subir."
          >
            <AlertTriangle className="h-3 w-3" />
            Dado incompleto · {pct(fillRate)} preenchido
          </span>
        )}
      </div>

      {data.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Sem leads no período.</p>
      ) : (
        <div className="max-h-[24rem] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-background/80 text-xs uppercase tracking-wider text-muted-foreground backdrop-blur">
              <tr>
                <th className="px-5 py-3 text-left font-medium">Canal</th>
                <th className="px-5 py-3 text-right font-medium">Recebidos</th>
                <th className="px-5 py-3 text-right font-medium">Conversão</th>
                <th className="px-5 py-3 text-right font-medium">Lead morto</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.map((c) => {
                const muted = c.channel === 'Não informado'
                return (
                  <tr key={c.channel} className="transition-colors hover:bg-accent/40">
                    <td className="px-5 py-3">
                      <span className={muted ? 'italic text-muted-foreground' : 'font-medium text-foreground'}>
                        {c.channel}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <div className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-muted/40 sm:block">
                          <div
                            className={muted ? 'h-full bg-muted-foreground/40' : 'h-full bg-primary/70'}
                            style={{ width: `${Math.round((c.totalLeads / maxVol) * 100)}%` }}
                          />
                        </div>
                        <span className="tabular-nums text-foreground">{c.totalLeads}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-foreground">
                      {pct(c.conversionRate)}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-destructive">
                      {pct(c.deadRate)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
