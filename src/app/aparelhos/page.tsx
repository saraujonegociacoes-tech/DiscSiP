import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/app/actions/auth'
import { getInventario } from '@/app/actions/inventario'
import { AparelhosClient } from './AparelhosClient'

// Central de Aparelhos — inventário de celulares, chips e responsáveis.
// Ver docs/inventario-docs/updates/central-de-aparelhos.md.
//
// É uma área TRANSVERSAL, não uma vertical de departamento: todo departamento tem
// celular da empresa, então o gate é por PAPEL e não por `department_slug` (é por
// isso que ela não entra em VERTICAL_GATES no middleware).
//
//   · leem     supervisor, manager, admin, tester
//   · escrevem            manager, admin, tester
//   · fora:    agent, pending, ceo (o `ceo` já é barrado antes, no middleware)
//
// Gate por papel aqui + no middleware; a barreira real dos DADOS é o RLS
// (inv_can_read/inv_can_write, migration 20260820_inventario_aparelhos.sql). Esta
// página só decide o que RENDERIZAR — inclusive `podeEscrever`, que esconde os
// botões de quem o banco recusaria de qualquer jeito.
const PAPEIS_LEITURA = ['supervisor', 'manager', 'admin', 'tester']
const PAPEIS_ESCRITA = ['manager', 'admin', 'tester']

export default async function AparelhosPage() {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (!PAPEIS_LEITURA.includes(profile.role)) redirect('/')

  const initialData = await getInventario()

  return (
    // Suspense: o AparelhosClient usa useSearchParams (aba ativa em ?aba=), que
    // exige um limite de Suspense no App Router. Mesmo padrão de app/minutas/page.tsx.
    <Suspense fallback={null}>
      <AparelhosClient initialData={initialData} podeEscrever={PAPEIS_ESCRITA.includes(profile.role)} />
    </Suspense>
  )
}
