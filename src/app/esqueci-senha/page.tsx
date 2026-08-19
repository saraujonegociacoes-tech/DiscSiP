import { EsqueciSenhaClient } from './EsqueciSenhaClient'

// Server Component só pra ler o ?erro= e repassar. Fazer isso aqui (e não com
// useSearchParams no cliente) evita ter que embrulhar a página num <Suspense> pro
// build estático do Next 15 não reclamar.
export default async function EsqueciSenhaPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>
}) {
  const { erro } = await searchParams
  return <EsqueciSenhaClient erro={erro ?? null} />
}
