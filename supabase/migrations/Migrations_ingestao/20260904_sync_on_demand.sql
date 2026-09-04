-- ============================================================================
-- Ingestão sob demanda — estado, trava e cooldown por fonte
-- ============================================================================
-- Substitui os 4 cenários agendados do Make (Leads, CS, Financeiro, Negociação)
-- pelo botão "Atualizar" de cada painel. Ver
--   docs/ingestao-docs/updates/ingestao-sob-demanda.md
--
-- ⚠️ ESTA MIGRATION NÃO TOCA EM NENHUMA RPC DE INGESTÃO.
-- `ingest_lead_card`, `ingest_cs_card`, `ingest_financeiro_card` e
-- `ingest_negociacao_card` continuam exatamente como estão — provadas em produção
-- (o `verify:financeiro` bate 100% em cima delas). O que entra aqui é só o ESTADO
-- de "quem sincroniza, quando, e a partir de quando" — o que antes vivia implícito
-- no `Schedule 30min` do Make e na fórmula `now − 35min` da variável `since`.
--
-- ── POR QUE A COORDENAÇÃO TEM QUE MORAR NO POSTGRES ─────────────────────────
-- A app roda em Workers da Cloudflare (OpenNext). Cada invocação é ISOLADA: um
-- Map, um cache de promise ou um mutex em memória morre com a invocação e não é
-- enxergado pelo Worker que atende a próxima pessoa, possivelmente em outra
-- localidade. Então "existe um refresh rodando?" só tem resposta confiável se a
-- pergunta for feita ao banco. É o que `sync_claim` faz num único UPDATE atômico:
-- quem leva a linha executa, quem leva zero linhas aguarda.
--
-- ── AS DUAS REGRAS, NA MESMA INSTRUÇÃO ──────────────────────────────────────
--   trava    → `rodando = false OR lock_ate <= now()`      (simultaneidade)
--   cooldown → `last_ok_at <= now() - p_cooldown_seg`      (frequência)
-- Cooldown sozinho NÃO segura duas pessoas clicando no mesmo segundo: as duas leem
-- "última rodada foi há 10 min", as duas passam. A trava é que resolve isso, e ela
-- precisa ser atômica — daí ser um WHERE do UPDATE, e não um SELECT seguido de
-- UPDATE (que tem janela de corrida entre os dois).
--
-- ── AS TRÊS MARCAS DE TEMPO (não confundir) ─────────────────────────────────
--   watermark        — confirmada. É o `since` da PRÓXIMA rodada. Só avança em
--                      `sync_finish`, isto é, quando a rodada chegou ao fim. Rodada
--                      que falha no meio não avança nada: o próximo clique relê a
--                      mesma janela (a ingestão é idempotente, reler não duplica).
--   janela_desde     — o `since` da rodada EM CURSO. Fica congelado do início ao fim
--                      da rodada para a paginação ser coerente.
--   run_iniciado_em  — quando a rodada em curso começou. Vira a `watermark` no fim.
--
-- ⚠️ Por que `watermark = run_iniciado_em` e não `now()` no fim: cards editados
-- DURANTE a rodada podem ter caído numa página já passada. Fechar a janela no
-- início da rodada garante que eles entrem na próxima. O overlap de 2 min por cima
-- é a folga extra.
-- ============================================================================


