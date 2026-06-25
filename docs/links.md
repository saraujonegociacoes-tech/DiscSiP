# Documentação — DiscSiP / Blue Line

Organização das docs por tipo. O README do projeto fica na raiz (`../README.md`).

## `reference/` — base e fonte de verdade
- [`arquitetura-e-proximos-passos.md`](reference/arquitetura-e-proximos-passos.md) — arquitetura, decisões e histórico (fonte de verdade)
- [`discadora-microsip-integracao.md`](reference/discadora-microsip-integracao.md) — integração discador ↔ MicroSIP (comandos, eventos, hooks)
- [`perguntas-intelbras-widevoice.md`](reference/perguntas-intelbras-widevoice.md) — o que pedir ao suporte Intelbras (AMD/caixa postal, limites, API, WebRTC…)
- [`plan.md`](reference/plan.md) — planejamento inicial

## `updates/` — features e mudanças de arquitetura
- [`discagem-paralela-preditiva.md`](updates/discagem-paralela-preditiva.md) — discagem paralela/preditiva (estudo + testes + implementação)
- [`discagem-em-background-dialer-engine.md`](updates/discagem-em-background-dialer-engine.md) — **design** para discar fora da tela do discador (DialerEngine) · *não implementado*

## `fixes/` — correções de bugs
- [`correcoes-producao-2026-06.md`](fixes/correcoes-producao-2026-06.md) — lote de produção jun/2026 (#1 tabulação, #2 fuso, #4 mute, #5 dashboard do agente; #3 pendente)
- [`correcoes-discadora-sprints.md`](fixes/correcoes-discadora-sprints.md) — 1ª leva de correções da discadora (sprints)
