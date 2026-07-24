# Aquecimento de números WhatsApp

Índice da documentação do **módulo de aquecimento**. Código e dados em **domínio separado**
do Discador, do Dashboard de Leads e do Painel de CS (RLS, tabelas e rotas próprios, prefixo
`warmup_`) — a doc vive junto em `docs/updates/` só por organização. Ver também
[`../links.md`](../links.md) (índice geral por domínio).

> **Estado (20/jul/2026): código pronto e verde; falta só configuração.** Migrations
> `20260719` **e** `20260719b` **aplicadas** no Supabase; painel com **modo Sessão (24h) ou
> Gradual (dias)** selecionável (ver "Modos de operação"). O cenário **"Aquecimento · Disparo"
> já está montado no Make** — o próximo passo (bloqueador do go-live) é **atribuir os ativos
> (WABAs) ao System User na Meta e gerar o token**; depois, secrets + flag + cadastro do pool.
> **Retomar por:** seção ["Estado em 20/jul — o que falta"](aquecimento-whatsapp.md#estado-em-20jul2026--retomar-aqui)
> em [`aquecimento-whatsapp.md`](aquecimento-whatsapp.md).

## O que é
Até 6 números WhatsApp da **mesma BM** (várias WABAs) conversam entre si automaticamente
para construir reputação/quality rating antes de entrarem em campanhas de disparo real. O
Blue Desk é o plano de controle (decide quem/quando/o quê, grava histórico, dispara o Make);
o **Make** executa a chamada na Graph API da Meta e devolve o resultado.

## Regra central (janela de 24h)
A Cloud API exige **template aprovado** para abrir qualquer conversa sem sessão de 24h ativa
(não dá para fugir 100%). Cada conversa **abre com 1 template leve** e segue em **texto
livre variado** dentro das 24h. A janela é derivada do próprio `warmup_messages` (a janela
abre em quem recebeu; os dois lados são do Blue Desk) — **sem** webhook de status da Meta no
MVP. Detalhe em [`aquecimento-whatsapp.md`](aquecimento-whatsapp.md), decisão 3.

## Schema + orquestração (Sprints 1–3)
- [`../../supabase/migrations/20260719_warmup_schema.sql`](../../supabase/migrations/20260719_warmup_schema.sql)
  — tabelas `warmup_numbers`/`warmup_settings`/`warmup_ramp_stages`/`warmup_templates`/
  `warmup_conversations`/`warmup_messages`, RLS (só manager/admin; execução escrita só por
  `service_role`), seeds.
- `src/lib/warmup/tick.ts` — orquestração (`runWarmupTick`): elegibilidade, rampa,
  template-vs-sessão, anti-repetição, pacing por gap aleatório e teto por tick.
- `src/app/api/aquecimento/tick` e `.../dispatch-result` — endpoints (cron + callback do
  Make), protegidos por segredo.
- `src/app/actions/warmup.ts` — CRUD + `runWarmupTickManually`. `warmup-notifications.ts` —
  contrato do webhook.
- `src/app/aquecimento/` — painel (pool, config, templates, histórico, "rodar tick agora").
- `.github/workflows/aquecimento-tick.yml` — cron via GitHub Actions (Cloudflare Pages não
  tem Cron Triggers).

## Integração Make (Sprint 4)
[`make-integracao-aquecimento.md`](make-integracao-aquecimento.md) — cenário de Disparo
(webhook → Router template/session → Graph API → callback) e status Meta (fase 2). System
User único da BM, módulo HTTP genérico.

## Segurança
Módulo sensível (risco de bloqueio de conta/BM). Só **supervisor/manager/admin** (RLS + item
da Sidebar + guard no `middleware.ts`); agente não. `dry_run=true` de fábrica — nada é enviado
à Meta até o dono revisar a simulação e virar o modo real.
