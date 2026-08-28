import { PageSkeleton } from '@/components/bluedesk/PageSkeleton'

// Aparece NA HORA do clique, enquanto o server component busca os dados. Ver PageSkeleton.
export default function Loading() {
  return <PageSkeleton title="Projetos" kpis={0} chart={false} rows={6} />
}
