// Paginação de leituras Supabase (server-side).
//
// O PostgREST corta toda resposta no "Max Rows" do projeto (padrão 1000). Qualquer
// .select() que devolve mais linhas que isso volta TRUNCADO — foi a causa das contagens
// do dashboard travando em 1000 e do dedup de campanha deixar passar duplicados.
//
// fetchAllRows() busca TODAS as linhas paginando: avança pelo nº de linhas REALMENTE
// devolvido e só para numa página vazia — então funciona mesmo se o teto do projeto for
// menor que PAGE_SIZE (ex.: 100). A query PRECISA ter ordenação DETERMINÍSTICA (total),
// senão as páginas podem se sobrepor/perder linhas; passe um order estável (ex.: por PK).

const PAGE_SIZE = 1000

export async function fetchAllRows<T>(
  makeQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null }>
): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; ) {
    const { data } = await makeQuery(from, from + PAGE_SIZE - 1)
    const rows = data ?? []
    out.push(...rows)
    if (rows.length === 0) break // fim (ou teto do projeto atingido na página anterior)
    from += rows.length // avança pelo que veio, não por PAGE_SIZE (robusto a teto < PAGE_SIZE)
  }
  return out
}
