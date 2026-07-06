# Intelbras / WidevoiceX — o que precisamos saber e pedir (base para e-mail ao suporte)

> Criado em 2026-06-24. Lista estruturada do que seria **ideal** obter da Intelbras
> (PABX em nuvem **WidevoiceX**) para o Blue Line/Blue Line — não só para o problema atual
> de caixa postal, mas para capacidade, compliance, integração e funcionalidades futuras.
>
> **Contexto que eles precisam ter:** discadora ativa (power + preditiva) com até **26
> agentes**, cada um num ramal SIP via **softphone utilizado** (cliente PJSIP) → conta no
> `widevoice8.intelbras.com.br:7048` (UDP). Discagem preditiva disca **N=3 linhas em
> paralelo** por agente e derruba as que não atendem. Ramal de referência nos testes: **5125**.
>
> **Legenda de prioridade:** 🔴 bloqueia/atrapalha hoje · 🟡 importante · 🟢 futuro/estratégico.

---

## Bloco 0 — Canal técnico e documentação (abrir a porta certa)
- 🟡 Existe **suporte técnico de integração/engenharia** (não só comercial)? Qual canal e SLA?
- 🟡 Há **documentação técnica do WidevoiceX**: manual SIP, guia de API, lista de
  cabeçalhos/códigos? Podem enviar?
- 🟡 Podemos ter um **contato técnico nominal** para tratar de integração de discadora?

> **Porquê:** muita coisa abaixo só anda com a pessoa certa do lado deles. Vale abrir o
> canal antes de despejar perguntas.

---

## Bloco 1 — Classificação de chamadas / códigos de resultado ⭐ (o pedido central)
Queremos o **mapa completo** de como cada desfecho de chamada é sinalizado, para o
discador classificar com precisão (hoje inferimos por heurística de tempo/código).

- 🔴 **Lista de todos os códigos SIP de resposta** que o PABX devolve em discagem ativa e
  o significado **de cada um no contexto de vocês**. Em especial, como vocês diferenciam:
  - Atendida (humano) — `200 OK`
  - Ocupado — `486` / `600`
  - Número inexistente/inválido — `404` / `484`
  - Desligado / fora de área / indisponível — `480` / `503`
  - Não atende (tocou e ninguém pegou) — `408`? `480`? `487`?
  - **Caixa postal / secretária eletrônica** — qual código/sinal? (ver Bloco 2)
  - Chip cancelado / bloqueado / portado
  - Recusada / "Não Perturbe"
- 🟡 Em **cabeçalhos SIP** (`Reason`, `Q.850 cause code`, `X-*`, `P-Asserted-Identity`,
  `Diversion`, `History-Info`): vocês enviam a **causa real** do desfecho? Quais e com qual conteúdo?
- 🟡 Tabela de **cause codes Q.850** usada por vocês (ex.: 16 normal, 17 busy, 18 no user
  responding, 19 no answer, 21 rejected, 1/3 unallocated).

> **Porquê:** isso melhora a tabulação automática, a reciclagem de mailing (não insistir
> em número inválido/cancelado), relatórios e várias features futuras — não só a caixa postal.

---

## Bloco 2 — Caixa postal / AMD (problema atual, bloqueado neles) 🔴
Confirmamos na doc oficial do softphone utilizado que **ele não tem como detectar caixa postal**
(para o SIP, a caixa "atende" igual a humano: `200 OK`). A detecção (AMD) só é possível
**onde existe o áudio = no PABX de vocês**.

- 🔴 O WidevoiceX oferece **AMD (Answering Machine Detection)** em discagem ativa?
- 🔴 Se sim, ao detectar máquina ele **derruba a chamada automaticamente** ou apenas
  **sinaliza** (cabeçalho/evento)? **(Para nós, o ideal é que DERRUBE** — aí nossa
  integração já trata o encerramento sozinho, sem o agente perder tempo.)
