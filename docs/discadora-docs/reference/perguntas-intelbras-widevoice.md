# Intelbras / WidevoiceX — o que precisamos saber e pedir (base para e-mail ao suporte)

> Criado em 2026-06-24. Lista estruturada do que seria **ideal** obter da Intelbras
> (PABX em nuvem **WidevoiceX**) para o Blue Desk/Blue Desk — não só para o problema atual
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

> ✅ **Resposta da Intelbras (15/07/2026):** acompanhamento técnico via canal de Suporte;
> curadoria técnica dedicada (mais próxima) é item **contratável à parte**. Documentação:
> API Wide Voice (collection Postman) + base de conhecimento (links enviados). Cabeçalhos
> SIP e códigos de retorno **seguem o padrão do protocolo**, sem tabela proprietária divergente.
> ⚠️ **Ainda falta confirmar:** contato técnico nominal e SLA — não foram endereçados.

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

> ⚠️ **Resposta da Intelbras (15/07/2026):** "a classificação segue integralmente o padrão
> SIP (RFC 3261, 3262 e 3264) e SDP (RFC 2327). Não há uma tabela proprietária de códigos
> Q.850, a plataforma utiliza a referência padrão do protocolo."
> ⚠️ **Ainda falta confirmar:** não entregaram a tabela caso a caso pedida — não confirmaram
> qual código real aparece em cada cenário específico (ocupado / não atende / caixa postal /
> chip cancelado) no ramal de vocês. Resposta ficou no nível de protocolo, não de
> comportamento observado.

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

> ⚠️ **Resposta da Intelbras (15/07/2026):** possuem AMD via módulo **"Análise de
> Máquina"**, configurável com parâmetros: tempo total de análise, tempo de saudação,
> tempos de silêncio (inicial, após saudação e entre palavras), duração mínima de palavra,
> número máximo de palavras e limiar de silêncio.
> 🔴 **Ainda falta confirmar (crítico):** não disseram se, ao detectar máquina, **derruba a
> chamada automaticamente** ou apenas sinaliza — é a pergunta central do bloco e ficou sem
> resposta. Também não confirmaram o mecanismo de sinalização (cabeçalho/webhook/API) nem
> se há detecção de bipe/mensagem de operadora.

> 🔎 **Leitura técnica (2026-08-06) — dedução, não confirmação deles:** os oito parâmetros que
> eles listaram são, um a um, os do **`AMD()` do Asterisk** (`total_analysis_time`, `greeting`,
> `initial_silence`, `after_greeting_silence`, `between_words_silence`, `min_word_length`,
> `maximum_number_of_words`, `silence_threshold`). Se for esse o motor:
> - o `AMD()` **não derruba nada sozinho** — grava o veredito numa variável de canal
>   (`AMDSTATUS` = MACHINE/HUMAN/NOTSURE); **quem derruba é o plano de discagem**. Ou seja,
>   "derrubar" é **configuração do lado deles**, não desenvolvimento do nosso;
> - a pergunta que decide a aplicabilidade deixa de ser "vocês têm AMD?" e passa a ser:
>   **o módulo se aplica a chamadas originadas pelo RAMAL (rota de saída), ou só dentro do
>   discador/campanha da plataforma de vocês?** Se for só no discador deles, usar AMD exigiria
>   originar por API (Bloco 5) em vez do softphone — outra arquitetura;
> - **falso positivo é inerente:** o AMD do Asterisk classifica como máquina quem atende com
>   saudação longa. Com hangup automático, uma fração de leads reais cai em silêncio;
> - **codec importa:** AMD analisa energia/silêncio do áudio. Eles dizem ter só **GSM/G729**
>   habilitados (Bloco 8) — pedir **G.711** melhora a precisão da detecção.
>
> Enquanto isso não é confirmado, o Blue Desk trata caixa postal por **corte de toque**
> (derruba a linha que só toca em ~20s, antes de a caixa atender) + auto-tabulação como
> `abandoned`. Ver `../updates/preditiva-real-e-discagem-manual.md` §6.

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

