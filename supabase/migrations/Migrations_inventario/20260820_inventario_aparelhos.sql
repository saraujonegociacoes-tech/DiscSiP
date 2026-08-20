-- ============================================================================
-- 20260820_inventario_aparelhos.sql — Central de Aparelhos (inventário de TI)
-- ============================================================================
-- Área nova do Blue Desk (rota `/aparelhos`): inventário dos celulares da
-- empresa, dos chips e de quem está com cada aparelho. Ver
-- docs/inventario-docs/updates/central-de-aparelhos.md.
--
-- MOLDE: app-native/CRUD, igual às Minutas Processuais (20260731b) e ao módulo
-- Monday — o app LÊ E ESCREVE com RLS aplicada (createServerClient → auth.uid()).
-- Não é espelho de pipe: não existe ingestão, o dado nasce aqui.
--
-- ACESSO — é TRANSVERSAL, não é vertical de departamento (todo departamento tem
-- celular da empresa). Por isso o gate é por PAPEL, não por `department_id`:
--   · LEEM     supervisor, manager, admin  (consultar quem está com o quê)
--   · ESCREVEM            manager, admin   (cadastrar/editar/remover)
--   · fora:    agent, pending, ceo  (o `ceo` já é barrado antes, no middleware)
--
-- O papel `tester` NÃO aparece nas listas de propósito: `current_profile_role()`
-- (20260807_tester_rls_effective_role.sql) já devolve 'admin' para ele. Reusar
-- esse helper transversal em vez de escrever um `inv_current_role()` próprio é o
-- que evita repetir o bug que 20260803b_proc_can_access_tester.sql teve que
-- corrigir no /minutas — lá o tester entrava na página e a RLS devolvia zero linha.
--
-- PREFIXO `inv_` em tudo, para não colidir com nenhum outro domínio.
--
-- IDEMPOTENTE: pode ser reaplicada com segurança (aplicada à mão no SQL Editor).
-- ============================================================================

create extension if not exists "pgcrypto";

-- ── Helper: updated_at automático (namespaced) ───────────────────────────────
create or replace function public.inv_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ── Gates de acesso ──────────────────────────────────────────────────────────
-- Ambos em cima de `current_profile_role()` (SECURITY DEFINER, transversal, e já
-- mapeia tester→admin). Separados porque leitura e escrita têm alcances
-- diferentes: o supervisor consulta o inventário mas não mexe nele.
create or replace function public.inv_can_read() returns boolean
language sql stable set search_path = public as $$
  select public.current_profile_role() in ('supervisor', 'manager', 'admin')
$$;

create or replace function public.inv_can_write() returns boolean
language sql stable set search_path = public as $$
  select public.current_profile_role() in ('manager', 'admin')
$$;

