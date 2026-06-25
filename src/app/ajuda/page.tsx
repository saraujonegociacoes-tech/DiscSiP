import { getCurrentProfile } from '@/app/actions/auth'
import { AjudaPage } from '@/features/ajuda'
import type { Role } from '@/lib/types/database'

// Página "Como usar?" — full-page (fora do AppShell). Adapta o conteúdo ao papel
// do usuário logado. Pendente também acessa (liberado no middleware).
export default async function Page() {
  const profile = await getCurrentProfile()
  const role: Role = profile?.role ?? 'pending'
  return <AjudaPage role={role} />
}