> ✅ **Resposta da Intelbras (15/07/2026):** "o limite de canais simultâneos é definido
> pela quantidade de canais contratados junto à operadora, não havendo um limite técnico
> por ramal ou por tronco na plataforma", salvo se o administrador configurar restrição de
> 1 chamada simultânea por ramal. Boa notícia para o cenário 26×3=78.
> ⚠️ **Ainda falta confirmar:** limite de CPS; o que acontece e com qual código a chamada é
> rejeitada ao estourar o limite; custo/contrato para aumentar.

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

> ❌ **Resposta da Intelbras (15/07/2026):** bloco inteiro **sem resposta** — nenhum dos 5
> subitens (taxa de abandono, mensagem padrão, CLI por campanha, listas "não perturbe",
> horário) foi endereçado no e-mail.

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

> ⚠️ **Resposta da Intelbras (15/07/2026):** "disponível através da collection Postman já
> compartilhada" (aponta pro mesmo link do Bloco 0).
> ⚠️ **Ainda falta confirmar:** não confirma explicitamente se existem **webhooks/eventos
> push em tempo real** (a resposta soa como API request/response, não push); não confirma
> API de status de ramais nem API de derrubar/transferir chamada em curso.

---

## Bloco 6 — WebRTC (pode ELIMINAR o softphone utilizado) 🟢⭐
- 🟢 O WidevoiceX suporta **WebRTC** (SIP over WebSocket, `wss://`)? Endpoint e requisitos?
- 🟢 Suporta **multi-linha** por ramal via WebRTC (essencial para a preditiva)?

> **Porquê:** com WebRTC poderíamos ter um **softphone dentro do navegador**, com controle
> real de múltiplas linhas e do progresso da chamada — adeus softphone utilizado, helper, hider de
> janela e todas as gambiarras. É a evolução mais estratégica possível desta integração.

> ✅ **Resposta da Intelbras (15/07/2026):** "sim, há suporte a SIP sobre WebSocket
> (WebRTC)."
> ⚠️ **Ainda falta confirmar:** multi-linha por ramal via WebRTC não foi confirmada; e qual
> codec é usado no WebRTC (ver observação geral #1 — só GSM/G729 foram confirmados como
> habilitados, o que é atípico para WebRTC).

---

## Bloco 7 — CDR / Relatórios / Tarifação 🟡
- 🟡 Temos acesso aos **CDRs (Call Detail Records)**? Formato, **exportação/API**, latência?
- 🟡 Os CDRs trazem **causa de encerramento, duração, custo** por chamada?
- 🟢 Detalhamento de **tarifação** por chamada/estado/tipo (fixo, móvel, 0800)?

> **Porquê:** reconciliar nossos logs com os de vocês, auditar campanhas e controlar custo.

> ⚠️ **Resposta da Intelbras (15/07/2026):** exportação/API disponível; a **causa de
> encerramento está disponível apenas para ramais de call center**, não para ramais
> administrativos; duração disponível; custos das chamadas **não disponíveis nativamente**
> (podem avaliar com o time de desenvolvimento se for requisito determinante).
> ⚠️ **Ainda falta confirmar:** se os 26 ramais dos agentes serão provisionados como
> "ramais de call center" — só assim teremos causa de encerramento no CDR.

---

