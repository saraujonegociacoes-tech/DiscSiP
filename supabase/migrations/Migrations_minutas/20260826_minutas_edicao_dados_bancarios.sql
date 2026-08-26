-- ============================================================================
-- 20260826_minutas_edicao_dados_bancarios.sql — Minutas Processuais (Jurídico)
-- ============================================================================
-- Três mudanças pedidas pelo dono (26/ago/2026), todas em cima do schema de
-- 20260731b_minutas_processuais.sql:
--
-- 1. DADOS BANCÁRIOS + PIX no acordo. Hoje essa informação vive solta dentro de
--    `observacoes` (a planilha de origem misturava CNPJ, agência e chave PIX no
--    campo livre — ver docs/minutas-docs). Vira coluna própria, OPCIONAL: quem
--    paga precisa ler a chave sem garimpar texto corrido.
--
-- 2. EDIÇÃO da minuta. Não precisa de RPC nova: `proc_acordos` e `proc_parcelas`
--    já têm policy `for all` com `proc_can_access()`, então o app faz UPDATE /
--    INSERT / DELETE direto pelo PostgREST com a RLS aplicada — mesmo caminho
--    que `updateParcela` já usava. O que muda aqui é só o `proc_create_acordo`,
--    que passa a receber os dois campos novos.
--
-- 3. DATA DE PAGAMENTO informada pelo usuário. Puramente de UI: a coluna
--    `data_pagamento` já existe e sempre foi a data do pagamento — o que estava
--    errado é que a tela carimbava "hoje" ao clicar em marcar como paga, o que
--    enviesava o "Pago na janela" (parcela de junho, paga em junho, marcada em
--    agosto, contava em agosto). Nenhuma mudança de schema; fica registrado aqui
--    porque é a razão do item 2 existir.
--
-- ⚠️ `proc_create_acordo` GANHA PARÂMETROS. Acrescentar argumento não substitui
-- a função — cria uma SEGUNDA sobrecarga, e a chamada passa a dar "function is
-- not unique" (armadilha documentada em supabase/migrations/README.md). Por isso
-- o DROP da assinatura antiga vem ANTES do CREATE.
--
-- IDEMPOTENTE: pode ser reaplicada com segurança (aplicada à mão no SQL Editor).
-- ============================================================================

-- ── 1 · Colunas novas (opcionais) ───────────────────────────────────────────
alter table public.proc_acordos add column if not exists dados_bancarios text;
alter table public.proc_acordos add column if not exists pix             text;

comment on column public.proc_acordos.dados_bancarios is
  'Banco/agência/conta/favorecido do pagamento. Campo livre, opcional.';
comment on column public.proc_acordos.pix is
  'Chave PIX do favorecido. Campo livre, opcional.';

-- ── 2 · proc_create_acordo com dados bancários + PIX ────────────────────────
-- DROP da assinatura ANTIGA (9 args) antes de recriar com 11 — senão as duas
-- coexistem e a chamada sem os argumentos novos vira ambígua.
drop function if exists public.proc_create_acordo(text, text, text, text, int, int, numeric, date, text);