-- ── Pessoas ──────────────────────────────────────────────────────────────────
-- Lista PRÓPRIA de colaboradores, não `profiles`: quem tem celular da empresa
-- nem sempre é usuário do Blue Desk. `profile_id` é o vínculo OPCIONAL para
-- quando a pessoa também for usuária — permite achar o perfil sem duplicar a
-- identidade. `on delete set null`: excluir o usuário no /admin não pode apagar
-- o registro de quem está com o aparelho.
create table if not exists public.inv_pessoas (
  id           uuid primary key default gen_random_uuid(),
  nome         text not null,
  departamento text,
  profile_id   uuid references public.profiles (id) on delete set null,
  observacoes  text,
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Um perfil do Blue Desk se liga a no máximo uma pessoa do inventário.
create unique index if not exists ux_inv_pessoas_profile
  on public.inv_pessoas (profile_id) where profile_id is not null;

drop trigger if exists trg_inv_pessoas_updated_at on public.inv_pessoas;
create trigger trg_inv_pessoas_updated_at
  before update on public.inv_pessoas
  for each row execute function public.inv_set_updated_at();

-- ── Aparelhos ────────────────────────────────────────────────────────────────
-- `status` guarda SLUG ('em_uso'), não o rótulo de tela ('Em uso'): rótulo é
-- decisão de interface e muda; slug é dado. A tradução mora em
-- src/features/aparelhos/shared.ts.
-- `pessoa_id` nulo = aparelho sem responsável (em estoque).
create table if not exists public.inv_aparelhos (
  id          uuid primary key default gen_random_uuid(),
  modelo      text not null,
  imei        text,
  pessoa_id   uuid references public.inv_pessoas (id) on delete set null,
  status      text not null default 'estoque'
    check (status in ('em_uso', 'estoque', 'manutencao')),
  observacoes text,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_inv_aparelhos_pessoa on public.inv_aparelhos (pessoa_id);

-- IMEI é identidade de hardware: dois aparelhos com o mesmo IMEI é erro de
-- digitação, não caso real. Único quando preenchido, comparando só os dígitos
-- (para "35 274 011..." não passar como diferente de "35274011...").
create unique index if not exists ux_inv_aparelhos_imei
  on public.inv_aparelhos ((regexp_replace(imei, '\D', '', 'g')))
  where imei is not null and imei <> '';

drop trigger if exists trg_inv_aparelhos_updated_at on public.inv_aparelhos;
create trigger trg_inv_aparelhos_updated_at
  before update on public.inv_aparelhos
  for each row execute function public.inv_set_updated_at();

-- ── Chips ────────────────────────────────────────────────────────────────────
-- O LIMITE DE 2 CHIPS POR APARELHO É REGRA DE BANCO, não aviso de tela: o `slot`
-- (1 ou 2) + `unique (aparelho_id, slot)` tornam o terceiro chip impossível, sem
-- depender de contagem no app (que teria corrida entre duas abas abertas). De
-- quebra, o slot dá significado estável às colunas "Chip 1"/"Chip 2" da Visão
-- Geral — a ordem não muda a cada leitura.
--
-- O par (aparelho_id, slot) anda junto: ou o chip está solto (os dois nulos) ou
-- está vinculado a um slot. Quem escolhe o slot livre é a RPC inv_assign_chip.
create table if not exists public.inv_chips (
  id          uuid primary key default gen_random_uuid(),
  numero      text not null,
  operadora   text,
  tipo        text not null default 'pre' check (tipo in ('pre', 'pos')),
  aparelho_id uuid references public.inv_aparelhos (id) on delete set null,
  slot        smallint check (slot in (1, 2)),
  observacoes text,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint inv_chips_slot_pareado check ((aparelho_id is null) = (slot is null)),
  constraint inv_chips_slot_unico unique (aparelho_id, slot)
);

create index if not exists idx_inv_chips_aparelho on public.inv_chips (aparelho_id);

-- Mesmo raciocínio do IMEI: o mesmo número de linha em dois cadastros é erro.
create unique index if not exists ux_inv_chips_numero
  on public.inv_chips ((regexp_replace(numero, '\D', '', 'g')))
  where numero is not null and numero <> '';

drop trigger if exists trg_inv_chips_updated_at on public.inv_chips;
create trigger trg_inv_chips_updated_at
  before update on public.inv_chips
  for each row execute function public.inv_set_updated_at();

-- ⚠️ Sem este trigger, EXCLUIR UM APARELHO FALHA. O `on delete set null` da FK
-- zera `aparelho_id` mas não sabe de `slot`, e a linha resultante (aparelho nulo
-- + slot 1) viola `inv_chips_slot_pareado`. Solta os chips ANTES da FK agir.
create or replace function public.inv_soltar_chips_do_aparelho()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  update public.inv_chips
     set aparelho_id = null, slot = null
   where aparelho_id = old.id;
  return old;
end;
$$;

drop trigger if exists trg_inv_aparelhos_soltar_chips on public.inv_aparelhos;
create trigger trg_inv_aparelhos_soltar_chips
  before delete on public.inv_aparelhos
  for each row execute function public.inv_soltar_chips_do_aparelho();

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Leitura e escrita separadas (ao contrário do `for all` das Minutas): aqui o
-- supervisor consulta mas não altera. As quatro policies por tabela são iguais
-- nas três, então saem de um laço — escrever doze à mão é como se esquece uma.
alter table public.inv_pessoas   enable row level security;
alter table public.inv_aparelhos enable row level security;
alter table public.inv_chips     enable row level security;

do $$
declare t text;
begin
  foreach t in array array['inv_pessoas', 'inv_aparelhos', 'inv_chips'] loop
    -- O nome da policy vai montado ANTES do %I (t || '_select'), não como %I_select:
    -- assim o format cita o identificador inteiro. Com '%I_select' ele citaria só o
    -- `t` e o sufixo ficaria de fora das aspas — inofensivo com estes nomes, sintaxe
    -- inválida no dia em que alguém puser um nome que precise de aspas.
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);

    execute format(
      'create policy %I on public.%I for select to authenticated using (public.inv_can_read())',
      t || '_select', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.inv_can_write())',
      t || '_insert', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.inv_can_write()) with check (public.inv_can_write())',
      t || '_update', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated using (public.inv_can_write())',
      t || '_delete', t);
  end loop;