## Bloco 8 — Mídia, rede e qualidade 🟡
- 🟡 **Codecs** suportados e **recomendado** (G.711a/u, G.729, Opus)?
- 🟡 **Banda por chamada** recomendada (para dimensionar 26 agentes × N simultâneas)?
- 🟡 **Transporte**: UDP/TCP/**TLS**; suportam **SRTP** (mídia criptografada)?
- 🟡 **Faixa de portas RTP** e **IPs/host de mídia** para liberar no firewall do cliente.
- 🟡 Há **SBC** / requisitos de **NAT traversal (STUN/ICE)**? Recomendações de QoS.

> **Porquê:** chamada "muda"/cortando em escala costuma ser codec/banda/porta — melhor
> alinhar antes de 26 ramais discando em paralelo.

> ⚠️ **Resposta da Intelbras (15/07/2026):** codecs suportados = **GSM e G729** (habilitação
> configurável por projeto/conta); banda recomendada 32–100 kbps por chamada (~0,5–1 MB por
> minuto de conversa); suportam UDP, TCP, TLS e SRTP; faixa de portas RTP **10000–20000**;
> "não há requisitos específicos de infraestrutura adicional (firewall, SBC, NAT, STUN ou
> ICE)".
> ⚠️ **Ainda falta confirmar:** ver observação geral #1 — contradiz o datasheet anexado, que
> lista G711/G723.1/G726/iLBC/Opus/G722 entre outros. Perguntar se dá pra habilitar G.711
> (melhor qualidade/menos overhead) e qual codec o endpoint WebRTC do Bloco 6 realmente usa.

---

## Bloco 9 — Ramais e provisionamento (26 agentes) 🟡
- 🟡 Quantos **ramais** estão contratados/disponíveis? Como **provisionar em massa**?
- 🟡 Um mesmo ramal pode ter **múltiplos registros** (mesma conta em 2 lugares)? Comportamento?
- 🟢 Política de **senha/autenticação** e boas práticas de segurança dos ramais.

> **Porquê:** subir 26 agentes sem retrabalho e sem conflito de registro.

> ⚠️ **Resposta da Intelbras (15/07/2026):** sem limitação de quantidade de ramais na
> solução (pode haver limitação dependente do modelo do aparelho); um mesmo ramal pode
> ficar registrado em **até 5 dispositivos simultaneamente**; sem recomendação específica
> adicional de autenticação/segurança além das práticas padrão.
> ⚠️ **Ainda falta confirmar:** provisionamento em massa não foi endereçado diretamente
> (o datasheet cita "utilitários de importação em massa" e "importar/exportar extensões" —
> confirmar se isso vale para a conta de vocês).

---

## Bloco 10 — Numeração e discagem (validar o que já fazemos) 🟡
Hoje discamos **`021` (CSP) + DDD + número** para todos.
- 🟡 **Confirmar o formato exato esperado** pelo WidevoiceX (precisa `0` + CSP + DDD?
  Difere para **fixo × celular**?).
- 🟡 Qual é a **operadora de longa distância / CSP correto** para esta conta (é mesmo `021`)?
- 🟢 Discagem para **0800**, números curtos e **portabilidade** (afeta roteamento/tarifa)?

> **Porquê:** formato errado = chamada não completa em alguns DDDs; já tivemos esse tipo de bug.

> ⚠️ **Resposta da Intelbras (15/07/2026):** "o formato de discagem é configurável, podendo
> ser ajustado conforme a preferência de vocês, incluindo chamadas locais, longa distância,
> celulares e fixos."
> ⚠️ **Ainda falta confirmar:** resposta genérica — não confirmaram se `021` é de fato o
> CSP correto desta conta especificamente.

---

## Bloco 11 — Funcionalidades futuras 🟢
- 🟢 **Gravação de chamadas** pelo PABX (compliance + qualidade): como acessar/baixar/integrar?
- 🟢 **Monitoria do supervisor**: escuta, sussurro (whisper), barge-in?
- 🟢 **Filas / distribuição (inbound)**, URA/IVR — caso queiramos receber, não só discar.
- 🟢 **Transferência / conferência** via API.
- 🟢 **SMS / WhatsApp** integrados ao PABX?

> **Porquê:** roadmap — saber o que já vem "de graça" no WidevoiceX antes de construir.

> **Resposta da Intelbras (15/07/2026):** ✅ gravação de chamadas disponível; ✅ monitoria
> (escuta, whisper, barge-in) disponível; ✅ filas e URA disponíveis; ❌ **transferência via
> API não disponível**; ✅ integração SMS/WhatsApp disponível através do **Wide Chat**
> (produto separado).

---

## Observações gerais pós-resposta (15/07/2026)

1. **Contradição de codecs:** o datasheet Wide Voice anexado lista G729A/B, G711A/U,
   G723.1, G726, iLBC, GSM e (na seção de videoconferência) uma lista bem maior incluindo
   Opus e G722 — mas a resposta direta do Bloco 8 diz que só **GSM e G729** estão
   habilitados na conta (configurável por projeto). O datasheet parece ser material
   genérico da linha de produto, não o que está de fato ligado para vocês. Também não
   confirmaram se o WebRTC (Bloco 6) usa Opus ou os mesmos GSM/G729 — vale perguntar
   diretamente, já que WebRTC com G.729/GSM é incomum no mercado.
2. **AMD (Bloco 2) ainda em aberto no ponto mais crítico:** não confirmaram se a detecção
   de secretária eletrônica **derruba a chamada automaticamente** ou só sinaliza. Sem essa
   resposta, não dá pra saber se o problema de caixa postal está de fato resolvido do lado
   deles ou se ainda precisaríamos tratar o encerramento na nossa integração.
3. **Bloco 4 (Anatel/compliance) inteiro sem resposta** — abandono, mensagem padrão, CLI
   por campanha, listas "não perturbe" e horário não foram mencionados.
4. **Webhooks em tempo real (Bloco 5) não confirmados** — só apontaram a collection
   Postman, que parece cobrir API request/response, não eventos push de chamada.
5. **Causa de encerramento no CDR (Bloco 7) depende do tipo de ramal** — só existe para
   "ramais de call center", não para administrativos. Precisa confirmar em qual categoria
   os 26 ramais dos agentes serão provisionados.
6. **Vários pontos foram respondidos em nível de protocolo/genérico** (Bloco 1 — "seguimos
   o padrão SIP/Q.850" sem tabela caso a caso; Bloco 10 — "formato configurável" sem
   confirmar o CSP `021` da conta) em vez de específico ao cenário real de vocês (26
   agentes × 3 linhas).

---

## Sondagem técnica direta (07/08/2026) — o que descobrimos sem perguntar

Feita de forma **passiva**: DNS, TCP connect, handshake TLS e handshake WebSocket. **Nenhuma
credencial usada, nenhum ramal registrado, nenhum SIP enviado.** Ponto de partida: os campos de
servidor do `microsip.ini` da máquina do dono (`widevoice8.intelbras.com.br:7048`, `transport=udp`).

### 🟢 O endpoint WebRTC existe e está no ar (responde o Bloco 6)

```
wss://widevoice8.intelbras.com.br:8089/ws   →   HTTP/1.1 101 Switching Protocols
                                                Sec-WebSocket-Protocol: sip
```

**Teste de controle:** o mesmo handshake **sem** o subprotocolo `sip` devolve `400 Bad Request`.
Isso descarta "WebSocket genérico que aceita qualquer coisa" — o servidor valida SIP over
WebSocket (RFC 7118). É o endpoint certo.

### 🟢 A plataforma é Asterisk

O banner é `Server: Handphone/22.10.1`. O par de portas 8088 (sem TLS) + 8089 (com TLS), path
`/ws` e subprotocolo `sip` é a assinatura do `res_http_websocket` do **Asterisk**, com o nome
trocado; `22.10.1` bate com a linha do Asterisk 22. Confirmado de forma independente pelo portal:
os tipos de "Grupos de Chamada" são tradução literal das estratégias do `app_queue`
(Sequencial=`linear`, Simultâneo=`ringall`, Rotativo=`rrmemory`, Menos Recente=`leastrecent`,
Menos Chamadas=`fewestcalls`), e "Redirecionamento" tem um checkbox **"Executar Atendimento
(Answer)"** — a aplicação `Answer()` do dialplan aparecendo crua na interface.

**Portas abertas:** 443 (TLS), 5061 (SIP-TLS), 7048 (SIP UDP — a porta do tenant), 8088 (HTTP),
8089 (HTTPS/WSS). Certificado válido para `widevoice8.intelbras.com.br` até 11/set/2026.

### 🔴 Achado de segurança: hoje o áudio trafega em texto claro

A conta está em `transport=udp` com `SRTP` vazio — ou seja, **sinalização e mídia sem
criptografia**. A porta **5061 (SIP-TLS) está aberta e com certificado válido**, então existe
alternativa criptografada disponível, sem custo e sem depender do projeto WebRTC. Não foi alterado
para não mexer no ambiente durante os testes da preditiva.

### ⚠️ O que a sondagem **não** responde

1. **Multi-linha por ramal via WebRTC** — segue sendo o risco #1. Sem isso a preditiva não existe
   no navegador. Só um teste com credencial responde.
2. **Se o ramal 5125 está provisionado para WebRTC.** Porta aberta é infraestrutura do tenant,
   compartilhada. No Asterisk o endpoint precisa de `webrtc=yes` (que liga DTLS, ICE, AVPF e
   rtcp-mux). Se não estiver, o sintoma é traiçoeiro: **registra normal, disca, e não sai áudio**,
   porque o handshake DTLS não acontece. Conferir primeiro em **Sistema PABX → RAMAIS** — se for
   um checkbox no portal, resolve sozinho; senão é ticket de uma linha.
3. **Codec do endpoint WebRTC.** Navegador só fala Opus, G.711 (PCMU/PCMA) e G.722 — nunca GSM
   nem G.729. Se valer literalmente o que diz o Bloco 8, o navegador não conecta. O log real do
   MicroSIP mostrando **PCMA** é bom sinal, mas é sinal do tronco, não do endpoint WebRTC.

### 🔎 O portal não tem discador

Menu completo: Início · Call-Center (só *Calendários*) · Relatórios · Sistema PABX (Atendedor
Digital, Grupos de Chamada, Música de Espera, Ramais, Redirecionar, Status Ramais) · Facilities
(Usuários) · IA · Trocar senha.

**Tudo é roteamento de entrada.** Não há campanha, discagem ativa nem API. Logo, **o portal não
resolve o AMD na saída**, que é onde está o problema de caixa postal/bloqueio de spam.

Vale notar que "Call-Center" existe como seção e contém **apenas "Calendários"** — cheiro de
módulo licenciado que a conta não tem. Pergunta de uma linha que vale a pena: *"o que mais existe
em Call-Center? discador/campanha está disponível para a nossa conta?"*

### 🟡 "URA Script" é PHP

Cada opção do Atendedor Digital tem um link **"Ura Script"** que abre um editor Ace em
`ace/mode/php-inline` (confirmado via `session.$modeId` no console). O `-inline` indica PHP **sem**
a tag `<?php` — a plataforma injeta o trecho num arquivo maior, ou seja, é execução de PHP no
servidor, não uma DSL parecida.

Se for PHP-AGI de verdade, `$agi->exec('AMD')` + `get_variable('AMDSTATUS')` resolveria o AMD sem
WebRTC nenhum. **Mas roda em chamada recebida.** A única saída seria inverter quem origina — o
agente disca para um número interno que cai num script, e o script faz a discagem de saída com
`Dial(...,M(macro))` rodando o AMD no canal atendido. Quatro incógnitas empilhadas: existe objeto
`$agi`? dá para chegar no script por ramal interno? `Dial()` para tronco externo é permitido
(provedor sério bloqueia — é vetor de fraude de tarifa)? saída HTTP é liberada?

> ⚠️ Se for testar: **nunca na `URA_1142408044`**, que é a URA de produção do número da empresa.
> Criar um Atendedor Digital novo, sem DDR vinculado.

---

## Resumo do e-mail (versão curta para abrir a conversa)
Se quiser começar enxuto, peça primeiro o essencial e o estratégico:
1. **(Bloco 2)** Têm **AMD** em discagem ativa? Ele **derruba** a chamada em caixa postal?
2. **(Bloco 1)** Podem enviar a **tabela de códigos/causas** de resultado de chamada?
3. **(Bloco 3)** Quais os **limites de canais simultâneos por ramal e da conta** (vamos a 26×3)?
4. **(Bloco 5 e 6)** Existe **API de originação + webhooks de eventos** e/ou **WebRTC**?
5. **(Bloco 0)** Têm **documentação técnica** e um **contato de integração**?

O resto (compliance, CDR, mídia, gravação) entra na sequência conforme a resposta.
