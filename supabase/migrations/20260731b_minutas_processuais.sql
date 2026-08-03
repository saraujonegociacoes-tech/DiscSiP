-- ============================================================================
-- 20260731b_minutas_processuais.sql — Área Jurídico / Minutas Processuais
-- ============================================================================
-- Nova vertical do Blue Desk, SEPARADA das "Minutas" do CS (aba dentro de /cs,
-- tabelas cs_*). Aqui é o controle de MINUTAS PROCESSUAIS: obrigações de
-- pagamento ligadas a um número de processo, com parcelas recorrentes. Ver
-- docs/minutas-docs/updates/painel-minutas-processuais.md.
--
-- DIFERENÇA DE MOLDE em relação a CS/Financeiro: aqueles são ESPELHO do Pipefy
-- (read-only pro app, escrita só via service_role). Este é APP-NATIVE (CRUD do
-- usuário) — molde do módulo Monday (20260723d_monday.sql): trigger updated_at,
-- RLS com policies for-all, o app escreve com RLS aplicada. A carga inicial vem
-- de uma planilha (script único scripts/import-minutas.mjs, via service_role).
--
-- ACESSO: departamento `juridico` + manager/admin. RLS por departamento no
-- estilo do CS (proc_can_access), não por membership (Monday). Prefixo `proc_`
-- em tudo pra não colidir com nada do CRM.
--
-- IDEMPOTENTE: pode ser reaplicada com segurança (aplicada à mão no SQL Editor).
-- ============================================================================

create extension if not exists "pgcrypto";

-- ── Departamento Jurídico ────────────────────────────────────────────────────
-- A tabela `departments` (do core) tem um CHECK `departments_slug_check` que lista os slugs
-- válidos ('comercial'/'cs'/'negociacao') — mesma pegadinha do papel `ceo` no
-- `profiles_role_check`. Antes de criar o depto é preciso LIBERAR 'juridico' nesse CHECK.
-- Reconstrói o constraint PRESERVANDO os slugs já permitidos (extraídos da própria definição
-- atual, não dos dados) e acrescentando 'juridico'. Idempotente.
do $$
declare
  v_def  text;
  v_vals text[];
begin
  select pg_get_constraintdef(oid) into v_def
  from pg_constraint
  where conname = 'departments_slug_check'
    and conrelid = 'public.departments'::regclass;

  if v_def is not null then
    select array_agg(distinct m[1])
      into v_vals
    from regexp_matches(v_def, '''([^'']+)''', 'g') as m;
  end if;

  v_vals := coalesce(v_vals, array['comercial', 'cs', 'negociacao']);
  if not ('juridico' = any (v_vals)) then
    v_vals := array_append(v_vals, 'juridico');
  end if;

  alter table public.departments drop constraint if exists departments_slug_check;
  execute format(
    'alter table public.departments add constraint departments_slug_check check (slug is null or slug = any (%L::text[]))',
    v_vals
  );
end $$;

-- Cria o depto `juridico` se ainda não existir (WHERE NOT EXISTS em vez de ON CONFLICT: não
-- assumimos uma unique em `slug`). O dono depois atribui os usuários do jurídico a este depto
-- pelo Admin.
insert into public.departments (name, slug)
select 'Jurídico', 'juridico'
where not exists (select 1 from public.departments where slug = 'juridico');

-- ── Helper: updated_at automático (namespaced) ───────────────────────────────
create or replace function public.proc_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ── Helpers de acesso (espelham cs_current_role / cs_department_id) ───────────
create or replace function public.proc_current_role() returns text
language sql stable set search_path = public as $$
  select role::text from public.profiles where id = auth.uid()
$$;

create or replace function public.proc_current_department_id() returns uuid
language sql stable set search_path = public as $$
  select department_id from public.profiles where id = auth.uid()
$$;

create or replace function public.proc_juridico_department_id() returns uuid
language sql stable set search_path = public as $$
  select id from public.departments where slug = 'juridico' limit 1
$$;

