// Placeholder dos gráficos carregados sob demanda (ver src/features/*/lazy.tsx).
//
// Reserva a mesma caixa do gráfico real — card com cabeçalho + área de plot — para que a troca
// esqueleto→gráfico não empurre nada na página (evita Cumulative Layout Shift). Por isso
// `bodyHeight` existe: precisa casar com a altura do plot do componente que está substituindo
// (a maioria usa `h-80`; o gráfico do painel da discadora usa `h-56`). Sem animação de pulso na
// área de plot de propósito: em telas com 4+ gráficos isso vira repaint constante enquanto os
// chunks chegam.
export function ChartSkeleton({
  title,
  bodyHeight = 'h-80',
}: {
  title?: string
  bodyHeight?: string
}) {
  return (
    <div
      className="relative h-full overflow-hidden rounded-2xl border border-border bg-gradient-card p-5 shadow-elevated"
      aria-busy="true"
    >
      {title ? (
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      ) : (
        <div className="h-4 w-40 rounded bg-muted-foreground/15" />
      )}
      <div className="mb-4 mt-1 h-3 w-56 rounded bg-muted-foreground/10" />
      <div className={`${bodyHeight} rounded-xl bg-muted-foreground/5`} />
      <span className="sr-only">Carregando gráfico…</span>
    </div>
  )
}