-- ── PARTE 1 — Tabela de estado ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sync_state (
  fonte            text PRIMARY KEY,          -- 'leads' | 'cs' | 'cs_pagamento' | 'financeiro' | 'negociacao'
  -- Janela de leitura.
  watermark        timestamptz NOT NULL,      -- confirmada; `since` da próxima rodada
  janela_desde     timestamptz,               -- `since` da rodada em curso
  run_iniciado_em  timestamptz,               -- início da rodada em curso
  -- Nome `cursor_atual` e não `cursor`: keyword do SQL, evita quoting em todo lugar.
  cursor_atual     text,                      -- endCursor da paginação em curso
  -- Trava.
  rodando          boolean NOT NULL DEFAULT false,
  lock_ate         timestamptz,               -- expiração: Worker que morre devolve a trava sozinho
  token            uuid,                      -- quem detém a trava; encadeia as invocações
  -- Progresso da rodada em curso (é isto que quem aguarda vê subir).
  paginas          integer NOT NULL DEFAULT 0,
  cards            integer NOT NULL DEFAULT 0,
  -- Resultado.
  last_ok_at       timestamptz,               -- última rodada CONCLUÍDA; base do cooldown
  last_erro_at     timestamptz,
  last_erro        text,
  atualizado_em    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.sync_state IS
  'Uma linha por fonte de ingestao. E a fila do refresh sob demanda: quem vence o UPDATE de sync_claim executa, o resto aguarda esta mesma linha.';


-- ── PARTE 2 — Semente: a watermark inicial sai do que já está no banco ──────
-- Cada tabela ingerida tem `synced_at` (última gravação). O maior deles é o ponto
-- exato onde o cenário do Make parou — então a primeira rodada sob demanda continua
-- de onde o Make deixou, sem buraco e sem reler o pipe inteiro.
--
-- Guardas `to_regclass`: a migration roda inteira mesmo num banco onde alguma
-- vertical ainda não exista (não deveria acontecer hoje, mas mantém idempotência).

DO $seed$
DECLARE
  v_fonte  text;
  v_tabela text;
  v_wm     timestamptz;
BEGIN
  FOR v_fonte, v_tabela IN
    SELECT * FROM (VALUES
      ('leads',        'public.leads'),
      ('cs',           'public.cs_cards'),
      -- `cs_pagamento` relê o balde "Aguardando Pagamento" inteiro, sem delta (o card do
      -- CS não muda de `updated_at` quando o pagamento é conectado pelo Financeiro). A
      -- watermark dele existe só para o registro de "quando rodou" — a query a ignora.
      ('cs_pagamento', 'public.cs_cards'),
      ('financeiro',   'public.fin_cards'),
      ('negociacao',   'public.neg_cards')
    ) AS t(fonte, tabela)
  LOOP
    IF to_regclass(v_tabela) IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format('SELECT max(synced_at) FROM %s', v_tabela) INTO v_wm;
    INSERT INTO public.sync_state (fonte, watermark)
    VALUES (v_fonte, COALESCE(v_wm, now() - interval '7 days'))
    ON CONFLICT (fonte) DO NOTHING;
  END LOOP;
END
$seed$;


-- ── PARTE 3 — RLS: leitura para quem está logado, escrita só pelas funções ──
-- O que a tabela expõe são carimbos de tempo de sincronização (nenhum dado de card),
-- e o painel precisa deles para mostrar "atualizado há 12 min". Escrita ninguém tem:
-- as 4 funções abaixo são SECURITY DEFINER e só o service_role executa.

ALTER TABLE public.sync_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sync_state_leitura ON public.sync_state;
CREATE POLICY sync_state_leitura ON public.sync_state
  FOR SELECT TO authenticated USING (true);

REVOKE ALL ON public.sync_state FROM anon, authenticated;
GRANT SELECT ON public.sync_state TO authenticated;


-- ── PARTE 4 — sync_claim: a fila inteira, num UPDATE ────────────────────────
-- Devolve um dos quatro estados:
--   'iniciado'     → você é quem executa. Vem com token, janela e cursor.
--   'aguardando'   → tem rodada em curso (com trava válida). Conecte-se e espere.
--   'recente'      → concluída há menos do cooldown. O dado já está fresco; espera zero.
--   'erro_recente' → a última rodada falhou agora há pouco; segura o retry.
--
-- `p_token` serve para ENCADEAR: como uma invocação do Worker não dá conta de todas
-- as páginas (10 ms de CPU, 50 subrequests), quem está executando volta aqui a cada
-- página com o token que já tem, renova a trava e continua do `cursor_atual`.

CREATE OR REPLACE FUNCTION public.sync_claim(
  p_fonte        text,
  p_token        uuid    DEFAULT NULL,
  p_cooldown_seg integer DEFAULT 300,   -- 5 min: a regra de frequência
  p_lock_seg     integer DEFAULT 120,   -- validade da trava; renovada a cada página
  p_overlap_seg  integer DEFAULT 120    -- folga que a janela abre para trás
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_now   timestamptz := now();
  v_token uuid;
  v_row   public.sync_state;
BEGIN
  -- (0) Continuação: quem já detém a trava só renova e segue do cursor salvo.
  IF p_token IS NOT NULL THEN
    UPDATE public.sync_state s
       SET lock_ate      = v_now + make_interval(secs => p_lock_seg),
           atualizado_em = v_now
     WHERE s.fonte = p_fonte
       AND s.token = p_token
       AND s.rodando
       AND s.lock_ate > v_now
    RETURNING * INTO v_row;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'status',  'iniciado',
        'token',   v_row.token,
        'desde',   v_row.janela_desde,
        'cursor',  v_row.cursor_atual,
        'paginas', v_row.paginas,
        'cards',   v_row.cards
      );
    END IF;
    -- Token vencido (a invocação anterior demorou mais que a trava, ou outra pessoa
    -- assumiu). Cai para a reivindicação normal — pode ser que ele reivindique de novo,
    -- pode ser que vire quem aguarda. As duas saídas são corretas.
  END IF;

  -- (1) Reivindicação atômica. As três condições do WHERE são a fila inteira.
  v_token := gen_random_uuid();

  UPDATE public.sync_state s
     SET rodando         = true,
         token           = v_token,
         lock_ate        = v_now + make_interval(secs => p_lock_seg),
         -- s.rodando aqui só pode ser `true` no caso de RETOMADA (trava expirada, o
         -- executor sumiu). Nesse caso preserva-se a rodada: mesma janela, mesmo
         -- cursor, mesmo progresso. Só assim a retomada continua em vez de recomeçar.
         run_iniciado_em = CASE WHEN s.rodando THEN s.run_iniciado_em ELSE v_now END,
         janela_desde    = CASE WHEN s.rodando THEN s.janela_desde
                                ELSE s.watermark - make_interval(secs => p_overlap_seg) END,
         cursor_atual    = CASE WHEN s.rodando THEN s.cursor_atual ELSE NULL END,
         paginas         = CASE WHEN s.rodando THEN s.paginas ELSE 0 END,
         cards           = CASE WHEN s.rodando THEN s.cards ELSE 0 END,
         atualizado_em   = v_now
   WHERE s.fonte = p_fonte
     -- trava: ninguém executando (ou o executor sumiu e a trava expirou)
     AND (s.rodando = false OR s.lock_ate <= v_now)
     -- cooldown: a última rodada CONCLUÍDA é mais velha que a janela de frescor
     AND COALESCE(s.last_ok_at,   '-infinity'::timestamptz) <= v_now - make_interval(secs => p_cooldown_seg)
     -- guarda de erro: não martela o Pipefy em loop de falha
     AND COALESCE(s.last_erro_at, '-infinity'::timestamptz) <= v_now - interval '60 seconds'
  RETURNING * INTO v_row;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'status',  'iniciado',
      'token',   v_row.token,
      'desde',   v_row.janela_desde,
      'cursor',  v_row.cursor_atual,
      'paginas', v_row.paginas,
      'cards',   v_row.cards
    );
  END IF;

  -- (2) Perdeu a corrida. Uma leitura barata diz por quê.
  SELECT * INTO v_row FROM public.sync_state WHERE fonte = p_fonte;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'desconhecida');
  END IF;

  IF v_row.rodando AND v_row.lock_ate > v_now THEN
    RETURN jsonb_build_object(
      'status',  'aguardando',
      'paginas', v_row.paginas,
      'cards',   v_row.cards,
      'desde',   v_row.run_iniciado_em
    );
  END IF;

  IF COALESCE(v_row.last_erro_at, '-infinity'::timestamptz) > v_now - interval '60 seconds' THEN
    RETURN jsonb_build_object(
      'status',   'erro_recente',
      'erro',     v_row.last_erro,
      'liberaEm', GREATEST(0, ceil(extract(epoch FROM (v_row.last_erro_at + interval '60 seconds' - v_now))))::int
    );
  END IF;

  RETURN jsonb_build_object(
    'status',       'recente',
    'atualizadoEm', v_row.last_ok_at,
    'cards',        v_row.cards,
    'liberaEm',     GREATEST(0, ceil(extract(epoch FROM (
                      v_row.last_ok_at + make_interval(secs => p_cooldown_seg) - v_now
                    ))))::int
  );
