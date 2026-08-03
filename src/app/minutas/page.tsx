import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/app/actions/auth'
import { getMinutas } from '@/app/actions/minutas'
import { MinutasClient } from './MinutasClient'

// Área Jurídico / Minutas Processuais — domínio SEPARADO das "Minutas" do CS (aba dentro de
// /cs). Ver docs/minutas-docs/updates/painel-minutas-processuais.md.
//
// Gate por papel na própria página (mesmo padrão de /projects): manager/admin OU quem é do
// departamento jurídico. A sidebar já esconde o item; a barreira real dos DADOS é o RLS
// (proc_can_access, migration 20260731b_minutas_processuais.sql).
export default async function MinutasPage() {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')

  const allowed =
    profile.role === 'manager' ||
    profile.role === 'admin' ||
    profile.role === 'tester' ||
    profile.department_slug === 'juridico'
  if (!allowed) redirect('/')

  const initialData = await getMinutas()

  return (
    // Suspense: o MinutasClient usa useSearchParams (aba ativa em ?aba=), que exige um limite
    // de Suspense no App Router. Mesmo padrão de app/cs/page.tsx e app/ceo/page.tsx.
    <Suspense fallback={null}>
      <MinutasClient initialData={initialData} />
    </Suspense>
  )
}