-- Quem pode ver/editar as minutas: manager/admin (veem tudo) ou quem é do
-- departamento jurídico. Mesma filosofia dos painéis por vertical.
create or replace function public.proc_can_access() returns boolean
language sql stable set search_path = public as $$
  select public.proc_current_role() in ('manager', 'admin')
      or (
        public.proc_current_department_id() is not null
        and public.proc_current_department_id() = public.proc_juridico_department_id()
      )
$$;

-- ── Parsers (clones de fin_parse_money / fin_parse_date) ─────────────────────
-- Usados só pela ingestão da planilha. Nunca lançam: entrada suja → NULL.
create or replace function public.proc_parse_money(raw text)
returns numeric language plpgsql immutable as $$
declare s text;
begin
  if raw is null then return null; end if;
  s := trim(raw);
  if s = '' then return null; end if;
  -- formato br "1.234,56" → tira milhar, vírgula vira ponto
  if s ~ ',[0-9]{1,2}$' then
    s := replace(replace(s, '.', ''), ',', '.');
  end if;
  s := regexp_replace(s, '[^0-9.\-]', '', 'g');
  if s !~ '^-?[0-9]+(\.[0-9]+)?$' then return null; end if;
  return s::numeric;
exception when others then
  return null;
end;
$$;

-- O script de carga já normaliza a data pra ISO (ele conhece o formato AMERICANO
-- M/D/YYYY da planilha). Aqui aceitamos ISO (via left(s,10)) e, por rede de
-- segurança, DD/MM/YYYY. NÃO tenta adivinhar M/D — isso é resolvido no Node.
create or replace function public.proc_parse_date(raw text)
returns date language plpgsql immutable as $$
declare s text;
begin
  if raw is null then return null; end if;
  s := trim(raw);
  if s = '' then return null; end if;
  if s ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}' then
    return to_date(left(s, 10), 'DD/MM/YYYY');
  end if;
  return left(s, 10)::date;
exception when others then
  return null;
end;
$$;

-- Intervalo em dias de cada recorrência (mensal = 30 dias, decisão do dono).
-- 'avulsa' → null (parcela única); 'personalizada' → o intervalo escolhido.
create or replace function public.proc_recorrencia_dias(p_recorrencia text, p_intervalo_dias int)
returns int language sql immutable as $$
  select case p_recorrencia
    when 'mensal'        then 30
    when 'bimestral'     then 60
    when 'trimestral'    then 90
    when 'semestral'     then 180
    when 'anual'         then 365
    when 'personalizada' then nullif(p_intervalo_dias, 0)
    else null  -- avulsa
  end
$$;