END
$fn$;


-- ── PARTE 5 — sync_progress / sync_finish / sync_fail ───────────────────────
-- Todas exigem o token: uma invocação que perdeu a trava (porque demorou demais e
-- outra pessoa assumiu) não consegue mais escrever progresso nem avançar a
-- watermark. Devolvem `false` e o chamador para.

CREATE OR REPLACE FUNCTION public.sync_progress(
  p_fonte    text,
  p_token    uuid,
  p_cursor   text,
  p_cards    integer,
  p_lock_seg integer DEFAULT 120
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  UPDATE public.sync_state s
     SET cursor_atual  = p_cursor,
         paginas       = s.paginas + 1,
         cards         = s.cards + COALESCE(p_cards, 0),
         lock_ate      = now() + make_interval(secs => p_lock_seg),
         atualizado_em = now()
   WHERE s.fonte = p_fonte AND s.token = p_token AND s.rodando;
  RETURN FOUND;
END
$fn$;

CREATE OR REPLACE FUNCTION public.sync_finish(
  p_fonte text,
  p_token uuid,
  p_cards integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_row public.sync_state;
BEGIN
  UPDATE public.sync_state s
     SET rodando       = false,
         token         = NULL,
         lock_ate      = NULL,
         cursor_atual  = NULL,
         -- A janela só fecha aqui. Fecha no INÍCIO da rodada (ver cabeçalho).
         watermark     = COALESCE(s.run_iniciado_em, now()),
         paginas       = s.paginas + 1,
         cards         = s.cards + COALESCE(p_cards, 0),
         last_ok_at    = now(),
         last_erro_at  = NULL,
         last_erro     = NULL,
         atualizado_em = now()
   WHERE s.fonte = p_fonte AND s.token = p_token AND s.rodando
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false);
  END IF;

  RETURN jsonb_build_object(
    'ok',           true,
    'cards',        v_row.cards,
    'paginas',      v_row.paginas,
    'atualizadoEm', v_row.last_ok_at
  );
END
$fn$;

CREATE OR REPLACE FUNCTION public.sync_fail(
  p_fonte text,
  p_token uuid,
  p_erro  text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  -- Libera a trava e NÃO avança a watermark: a janela inteira será relida no próximo
  -- clique. O cursor é zerado de propósito — recomeçar a janela do zero é idempotente
  -- e mais simples de raciocinar do que retomar uma paginação de origem desconhecida.
  UPDATE public.sync_state s
     SET rodando       = false,
         token         = NULL,
         lock_ate      = NULL,
         cursor_atual  = NULL,
         last_erro_at  = now(),
         last_erro     = left(COALESCE(p_erro, 'erro sem detalhe'), 500),
         atualizado_em = now()
   WHERE s.fonte = p_fonte AND s.token = p_token;
  RETURN FOUND;
END
$fn$;


-- ── PARTE 6 — Grants: só o service_role (a rota) executa ────────────────────

REVOKE ALL ON FUNCTION public.sync_claim(text, uuid, integer, integer, integer)    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_progress(text, uuid, text, integer, integer)    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_finish(text, uuid, integer)                     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_fail(text, uuid, text)                          FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.sync_claim(text, uuid, integer, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.sync_progress(text, uuid, text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.sync_finish(text, uuid, integer)                  TO service_role;
GRANT EXECUTE ON FUNCTION public.sync_fail(text, uuid, text)                       TO service_role;


-- ── Conferência ─────────────────────────────────────────────────────────────
-- Estado das 4 fontes:
--   SELECT fonte, watermark, rodando, last_ok_at, cards, last_erro FROM public.sync_state;
--
-- Cada função tem que voltar UMA linha (armadilha do README das migrations):
--   SELECT proname, pg_get_function_identity_arguments(oid) FROM pg_proc
--    WHERE proname IN ('sync_claim','sync_progress','sync_finish','sync_fail');
--
-- Destravar uma fonte à mão (só se a trava ficar presa, o que a expiração já evita):
--   UPDATE public.sync_state SET rodando = false, token = NULL, lock_ate = NULL WHERE fonte = 'cs';
