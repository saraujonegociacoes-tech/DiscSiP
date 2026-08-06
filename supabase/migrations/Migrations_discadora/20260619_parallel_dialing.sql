-- Discagem paralela / preditiva.
-- Idempotente: pode rodar mais de uma vez sem erro.

-- 1) parallel_lines: quantas linhas o agente disca ao mesmo tempo nesta campanha.
--    Default 1 = comportamento atual (power dialer 1-a-1). >=2 liga o modo paralelo.
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS parallel_lines integer NOT NULL DEFAULT 1;

ALTER TABLE public.campaigns DROP CONSTRAINT IF EXISTS campaigns_parallel_lines_check;
ALTER TABLE public.campaigns
  ADD CONSTRAINT campaigns_parallel_lines_check CHECK (parallel_lines BETWEEN 1 AND 10);

-- 2) novo status 'abandoned' — contatos que tocaram em discagem paralela mas foram
--    derrubados (/hangupcalling) sem atender. Reciclável: o supervisor pode incluir
--    'abandoned' em recycle_statuses da lista. Recria a CHECK incluindo o valor.
ALTER TABLE public.campaign_contacts DROP CONSTRAINT IF EXISTS campaign_contacts_status_check;
ALTER TABLE public.campaign_contacts
  ADD CONSTRAINT campaign_contacts_status_check CHECK (
    status = ANY (ARRAY[
      'pending'::text, 'dialing'::text, 'answered'::text, 'no_answer'::text,
      'busy'::text, 'failed'::text, 'do_not_call'::text, 'exhausted'::text,
      'abandoned'::text
    ])
  );