end $$;

-- ── RPC: vincular/desvincular chip ───────────────────────────────────────────
-- Escolher o slot livre é decisão de BANCO, não do app: dois usuários vinculando
-- chips ao mesmo aparelho ao mesmo tempo escolheriam o slot 1 os dois. Aqui a
-- unique resolve — o perdedor recebe o erro tratado, não uma linha errada.
--
-- p_aparelho_id nulo = desvincular. Chip que já está no aparelho mantém o slot.
-- SECURITY INVOKER: a RLS de UPDATE (inv_can_write) continua valendo.
create or replace function public.inv_assign_chip(p_chip_id uuid, p_aparelho_id uuid)
returns void
language plpgsql security invoker set search_path = public as $$
declare
  v_slot_atual smallint;
  v_ap_atual   uuid;
  v_slot       smallint;
begin
  select aparelho_id, slot into v_ap_atual, v_slot_atual
  from public.inv_chips where id = p_chip_id;

  if not found then
    raise exception 'Chip não encontrado.' using errcode = 'no_data_found';
  end if;

  if p_aparelho_id is null then
    update public.inv_chips set aparelho_id = null, slot = null where id = p_chip_id;
    return;
  end if;

  -- Já está neste aparelho: nada a fazer (mantém o slot que ocupa hoje).
  if v_ap_atual = p_aparelho_id then
    return;
  end if;

  select s into v_slot
  from unnest(array[1, 2]::smallint[]) as s
  where not exists (
    select 1 from public.inv_chips c
    where c.aparelho_id = p_aparelho_id and c.slot = s
  )
  order by s
  limit 1;

  if v_slot is null then
    raise exception 'Este aparelho já tem 2 chips vinculados. Desvincule um antes.'
      using errcode = 'check_violation';
  end if;

  update public.inv_chips
     set aparelho_id = p_aparelho_id, slot = v_slot
   where id = p_chip_id;
end;
$$;

grant execute on function public.inv_assign_chip(uuid, uuid) to authenticated;

-- ── Conferir depois de aplicar ──────────────────────────────────────────────
-- SELECT public.inv_can_read(), public.inv_can_write();  -- conforme o seu papel
-- -- Logado como manager/admin:
-- INSERT INTO public.inv_pessoas (nome, departamento) VALUES ('Teste', 'TI');
-- INSERT INTO public.inv_aparelhos (modelo, imei, status) VALUES ('iPhone 13', '111', 'estoque');
-- INSERT INTO public.inv_chips (numero, operadora, tipo) VALUES ('11999990001', 'Vivo', 'pos');
-- INSERT INTO public.inv_chips (numero, operadora, tipo) VALUES ('11999990002', 'Claro', 'pre');
-- INSERT INTO public.inv_chips (numero, operadora, tipo) VALUES ('11999990003', 'Tim', 'pre');
-- -- vincula os três no mesmo aparelho: o 3º tem que FALHAR com a mensagem do limite
-- SELECT public.inv_assign_chip('<chip1>', '<aparelho>');
-- SELECT public.inv_assign_chip('<chip2>', '<aparelho>');
-- SELECT public.inv_assign_chip('<chip3>', '<aparelho>');  -- esperado: erro
-- DELETE FROM public.inv_aparelhos WHERE id = '<aparelho>';  -- tem que funcionar
-- SELECT aparelho_id, slot FROM public.inv_chips;            -- os dois soltos (null/null)