- 🟡 Se só sinaliza: por **qual mecanismo** (cabeçalho SIP, webhook, API)? É configurável
  para derrubar?
- 🟡 Há **detecção de bipe** (beep) e de **mensagem de operadora** ("este número não
  existe", "aparelho desligado")?

> **Porquê:** é o único caminho para resolver a perda de 2–3 min/agente em caixa postal
> "pelas costas do agente". Sem AMD no PABX, não há solução automática confiável na stack atual.

---

## Bloco 3 — Limites de capacidade (crítico para preditiva) 🔴
A preditiva multiplica chamadas simultâneas. Precisamos dimensionar **antes** de escalar.

- 🔴 **Limite de canais simultâneos por ramal** (quantas chamadas um ramal sustenta ao mesmo tempo)?
- 🔴 **Limite global de chamadas simultâneas** da conta/tronco (teto do PABX)?
  - Cenário real: **26 agentes × 3 linhas = 78** chamadas simultâneas (e picos maiores).
- 🟡 Existe limite de **CPS (chamadas por segundo / taxa de originação)**? Qual?
- 🟡 Ao **estourar** o limite, o que acontece e com **qual código** a chamada é rejeitada
  (para distinguirmos "ocupado real" de "estourei meu limite")?
- 🟡 Dá para **aumentar** esses limites? Tem custo/contrato associado?

> **Porquê:** os testes locais foram com 1 agente; o gargalo de produção é o teto de
> vocês, e não dá para testar isso aqui sem arriscar derrubar a operação.

---

## Bloco 4 — Compliance / Anatel (risco legal da preditiva) 🟡
Discagem preditiva gera **chamadas abandonadas** (quando ninguém atende a tempo / quando
2 atendem na mesma janela). Há regras no Brasil.

- 🟡 Vocês têm **orientação/limites de taxa de abandono** para discadora preditiva (Anatel)?
- 🟡 O PABX consegue **tocar uma mensagem padrão** em chamada abandonada (exigência comum)?
- 🟡 **Identificação do chamador (Bina/CLI):** qual número aparece para o destinatário?
  Podemos **definir/personalizar** o número de origem por campanha?
- 🟡 Há suporte/integração a listas **"Não Perturbe" / bloqueio (Procon, Não Me Perturbe)**?
- 🟢 Restrições de **horário** de discagem impostas pela operadora?

> **Porquê:** evita multa/bloqueio e orienta como configurar a preditiva de forma defensável.

---

## Bloco 5 — API / Webhooks de chamada (pode SIMPLIFICAR a arquitetura) 🟢⭐
Hoje originamos chamadas e lemos eventos via softphone utilizado + um "helper" local (gambiarra que
funciona, mas é frágil). Se vocês tiverem API, talvez possamos eliminar boa parte disso.

- 🟢 Existe **API REST** para **originar chamada** (click-to-call) a partir do nosso sistema?
- 🟢 Existem **webhooks/eventos em tempo real** de chamada (originada, tocando, atendida,
  encerrada, **com a causa**)? Formato e autenticação?
- 🟢 Existe **API de status** de chamadas/ramais ativos?
- 🟢 Há API para **derrubar/transferir** uma chamada em curso?

> **Porquê:** webhooks com causa real + originação por API substituiriam o softphone utilizado/helper,
> dariam classificação confiável (resolve Blocos 1 e 2 de quebra) e reduziriam pontos de falha.

---

## Bloco 6 — WebRTC (pode ELIMINAR o softphone utilizado) 🟢⭐
- 🟢 O WidevoiceX suporta **WebRTC** (SIP over WebSocket, `wss://`)? Endpoint e requisitos?
- 🟢 Suporta **multi-linha** por ramal via WebRTC (essencial para a preditiva)?

> **Porquê:** com WebRTC poderíamos ter um **softphone dentro do navegador**, com controle
> real de múltiplas linhas e do progresso da chamada — adeus softphone utilizado, helper, hider de
> janela e todas as gambiarras. É a evolução mais estratégica possível desta integração.

---

## Bloco 7 — CDR / Relatórios / Tarifação 🟡
- 🟡 Temos acesso aos **CDRs (Call Detail Records)**? Formato, **exportação/API**, latência?
- 🟡 Os CDRs trazem **causa de encerramento, duração, custo** por chamada?
- 🟢 Detalhamento de **tarifação** por chamada/estado/tipo (fixo, móvel, 0800)?

> **Porquê:** reconciliar nossos logs com os de vocês, auditar campanhas e controlar custo.

---

## Bloco 8 — Mídia, rede e qualidade 🟡
- 🟡 **Codecs** suportados e **recomendado** (G.711a/u, G.729, Opus)?
- 🟡 **Banda por chamada** recomendada (para dimensionar 26 agentes × N simultâneas)?
- 🟡 **Transporte**: UDP/TCP/**TLS**; suportam **SRTP** (mídia criptografada)?
- 🟡 **Faixa de portas RTP** e **IPs/host de mídia** para liberar no firewall do cliente.
- 🟡 Há **SBC** / requisitos de **NAT traversal (STUN/ICE)**? Recomendações de QoS.

> **Porquê:** chamada "muda"/cortando em escala costuma ser codec/banda/porta — melhor
> alinhar antes de 26 ramais discando em paralelo.

---

## Bloco 9 — Ramais e provisionamento (26 agentes) 🟡
- 🟡 Quantos **ramais** estão contratados/disponíveis? Como **provisionar em massa**?
- 🟡 Um mesmo ramal pode ter **múltiplos registros** (mesma conta em 2 lugares)? Comportamento?
- 🟢 Política de **senha/autenticação** e boas práticas de segurança dos ramais.

> **Porquê:** subir 26 agentes sem retrabalho e sem conflito de registro.

---

## Bloco 10 — Numeração e discagem (validar o que já fazemos) 🟡
Hoje discamos **`021` (CSP) + DDD + número** para todos.
- 🟡 **Confirmar o formato exato esperado** pelo WidevoiceX (precisa `0` + CSP + DDD?
  Difere para **fixo × celular**?).
- 🟡 Qual é a **operadora de longa distância / CSP correto** para esta conta (é mesmo `021`)?
- 🟢 Discagem para **0800**, números curtos e **portabilidade** (afeta roteamento/tarifa)?

> **Porquê:** formato errado = chamada não completa em alguns DDDs; já tivemos esse tipo de bug.

---

## Bloco 11 — Funcionalidades futuras 🟢
- 🟢 **Gravação de chamadas** pelo PABX (compliance + qualidade): como acessar/baixar/integrar?
- 🟢 **Monitoria do supervisor**: escuta, sussurro (whisper), barge-in?
- 🟢 **Filas / distribuição (inbound)**, URA/IVR — caso queiramos receber, não só discar.
- 🟢 **Transferência / conferência** via API.
- 🟢 **SMS / WhatsApp** integrados ao PABX?

> **Porquê:** roadmap — saber o que já vem "de graça" no WidevoiceX antes de construir.

---

## Resumo do e-mail (versão curta para abrir a conversa)
Se quiser começar enxuto, peça primeiro o essencial e o estratégico:
1. **(Bloco 2)** Têm **AMD** em discagem ativa? Ele **derruba** a chamada em caixa postal?
2. **(Bloco 1)** Podem enviar a **tabela de códigos/causas** de resultado de chamada?
3. **(Bloco 3)** Quais os **limites de canais simultâneos por ramal e da conta** (vamos a 26×3)?
4. **(Bloco 5 e 6)** Existe **API de originação + webhooks de eventos** e/ou **WebRTC**?
5. **(Bloco 0)** Têm **documentação técnica** e um **contato de integração**?

O resto (compliance, CDR, mídia, gravação) entra na sequência conforme a resposta.
