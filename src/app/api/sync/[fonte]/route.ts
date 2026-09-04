import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { DEFINICOES, ehFonte, type Fonte } from '@/lib/sync/fontes'
import { sincronizarPagina } from '@/lib/sync/executar'

// Ingestão sob demanda — o botão "Atualizar" dos painéis.
// Ver docs/ingestao-docs/updates/ingestao-sob-demanda.md
//
// GET  → estado da fonte (para o painel escrever "atualizado há 12 min"). Não sincroniza.
// POST → tenta assumir a rodada. Uma chamada = UMA página. Ver o encadeamento abaixo.
//
// ── O CONTRATO DO POST ──────────────────────────────────────────────────────
// A resposta sempre diz em qual dos estados a pessoa caiu:
//   { status: 'iniciado', done: false, token } → você é quem executa; chame de novo
//                                                 com o mesmo token para a próxima página
//   { status: 'pronto',   done: true }         → a rodada terminou; recarregue a tela
//   { status: 'aguardando' }                   → outra pessoa já está sincronizando;
//                                                 continue chamando (é assim que se retoma
//                                                 uma rodada abandonada) até vir 'pronto'
//   { status: 'recente', liberaEm }            → concluída há menos de 5 min; nada a fazer
//   { status: 'erro_recente', erro, liberaEm } → a última tentativa falhou agora há pouco
//
// ⚠️ QUEM DECIDE É O POSTGRES, NUNCA ESTA ROTA.
// Duas pessoas clicando no mesmo segundo caem em dois Workers diferentes, que não se
// enxergam. Quem separa executor de espectador é o UPDATE atômico de `sync_claim` —
// esta rota só repassa o veredito. Não acrescente aqui nenhuma checagem em memória
// (Map, cache de promise, variável de módulo): ela é por invocação e mente.

export const dynamic = 'force-dynamic'

type Contexto = { params: Promise<{ fonte: string }> }

// Espelha o gate de rota do middleware: quem enxerga o painel pode atualizá-lo.
// O middleware protege /api/sync (a rota não está nas exceções do matcher), então
// aqui já chega com sessão — o que falta é o papel, que ele só checa por prefixo de
// página. Sem isto, um agente de CS conseguiria disparar a ingestão do Financeiro.
async function autorizar(
  fonte: Fonte
): Promise<{ ok: true } | { ok: false; status: number; erro: string }> {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, status: 401, erro: 'sem sessão' }

  const { data: perfil } = await supabase
    .from('profiles')
    .select('role, departments(slug)')
    .eq('id', user.id)
    .single()

  const role: string = perfil?.role ?? ''
  const dep = perfil?.departments as { slug?: string } | { slug?: string }[] | null
  const slug: string | null = (Array.isArray(dep) ? dep[0]?.slug : dep?.slug) ?? null

  if (!DEFINICOES[fonte].permite(role, slug)) {
    return { ok: false, status: 403, erro: 'sem permissão nesta fonte' }
  }
  return { ok: true }
}

export async function GET(_req: NextRequest, ctx: Contexto) {
  const { fonte } = await ctx.params
  if (!ehFonte(fonte)) return NextResponse.json({ erro: 'fonte desconhecida' }, { status: 404 })

  const auth = await autorizar(fonte)
  if (!auth.ok) return NextResponse.json({ erro: auth.erro }, { status: auth.status })

  const { data, error } = await createServiceClient()
    .from('sync_state')
    .select('fonte, rodando, paginas, cards, last_ok_at, last_erro_at, last_erro')
    .eq('fonte', fonte)
    .single()

  if (error) return NextResponse.json({ erro: error.message }, { status: 500 })

  return NextResponse.json({
    fonte,
    rodando: data.rodando,
    paginas: data.paginas,
    cards: data.cards,
    atualizadoEm: data.last_ok_at,
    erro: data.last_erro,
  })
}

export async function POST(req: NextRequest, ctx: Contexto) {
  const { fonte } = await ctx.params
  if (!ehFonte(fonte)) return NextResponse.json({ erro: 'fonte desconhecida' }, { status: 404 })

  const auth = await autorizar(fonte)
  if (!auth.ok) return NextResponse.json({ erro: auth.erro }, { status: auth.status })

  // Token da rodada em curso, quando esta chamada é a continuação de uma anterior.
  let token: string | null = null
  try {
    const body = (await req.json()) as { token?: string }
    token = body?.token ?? null
  } catch {
    // POST sem corpo = primeiro clique.
  }

  const service = createServiceClient()

  const { data: claim, error: erroClaim } = await service.rpc('sync_claim', {
    p_fonte: fonte,
    p_token: token,
  })
  if (erroClaim) {
    return NextResponse.json({ erro: erroClaim.message }, { status: 500 })
  }

  const estado = claim as {
    status: string
    token?: string
    desde?: string
    cursor?: string | null
    paginas?: number
    cards?: number
    atualizadoEm?: string
    liberaEm?: number
    erro?: string
  }

  // Fonte sem linha em `sync_state` = a migration 20260904_sync_on_demand.sql não foi
  // aplicada. Falhar alto aqui, senão o botão fica "funcionando" sem sincronizar nada.
  if (estado.status === 'desconhecida') {
    return NextResponse.json(
      { status: 'erro', done: true, erro: `fonte "${fonte}" sem linha em sync_state — aplique a migration 20260904_sync_on_demand.sql` },
      { status: 500 }
    )
  }

  // Perdeu a corrida (ou não havia o que fazer): devolve o motivo e sai. Custa uma ida
  // ao banco — que é espera de rede, e não entra no orçamento de CPU do Worker.
  if (estado.status !== 'iniciado') {
    return NextResponse.json({ ...estado, done: estado.status !== 'aguardando' })
  }

  const meuToken = estado.token!
  const desde = estado.desde!

  try {
    const pagina = await sincronizarPagina(fonte, desde, estado.cursor ?? null)

    if (pagina.proximoCursor) {
      const { data: seguiu } = await service.rpc('sync_progress', {
        p_fonte: fonte,
        p_token: meuToken,
        p_cursor: pagina.proximoCursor,
        p_cards: pagina.cards,
      })
      // `false` = a trava passou para outra pessoa enquanto esta página rodava (a
      // invocação demorou mais que os 2 min). Quem assumiu continua do cursor salvo;
      // esta chamada vira espectadora em vez de escrever por cima.
      if (seguiu === false) {
        return NextResponse.json({ status: 'aguardando', done: false })
      }
      return NextResponse.json({
        status: 'iniciado',
        done: false,
        token: meuToken,
        paginas: (estado.paginas ?? 0) + 1,
        cards: (estado.cards ?? 0) + pagina.cards,
      })
    }

    const { data: fim } = await service.rpc('sync_finish', {
      p_fonte: fonte,
      p_token: meuToken,
      p_cards: pagina.cards,
    })
    const resumo = fim as { ok: boolean; cards?: number; paginas?: number; atualizadoEm?: string }
    return NextResponse.json({
      status: 'pronto',
      done: true,
      cards: resumo?.cards ?? 0,
      paginas: resumo?.paginas ?? 0,
      atualizadoEm: resumo?.atualizadoEm ?? null,
    })
  } catch (e) {
    const detalhe = e instanceof Error ? e.message : String(e)
    // Libera a trava e deixa a watermark onde está: a janela inteira será relida.
    await service.rpc('sync_fail', { p_fonte: fonte, p_token: meuToken, p_erro: detalhe })
    return NextResponse.json({ status: 'erro', done: true, erro: detalhe }, { status: 500 })
  }
}