create or replace function public.proc_create_acordo(
  p_cliente             text,
  p_numero_processo     text,
  p_titulo              text,
  p_recorrencia         text,
  p_intervalo_dias      int,
  p_num_parcelas        int,
  p_valor_parcela       numeric,
  p_primeiro_vencimento date,
  p_observacoes         text,
  p_dados_bancarios     text,
  p_pix                 text
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_acordo_id uuid;
  v_dias      int;
  v_num       int;
  n           int;
begin
  v_dias := public.proc_recorrencia_dias(p_recorrencia, p_intervalo_dias);
  v_num  := greatest(coalesce(p_num_parcelas, 1), 1);
  if p_recorrencia = 'avulsa' then
    v_num  := 1;
    v_dias := null;
  end if;

  insert into public.proc_acordos (
    cliente, numero_processo, titulo, recorrencia, intervalo_dias,
    parcela_total, valor_parcela, primeiro_vencimento, observacoes,
    dados_bancarios, pix, created_by
  ) values (
    nullif(trim(coalesce(p_cliente, '')), ''),
    nullif(trim(coalesce(p_numero_processo, '')), ''),
    nullif(trim(coalesce(p_titulo, '')), ''),
    p_recorrencia, v_dias,
    v_num, p_valor_parcela, p_primeiro_vencimento,
    nullif(trim(coalesce(p_observacoes, '')), ''),
    nullif(trim(coalesce(p_dados_bancarios, '')), ''),
    nullif(trim(coalesce(p_pix, '')), ''),
    auth.uid()
  ) returning id into v_acordo_id;

  for n in 0 .. (v_num - 1) loop
    insert into public.proc_parcelas (acordo_id, num, valor, vencimento)
    values (
      v_acordo_id,
      (n + 1)::smallint,
      p_valor_parcela,
      case when v_dias is null or p_primeiro_vencimento is null then p_primeiro_vencimento
           else p_primeiro_vencimento + (n * v_dias) end
    );
  end loop;

  return v_acordo_id;
end;
$$;

grant execute on function public.proc_create_acordo(text, text, text, text, int, int, numeric, date, text, text, text) to authenticated;

-- ── 3 · Ingestão da planilha também grava os dois campos ────────────────────
-- Mesma assinatura (jsonb), então CREATE OR REPLACE basta. Só acrescenta o
-- mapeamento das chaves novas; o resto do corpo é idêntico ao da 20260731b.
-- `coalesce(...)` no UPDATE: re-rodar a carga não apaga o que foi digitado no
-- painel quando a planilha não traz o campo.
create or replace function public.proc_ingest_acordo(node jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_processo    text := nullif(trim(node->>'numero_processo'), '');
  v_cliente     text := nullif(trim(node->>'cliente'), '');
  v_titulo      text := nullif(trim(node->>'titulo'), '');
  v_recorrencia text := coalesce(nullif(node->>'recorrencia', ''), 'avulsa');
  v_obs         text := nullif(node->>'observacoes', '');
  v_banco       text := nullif(trim(coalesce(node->>'dados_bancarios', '')), '');
  v_pix         text := nullif(trim(coalesce(node->>'pix', '')), '');
  v_parcelas    jsonb := coalesce(node->'parcelas', '[]'::jsonb);
  -- total de parcelas: o maior entre quantas vieram no array e o total DECLARADO
  -- (ex.: "Parcela 02/03" → 3, mesmo que só 2 linhas tenham vindo na planilha).
  v_total       int := greatest(
                   jsonb_array_length(coalesce(node->'parcelas', '[]'::jsonb)),
                   coalesce((node->>'parcela_total')::int, 0),
                   1
                 );
  v_acordo_id   uuid;
  v_count       int := 0;
  p             jsonb;
begin
  -- Localiza acordo existente (idempotência).
  if v_processo is not null then
    select id into v_acordo_id from public.proc_acordos where numero_processo = v_processo limit 1;
  end if;
  if v_acordo_id is null and v_cliente is not null and v_titulo is not null then
    select id into v_acordo_id from public.proc_acordos
    where numero_processo is null and cliente = v_cliente and titulo = v_titulo limit 1;
  end if;

  if v_acordo_id is null then
    insert into public.proc_acordos (
      cliente, numero_processo, titulo, recorrencia, parcela_total, observacoes, dados_bancarios, pix
    )
    values (v_cliente, v_processo, v_titulo, v_recorrencia, v_total, v_obs, v_banco, v_pix)
    returning id into v_acordo_id;
  else
    update public.proc_acordos set
      cliente         = coalesce(v_cliente, cliente),
      titulo          = coalesce(v_titulo, titulo),
      recorrencia     = v_recorrencia,
      parcela_total   = greatest(v_total, parcela_total),
      observacoes     = coalesce(v_obs, observacoes),
      dados_bancarios = coalesce(v_banco, dados_bancarios),
      pix             = coalesce(v_pix, pix)
    where id = v_acordo_id;
  end if;

  for p in select * from jsonb_array_elements(v_parcelas) loop
    insert into public.proc_parcelas (acordo_id, num, valor, vencimento, data_pagamento, observacoes)
    values (
      v_acordo_id,
      coalesce((p->>'num')::smallint, 1),
      public.proc_parse_money(p->>'valor'),
      public.proc_parse_date(p->>'vencimento'),
      public.proc_parse_date(p->>'data_pagamento'),
      nullif(p->>'observacoes', '')
    )
    on conflict (acordo_id, num) do update set
      valor          = excluded.valor,
      vencimento     = excluded.vencimento,
      data_pagamento = excluded.data_pagamento,
      observacoes    = excluded.observacoes;
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('acordo_id', v_acordo_id, 'parcelas', v_count);
end;
$$;

revoke all on function public.proc_ingest_acordo(jsonb) from public, anon, authenticated;
grant execute on function public.proc_ingest_acordo(jsonb) to service_role;

-- ── Conferir depois de aplicar ──────────────────────────────────────────────
-- 1) Colunas novas existem:
--    SELECT column_name FROM information_schema.columns
--     WHERE table_name = 'proc_acordos' AND column_name IN ('dados_bancarios','pix');
--    -- esperado: 2 linhas
--
-- 2) ⚠️ proc_create_acordo tem UMA assinatura só (a armadilha da sobrecarga):
--    SELECT pg_get_function_identity_arguments(oid) FROM pg_proc
--     WHERE proname = 'proc_create_acordo';
--    -- esperado: 1 linha, terminando em "p_dados_bancarios text, p_pix text"
--
-- 3) Logado como usuário do jurídico, criar e corrigir data de pagamento:
--    SELECT public.proc_create_acordo('Fulana','0002','Minuta Y','mensal',null,2,500,
--           '2026-09-10',null,'Banco X ag 0001 cc 12345-6','fulana@pix.com');
--    UPDATE public.proc_parcelas SET data_pagamento = '2026-06-15'
--     WHERE num = 1 AND acordo_id = (SELECT id FROM proc_acordos WHERE numero_processo = '0002');
--    -- esperado: 1 linha afetada (a RLS deixa passar)
