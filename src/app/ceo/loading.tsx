import { PageSkeleton } from '@/components/bluedesk/PageSkeleton'

// Aparece NA HORA do clique, enquanto o server component busca os dados. Ver PageSkeleton.
export default function Loading() {
  return <PageSkeleton title="Painel do CEO" kpis={4} chart={true} rows={4} />
}
