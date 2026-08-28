import { PageSkeleton } from '@/components/bluedesk/PageSkeleton'

// Aparece NA HORA do clique, enquanto o server component busca os dados. Ver PageSkeleton.
export default function Loading() {
  return <PageSkeleton title="Central de Aparelhos" kpis={3} chart={false} rows={8} />
}
