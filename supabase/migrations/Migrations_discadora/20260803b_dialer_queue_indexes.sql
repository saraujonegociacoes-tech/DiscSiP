-- Índices da FILA DO DISCADOR (campaign_contacts / lists).
--
-- Motivo: `campaign_contacts` é a maior tabela transacional do Discador (uma linha por contato
-- de mailing — dezenas de milhares por campanha) e é lida no caminho MAIS quente do produto:
-- toda vez que um agente pede o próximo contato, e N vezes por lote no modo paralelo. Sem
-- índice, cada pedido vira Seq Scan + Sort na campanha inteira, e o custo cresce com o tamanho
-- do mailing — justamente quando a operação está no pico.
--
-- O schema base do Discador foi aplicado ao vivo e não está versionado nesta pasta, então não
-- dá para afirmar daqui o que já existe: a migration é IDEMPOTENTE (`IF NOT EXISTS`) e vira
-- no-op para qualquer índice que já esteja lá. Rodar é seguro em qualquer estado.
--
-- Como conferir o efeito, antes e depois (troque o UUID por uma campanha real e grande):
--
--   EXPLAIN ANALYZE
--   SELECT id, attempts FROM public.campaign_contacts
--    WHERE campaign_id = '<uuid>' AND status = 'pending'
--    ORDER BY created_at ASC LIMIT 10;
--
-- Esperado: sair de "Seq Scan + Sort" para "Index Scan using campaign_contacts_queue_idx",
-- com o tempo deixando de acompanhar o tamanho da campanha.

-- 1) A fila em si: filtro por campanha + status, ordenado por chegada.
--    Serve getNextContact/getNextContacts (WHERE campaign_id = ? AND status = 'pending'
--    ORDER BY created_at LIMIT n) e também a contagem por status da view
--    v_campaign_status_counts (GROUP BY campaign_id, status), que hoje varre a campanha toda.
CREATE INDEX IF NOT EXISTS campaign_contacts_queue_idx
  ON public.campaign_contacts (campaign_id, status, created_at);

-- 2) Reciclagem (recycleCampaign): os dois UPDATEs filtram por lista + status antes de olhar
--    attempts/dialed_at. Sem isto, cada ciclo de reciclagem varre todos os contatos da lista.
CREATE INDEX IF NOT EXISTS campaign_contacts_recycle_idx
  ON public.campaign_contacts (list_id, status);

-- 3) Listas com reciclagem ligada de uma campanha (lido a cada reciclagem).
CREATE INDEX IF NOT EXISTS lists_campaign_idx
  ON public.lists (campaign_id);

-- Observação para bases já grandes: `CREATE INDEX` toma lock de escrita na tabela enquanto
-- constrói. Se a operação estiver discando no momento, rode cada comando isolado como
-- `CREATE INDEX CONCURRENTLY IF NOT EXISTS ...` (não pode estar dentro de transação/bloco —
-- execute um por vez no SQL Editor).
