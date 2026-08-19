import { ensureProfile } from '@/app/actions/auth'
import { AguardandoClient } from './AguardandoClient'

// Esta rota é o funil de TODO usuário sem acesso liberado: o middleware manda para cá tanto
// quem tem `role = 'pending'` quanto quem NÃO TEM perfil nenhum (`!profile`). É por isso que a
// recuperação do perfil órfão mora aqui e não em outro lugar — é o único ponto por onde essa
// pessoa passa. Ver docs/rbac-docs/fixes/perfil-orfao-auth-sem-profile.md.
//
// Antes: o órfão ficava clicando "Já fui aprovado — verificar" para sempre, sem aparecer no
// /admin para ninguém aprovar. Agora a primeira visita recria a linha em `profiles` como
// 'pending' e o admin volta a enxergá-lo no fluxo normal.
export default async function AguardandoPage() {
  await ensureProfile()
  return <AguardandoClient />
}
