import { DEFINICOES, TAMANHO_PAGINA, type Fonte } from './fontes'

// Uma página da ingestão: busca no Pipefy e manda cada card cru para a RPC.
// É o corpo dos módulos 2 a 5 do cenário do Make (GraphQL → Iterator → Transform →
// HTTP POST), sem o Make.
//
// ⚠️ UMA INVOCAÇÃO DO WORKER = UMA PÁGINA. Não tente varrer todas aqui.
// O Worker da Cloudflare (Free) tem ~10 ms de CPU e 50 subrequests por invocação —
// ver docs/discadora-docs/fixes/correcao-cpu-cloudflare-1102.md. Quem encadeia as
// páginas é o cliente, chamando a rota de novo com o mesmo token: cada chamada é uma
// invocação NOVA, com orçamento novo. A rodada continua completa; só o transporte é
// que vem em pedaços.

const PIPEFY_URL = 'https://api.pipefy.com/graphql'

// O `since` chega do Postgres como `2026-09-04T15:00:00.123456+00:00`. O Pipefy quer ISO
// 8601 e o cenário do Make mandava `YYYY-MM-DDTHH:mm:ssZ` — sem fração de segundo. Normaliza
// para o formato que já era aceito em produção, em vez de apostar no parser deles.
function paraIsoPipefy(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) throw new Error(`janela de sincronização inválida: ${iso}`)
  return d.toISOString().replace(/\.\d+Z$/, 'Z')
}

export type ResultadoPagina = {
  cards: number
  proximoCursor: string | null
}

type Node = Record<string, unknown>

async function buscarPagina(
  fonte: Fonte,
  since: string,
  cursor: string | null
): Promise<{ nodes: Node[]; proximoCursor: string | null }> {
  const def = DEFINICOES[fonte]
  const token = process.env.PIPEFY_TOKEN
  if (!token) throw new Error('PIPEFY_TOKEN ausente no ambiente')

  // ⚠️ Fonte sem delta (o balde de pagamento do CS) NÃO declara `$since` na query, e o
  // GraphQL recusa variável que a operação não declarou. Por isso o `since` só entra
  // quando a query o usa.
  const variables: Record<string, unknown> = {
    pipeId: def.pipeId(),
    cursor,
    size: TAMANHO_PAGINA,
  }
  if (def.usaDelta !== false) variables.since = paraIsoPipefy(since)

  const res = await fetch(PIPEFY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query: def.query, variables }),
  })

  if (!res.ok) {
    throw new Error(`Pipefy HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
  }

  const json = (await res.json()) as {
    errors?: unknown
    data?: {
      allCards?: {
        pageInfo?: { hasNextPage?: boolean; endCursor?: string | null }
        edges?: { node: Node }[]
      }
    }
  }

  // O Pipefy devolve 200 com `errors` no corpo. Tratar como falha é o que impede a
  // watermark de avançar por cima de uma janela que não foi lida de verdade.
  if (json.errors) {
    throw new Error(`Pipefy GraphQL: ${JSON.stringify(json.errors).slice(0, 300)}`)
  }

  const conn = json.data?.allCards
  const nodes = (conn?.edges ?? []).map((e) => e.node)
  return {
    nodes,
    proximoCursor: conn?.pageInfo?.hasNextPage ? (conn.pageInfo.endCursor ?? null) : null,
  }
}

async function ingerir(fonte: Fonte, node: Node): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase (URL/service_role) ausente no ambiente')

  // service_role, igual o Make usava: as RPCs de ingestão são SECURITY DEFINER e o
  // GRANT EXECUTE delas é só para service_role. A sessão do usuário não alcança.
  const res = await fetch(`${url}/rest/v1/rpc/${DEFINICOES[fonte].rpc}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ node }),
  })
  if (!res.ok) {
    throw new Error(`RPC ${DEFINICOES[fonte].rpc} ${res.status}: ${(await res.text()).slice(0, 200)}`)
  }
}

export async function sincronizarPagina(
  fonte: Fonte,
  since: string,
  cursor: string | null
): Promise<ResultadoPagina> {
  const { nodes, proximoCursor } = await buscarPagina(fonte, since, cursor)

  const resultados = await Promise.allSettled(nodes.map((n) => ingerir(fonte, n)))
  const falhas = resultados.filter((r) => r.status === 'rejected') as PromiseRejectedResult[]

  // ⚠️ Falha PARCIAL derruba a rodada inteira, de propósito.
  // Se 3 de 30 cards não entraram e a rodada fosse dada por boa, a watermark avançaria
  // por cima deles e esses 3 sumiriam para sempre — só voltariam se alguém editasse o
  // card de novo no Pipefy. Derrubando, a watermark fica onde está e o próximo clique
  // relê a janela toda (a ingestão é idempotente: reler não duplica).
  if (falhas.length > 0) {
    const motivo = falhas[0].reason
    throw new Error(
      `${falhas.length} de ${nodes.length} cards falharam. Primeiro: ${
        motivo instanceof Error ? motivo.message : String(motivo)
      }`
    )
  }

  return { cards: nodes.length, proximoCursor }
}
