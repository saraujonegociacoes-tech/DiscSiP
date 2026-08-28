import { AppShell } from '@/components/bluedesk/AppShell'
import { PageHeader } from '@/components/bluedesk/PageHeader'
import { Skeleton } from '@/components/ui/skeleton'

// Esqueleto padrão das telas internas, usado pelos `loading.tsx` de cada rota.
//
// POR QUE ISTO EXISTE: no App Router, clicar num link dispara a busca do RSC e o Next mantém
// a TELA ANTIGA no ar até o servidor responder. Sem um `loading.tsx`, uma página que demora
// não mostra absolutamente nada — nem spinner, nem erro — e o agente clica de novo achando
// que o clique não pegou. Era exatamente o sintoma relatado nos painéis de Leads e CS.
//
// A casca (`AppShell`) entra aqui de propósito: sidebar e header não dependem de dado nenhum,
// então aparecem NA HORA e só a área de conteúdo pulsa. A Sidebar não refaz busca de perfil
// (ela tem guarda `if (agentId) return` e o store sobrevive à navegação).
export function PageSkeleton({
  title,
  description,
  kpis = 4,
  chart = true,
  rows = 5,
}: {
  title: string
  description?: string
  /** Quantos cartões de métrica desenhar na primeira faixa. 0 esconde a faixa. */
  kpis?: number
  /** Desenha o bloco grande (gráfico/painel) abaixo das métricas. */
  chart?: boolean
  /** Quantas linhas de tabela/lista simular. 0 esconde o bloco. */
  rows?: number
}) {
  return (
    <AppShell>
      <PageHeader title={title} description={description} />

      {kpis > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: kpis }).map((_, i) => (
            <div key={i} className="rounded-lg border border-border bg-card/60 p-5">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="mt-3 h-7 w-16" />
            </div>
          ))}
        </div>
      )}

      {chart && (
        <div className="mt-6 rounded-lg border border-border bg-card/60 p-5">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="mt-4 h-56 w-full" />
        </div>
      )}

      {rows > 0 && (
        <div className="mt-6 rounded-lg border border-border bg-card/60 p-5">
          <Skeleton className="h-3 w-32" />
          <div className="mt-4 flex flex-col gap-3">
            {Array.from({ length: rows }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        </div>
      )}
    </AppShell>
  )
}