-- ── Tabelas ──────────────────────────────────────────────────────────────────
-- Acordo = a minuta em si (cliente + processo + recorrência). As parcelas são
-- geradas a partir dele.
create table if not exists public.proc_acordos (
  id                  uuid primary key default gen_random_uuid(),
  cliente             text,
  numero_processo     text,
  titulo              text,
  recorrencia         text not null default 'avulsa'
    check (recorrencia in ('mensal','bimestral','trimestral','semestral','anual','avulsa','personalizada')),
  intervalo_dias      int,                        -- dias entre parcelas (derivado da recorrência)
  parcela_total       smallint not null default 1,
  valor_parcela       numeric(12,2),              -- valor padrão por parcela
  primeiro_vencimento date,
  observacoes         text,
  created_by          uuid references auth.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists idx_proc_acordos_processo on public.proc_acordos (numero_processo);

drop trigger if exists trg_proc_acordos_updated_at on public.proc_acordos;
create trigger trg_proc_acordos_updated_at
  before update on public.proc_acordos
  for each row execute function public.proc_set_updated_at();

-- Uma linha por parcela. `data_pagamento` preenchida = paga; status (pago /
-- vencida / pendente) é DERIVADO na leitura (compara vencimento com hoje em BRT),
-- não gravado, pra não depender de um "hoje" congelado.
create table if not exists public.proc_parcelas (
  id             uuid primary key default gen_random_uuid(),
  acordo_id      uuid not null references public.proc_acordos (id) on delete cascade,
  num            smallint not null default 1,
  valor          numeric(12,2),
  vencimento     date,
  data_pagamento date,
  observacoes    text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (acordo_id, num)
);
create index if not exists idx_proc_parcelas_acordo on public.proc_parcelas (acordo_id);
create index if not exists idx_proc_parcelas_venc   on public.proc_parcelas (vencimento);

drop trigger if exists trg_proc_parcelas_updated_at on public.proc_parcelas;
create trigger trg_proc_parcelas_updated_at
  before update on public.proc_parcelas
  for each row execute function public.proc_set_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Jurídico + gerência lê e escreve tudo (time pequeno; sem escopo por dono).
alter table public.proc_acordos  enable row level security;
alter table public.proc_parcelas enable row level security;

drop policy if exists proc_acordos_rw on public.proc_acordos;
create policy proc_acordos_rw on public.proc_acordos
  for all to authenticated
  using (public.proc_can_access()) with check (public.proc_can_access());

drop policy if exists proc_parcelas_rw on public.proc_parcelas;
create policy proc_parcelas_rw on public.proc_parcelas
  for all to authenticated
  using (public.proc_can_access()) with check (public.proc_can_access());

-- ── RPC: criar acordo + gerar parcelas ───────────────────────────────────────
-- SECURITY INVOKER: a RLS aplica (só quem passa em proc_can_access consegue
-- inserir). Gera N parcelas com vencimentos espaçados por `intervalo_dias`
-- (parcelamento recorrente). Avulsa = 1 parcela.
create or replace function public.proc_create_acordo(
  p_cliente             text,
  p_numero_processo     text,
  p_titulo              text,
  p_recorrencia         text,
  p_intervalo_dias      int,
  p_num_parcelas        int,
  p_valor_parcela       numeric,
  p_primeiro_vencimento date,
  p_observacoes         text
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
    parcela_total, valor_parcela, primeiro_vencimento, observacoes, created_by
  ) values (
    nullif(trim(coalesce(p_cliente, '')), ''),
    nullif(trim(coalesce(p_numero_processo, '')), ''),
    nullif(trim(coalesce(p_titulo, '')), ''),
    p_recorrencia, v_dias,
    v_num, p_valor_parcela, p_primeiro_vencimento,
    nullif(trim(coalesce(p_observacoes, '')), ''),
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

grant execute on function public.proc_create_acordo(text, text, text, text, int, int, numeric, date, text) to authenticated;

-- ── RPC: ingestão da planilha (script de carga única) ────────────────────────
-- SECURITY DEFINER + só service_role (molde ingest_* do repo). Recebe um acordo
-- já agrupado pelo Node, com as parcelas normalizadas (datas ISO, valores).
-- Idempotente: casa o acordo por numero_processo (senão por cliente+titulo) e
-- faz upsert das parcelas por (acordo_id, num).
create or replace function public.proc_ingest_acordo(node jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_processo    text := nullif(trim(node->>'numero_processo'), '');
  v_cliente     text := nullif(trim(node->>'cliente'), '');
  v_titulo      text := nullif(trim(node->>'titulo'), '');
  v_recorrencia text := coalesce(nullif(node->>'recorrencia', ''), 'avulsa');
  v_obs         text := nullif(node->>'observacoes', '');
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
    insert into public.proc_acordos (cliente, numero_processo, titulo, recorrencia, parcela_total, observacoes)
    values (v_cliente, v_processo, v_titulo, v_recorrencia, v_total, v_obs)
    returning id into v_acordo_id;
  else
    update public.proc_acordos set
      cliente       = coalesce(v_cliente, cliente),
      titulo        = coalesce(v_titulo, titulo),
      recorrencia   = v_recorrencia,
      parcela_total = greatest(v_total, parcela_total),
      observacoes   = coalesce(v_obs, observacoes)
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
-- SELECT id, slug FROM public.departments WHERE slug = 'juridico';  -- 1 linha
-- SELECT public.proc_parse_money('R$ 5.013,96');  -- esperado: 5013.96
-- SELECT public.proc_parse_date('2026-01-22');     -- esperado: 2026-01-22
-- SELECT public.proc_recorrencia_dias('mensal', null);  -- esperado: 30
-- -- Logado como usuário do jurídico:
-- SELECT public.proc_create_acordo('Fulana','0001','Minuta X','mensal',null,3,1000,'2026-01-22',null);
-- SELECT count(*) FROM public.proc_parcelas;  -- esperado: 3
