# Plano — Softphone WebRTC no navegador (fim do local-helper)

> Criado em 2026-08-14. Plano de alteração para substituir o **local-helper + MicroSIP** por um
> **softphone SIP dentro do navegador** (SIP over WebSocket / WebRTC), sem instalação nenhuma na
> máquina do agente. Objetivo declarado: **paridade total** com o que já funciona hoje, reusando
> o código existente em vez de reescrever.
>
> Base de decisão: [`../reference/perguntas-intelbras-widevoice.md`](../reference/perguntas-intelbras-widevoice.md)
> §Sondagem técnica (07/08) e [`preditiva-real-e-discagem-manual.md`](preditiva-real-e-discagem-manual.md).

---

## 📍 Status das etapas (atualizado em 14/08/2026)

| Etapa | O que é | Status |
|---|---|---|
| **0** | Spike de validação (GATE) | 🔴 **RODADO em 14/08 — bloqueado na Intelbras.** Ver §1.1 |
| **1** | Camada de transporte (`src/lib/telephony/`) | ✅ **Concluída** — app idêntico, ainda no helper |
| **2** | Credenciais SIP (migration + admin) | ⛔ **Bloqueada** pelo resultado da Etapa 0 |
| **3** | `webrtcTransport` 1-a-1 | ⛔ **Bloqueada** pelo resultado da Etapa 0 |
| **4** | `webrtcTransport` paralelo | ⛔ Bloqueada (multi-linha nem chegou a ser testada) |
| **5** | Limpeza (apaga o helper) | ⏳ Não começada |

> 🔴 **O projeto está parado num ticket da Intelbras, não em desenvolvimento.** O ramal registra
> por WebRTC, mas **toda chamada é recusada com `488 Not Acceptable Here`** — o PABX não aceita a
> mídia que o navegador oferece. Nenhuma linha de código nossa resolve isso. Texto do pedido
> pronto em §1.2.

### ✅ Entregue na Etapa 1 (14/08)

Refatoração **sem mudança de comportamento** — o discador funciona exatamente como antes, ainda
pelo helper + MicroSIP. Verificado: `tsc --noEmit` limpo, `eslint` limpo, `npm run build` passa e
a rota `/softphone` **não inflou** (1,35 kB / 104 kB First Load — o `sip.js` está instalado mas
ainda não é importado por nenhum código do app).

| Arquivo | O que é |
|---|---|
| `src/lib/telephony/types.ts` | A interface `TelephonyTransport` — espelha a superfície do helper |
| `src/lib/telephony/number.ts` | `formatNumber`/`digitsOf`/`sameNumber`/`isExtension` **portados literais** do helper |
| `src/lib/telephony/helperTransport.ts` | O fluxo atual (helper + MicroSIP) atrás da interface |
| `src/lib/telephony/index.ts` | `getTransport()` / `setTelephonyMode()` — troca de transporte em runtime |
| `scripts/probe-webrtc-sip.html` | O probe da Etapa 0 (ver §1) |

**Migrados para a camada** (nenhum fala mais com o helper direto): `usePowerDialer.ts`,
`ManualDialTab.tsx`, `CallControls.tsx`, `SoftphoneClient.tsx`, `DialerTab.tsx`.

Duas decisões tomadas durante a implementação:

1. **`call()` lança em falha.** A discagem manual mostra o erro ao agente ("a ligação não foi
   disparada"), o power dialer engole. Se o método engolisse, a discagem manual perderia o aviso —
   seria uma regressão silenciosa.
2. **O `POST /update` do helper NÃO passou pela camada.** É manutenção do processo local, não
   telefonia: o transporte WebRTC nunca teria equivalente. Fica com `helperFetch` direto no
   `SoftphoneClient` e morre inteiro na Etapa 5.

### ⏳ Pendente do dono (bloqueia tudo daqui pra frente)

**Abrir o ticket da §1.2 na Intelbras** (ramal 5125, habilitar mídia WebRTC). O texto está
pronto. Antes de enviar, vale rodar o botão **"0 · Diagnóstico de mídia"** do probe e colar a
lista de codecs no chamado — é a prova do que o navegador oferece.

---

## 0.1. Por que isso vale a pena (o motivador real)

O gatilho deste projeto **não** é elegância técnica nem o AMD — é o **custo operacional de manter
software desktop em 26 máquinas**. Sintomas registrados em produção em ago/2026:

- modal `Failed to open file for writing microsip.ini` em **todas** as máquinas
  ([fix v1.15](../fixes/correcao-modal-ini-e-janela-visivel.md))
- toda publicação de helper vira um evento de risco (versões convivendo, helper que não sobe)
- janela do softphone aparecendo na frente do agente
- zero visibilidade: para diagnosticar, é preciso chegar na máquina do agente e ler o `helper.log`
- botão "Ligar helper" que falha **em silêncio** quando a pasta muda de lugar (caminho absoluto
  gravado no registro)

Nenhum desses é um bug isolado — são a **mesma raiz**. Cada um se conserta, e o próximo aparece
na atualização seguinte. O softphone no navegador elimina a raiz: sem instalação, sem `.ini`, sem
helper, sem janela, e com log central.

Ver [`../reference/helper-anatomia.md`](../reference/helper-anatomia.md) para dimensionar o que
some: a maior parte das 1145 linhas do helper **não é discagem**, é contorno de MicroSIP e Windows.

---

## 0. Por que isso é possível agora

O [`README.md`](../../../README.md) e [`../reference/arquitetura-e-proximos-passos.md`](../reference/arquitetura-e-proximos-passos.md)
dizem que o servidor Intelbras só aceita `ws://` — **isso está desatualizado**. Foi medido na porta
7048. A sondagem de 07/08 encontrou o endpoint certo:

```
wss://widevoice8.intelbras.com.br:8089/ws  →  101 Switching Protocols
                                              Sec-WebSocket-Protocol: sip
```

Sem o subprotocolo `sip` o servidor devolve `400` — é SIP over WebSocket (RFC 7118) de verdade,
não WebSocket genérico. Plataforma: **Asterisk 22** (`Handphone/22.10.1`). A Intelbras confirmou
por escrito em 15/07 (Bloco 6).

> ✅ **Corrigido em 14/08:** o `README.md` e o `arquitetura-e-proximos-passos.md` §3 ganharam nota
> datada explicando que a conclusão do `ws://` valia só para a porta 7048. O texto original foi
> preservado — os dois seguem dizendo que **o helper é o caminho de produção** até o WebRTC
> provar paridade.

---

## 1. Etapa 0 — O spike que decide tudo (GATE)

**Nada abaixo desta seção deve ser começado antes deste teste passar.** Ele custa ~30 min e
responde as três incógnitas que não são resolvíveis por código.

**A ferramenta já existe:** [`scripts/probe-webrtc-sip.html`](../../../scripts/probe-webrtc-sip.html) —
arquivo solto, fora do app, sip.js via CDN, com veredito automático para os 4 testes.

```powershell
npm run probe:webrtc
```

O comando imprime a URL (**http://localhost:5050/probe-webrtc-sip.html**) e **só então** o
navegador deve ser aberto. Ctrl+C encerra.

> Precisa ser servido em `localhost` (ou HTTPS): `getUserMedia` exige *secure context*. Abrir o
> arquivo com duplo-clique (`file://`) **não funciona** — o próprio probe avisa no log.
> A pasta `scripts/` não é servida pelo Next, então isto nunca vai para o deploy.
>
> O servidor é [`scripts/serve-probe.mjs`](../../../scripts/serve-probe.mjs), Node puro, **sem
> dependência**. A primeira versão usava `npx serve` e deu *conexão recusada* no teste real: o
> `npx` baixa o pacote na primeira execução (10-30s) e o navegador chega antes de o servidor
> existir. Se a 5050 estiver ocupada ele sobe na próxima livre — por isso vale ler a URL
> impressa em vez de digitar a porta de cabeça.

O que cada teste responde:

| # | Teste | O que prova |
|---|---|---|
| 1 | Registrar o ramal 5125 em `wss://widevoice8.intelbras.com.br:8089/ws` | O endpoint aceita a credencial e o ramal existe para WebRTC |
| 2 | Discar 1 celular e **ouvir a voz nos dois sentidos** | `webrtc=yes` está ligado no endpoint **e** o codec é compatível (Opus/G.711/G.722) |
| 3 | Disparar **2 INVITEs simultâneos** no mesmo ramal | Multi-linha por ramal — sem isso a preditiva não existe no navegador |
| 4 | Ver se a mídia sobe sem TURN | Se conectar direto, não há custo de infraestrutura |

### Critérios de aceite

- **Passou:** os 4 acima. Segue o plano.
- **Registra mas não sai áudio:** é `webrtc=yes` faltando no endpoint (DTLS não acontece) **ou**
  codec incompatível. Os dois são ticket na Intelbras, não desenvolvimento. Conferir antes em
  *Sistema PABX → RAMAIS* — pode ser um checkbox.
- **Nem registra:** conferir credencial e se o ramal está provisionado. Se persistir, ticket.
- **1 linha funciona, 2 não:** a preditiva fica no helper e só o 1-a-1 migra. O plano continua
  válido — a camada da Etapa 1 permite modos diferentes por agente.

> O sintoma "registra, disca e não sai áudio" é o mais traiçoeiro do projeto inteiro. Se
> aparecer, **não é bug do nosso código** — não gaste tempo depurando o front.

---

## 1.1. Resultado da Etapa 0 (rodado em 14/08/2026)

| # | Teste | Resultado |
|---|---|---|
| 1 | Registro no `wss://…:8089/ws` | 🟢 **PASSOU** — registrou em ~120ms |
| 2 | Chamada de 1 linha com áudio | 🔴 **FALHOU** — `488 Not Acceptable Here` em ~400ms, **inclusive para ramal interno** |
| 3 | 2 linhas simultâneas | ⚪ **INCONCLUSIVO** — as duas caíram pelo motivo do teste 2 |
| 4 | Mídia sem TURN | ⚪ **NÃO AVALIADO** — nenhuma sessão chegou a estabelecer |

### O que passou (e não é pouco)

O ramal **registra por WebRTC**. Isso descarta de uma vez: o endpoint WSS existe e responde, a
porta 8089 está acessível, o certificado é válido, a credencial do ramal serve para WebRTC e o
tenant aceita SIP over WebSocket. Metade das dúvidas do Bloco 6 morreu aqui.

### O que falhou, e por quê

**Toda** chamada foi recusada com **`488 Not Acceptable Here`**, em ~400ms, de forma idêntica
para **seis formatos diferentes** do número (`021`+DDD+número, sem CSP, sem DDD, com e sem o 9º
dígito). Essa invariância é o diagnóstico:

- **Não é número errado** — isso seria `404`/`484`.
- **Não é ocupado nem indisponível** — seria `486`/`480`.
- **Não é rota/permissão** — seria `403`/`503`.
- `488` é **falha de negociação de mídia (SDP)**: o PABX está dizendo *"não aceito o áudio que
  você ofereceu"*. Os 400ms confirmam — ele nem tentou rotear a chamada.

### O diagnóstico de mídia (rodado depois) estreitou a causa

```
perfil de transporte : UDP/TLS/RTP/SAVPF
codecs oferecidos    : opus/48000, red/48000, G722/8000, PCMU/8000, PCMA/8000,
                       CN/8000, telephone-event/48000, telephone-event/8000
DTLS-SRTP            : sim (obrigatório no navegador)
rtcp-mux             : sim
```

Isso **reordena as hipóteses**. O navegador **já oferece PCMA e PCMU** — e o ramal 5125 **já
cursa PCMA hoje** pelo softphone desktop. Ou seja: existe um codec em comum entre o que o
navegador propõe e o que a linha comprovadamente fala.

1. **Perfil de mídia (causa mais provável agora).** O navegador oferece `UDP/TLS/RTP/SAVPF` —
   DTLS-SRTP + AVPF, obrigatórios em WebRTC. Se o endpoint do ramal está como RTP puro
   (`RTP/AVP`, sem `media_encryption=dtls` e sem `use_avpf`), o Asterisk recusa com `488`
   **independente do codec** — ele não entende o perfil oferecido. É a assinatura de
   `webrtc=yes` ausente no endpoint.
2. **Codec (segue possível, agora menos provável).** Se o endpoint estiver com
   `allow=gsm,g729` apenas, ele filtra PCMA/PCMU antes de negociar e o resultado é o mesmo `488`.

As duas se resolvem no mesmo lugar — o provisionamento do endpoint — e o pedido cobre ambas.

> ℹ️ A resposta `488` **não trouxe header `Warning`**, então o Asterisk não explicou o motivo.
> Por isso o pedido inclui perguntar isso do lado deles.

### 🎯 Teste do ramal interno — diagnóstico FECHADO

Discando o **ramal 5126** (interno, sem CSP — e também com `021` na frente, por controle):

```
0215126  →  488 Not Acceptable Here
5126     →  488 Not Acceptable Here
```

**Uma chamada ramal↔ramal não passa pelo tronco nem pela operadora.** O PABX recusou a mídia
antes mesmo de tentar alcançar o outro ramal — em ~400ms, igual às externas. Isso **exclui de
vez**:

- ❌ tronco de saída / gateway para a operadora
- ❌ CSP, formato de número, roteamento
- ❌ codec do lado da operadora

Sobra **uma** causa: **o endpoint do ramal registrado não está com perfil de mídia WebRTC.** O
Asterisk rejeita a oferta `UDP/TLS/RTP/SAVPF` do navegador no próprio canal de origem — não
chega a haver destino. É configuração do endpoint no PABX, e nada mais.

Com isso o pedido §1.2 deixa de ter alternativas: não é transcodificação no caminho de saída, é
`webrtc=yes` (ou equivalente) no ramal.

> 📌 **Correção de uma previsão deste plano.** O §1 dizia que `webrtc=yes` faltando apareceria
> como *"registra, disca e não sai áudio"*. O sintoma real é **mais precoce**: a chamada nem
> estabelece, morre em `488`. Faz sentido — `REGISTER` não negocia mídia nenhuma, então registrar
> não prova nada sobre o perfil de mídia do endpoint. **Registrar ≠ estar provisionado para
> WebRTC.**

### Correção no probe (14/08)

O resultado expôs três defeitos na ferramenta, todos corrigidos:

- **Falso negativo no teste 3.** Ele anunciou *"a 2ª linha não subiu — o PABX pode limitar
  chamadas simultâneas"*. Errado: as duas linhas caíram pelo mesmo `488` do teste 2. Agora o
  teste 3 devolve **INCONCLUSIVO** quando o teste 2 não completou — chamar aquilo de falha de
  multi-linha mandaria investigar limite de canais quando o problema é outro.
- **Veredito 2 ficava em branco** num reject (só era preenchido se a chamada estabelecesse).
  Agora marca FALHOU com o código e a explicação.
- **Detalhe do veredito duplicava** a cada nova execução (`insertAdjacentHTML` concatenando).

E duas capacidades novas, para instruir o ticket:

- O `onReject` agora lê o header **`Warning`** da resposta — o Asterisk costuma explicar ali o
  motivo exato (ex.: `305 "Incompatible media format"`).
- Botão **"0 · Diagnóstico de mídia"**: monta uma oferta SDP e lista o perfil de transporte, os
  codecs e se há DTLS/rtcp-mux — **sem precisar registrar**. É a prova do que o navegador propõe.

## 1.2. O pedido para a Intelbras

O ramal de teste é o **5125**. O pedido é de **provisionamento**, não de suporte a produto — o
WebRTC deles já funciona (nós registramos).

> **Assunto:** Ramal 5125 — endpoint sem perfil de mídia WebRTC (488 Not Acceptable Here)
>
> Estamos integrando um softphone WebRTC ao WidevoiceX. O ramal **5125 registra normalmente** via
> `wss://widevoice8.intelbras.com.br:8089/ws` — a sinalização funciona. Mas **toda chamada é
> recusada com `488 Not Acceptable Here`** em ~400ms.
>
> **Isolamos a causa:** a recusa acontece inclusive discando um **ramal interno (5126)**, que não
> passa pelo tronco nem pela operadora. Ou seja, não é roteamento, formato de número, CSP nem
> codec do lado da operadora — é a **negociação de mídia (SDP) no próprio endpoint do 5125**.
>
> A oferta SDP que o navegador envia é esta (capturada do nosso lado):
>
> ```
> perfil de transporte : UDP/TLS/RTP/SAVPF
> codecs oferecidos    : opus/48000, G722/8000, PCMU/8000, PCMA/8000, telephone-event
> DTLS-SRTP            : sim (obrigatório em WebRTC)
> rtcp-mux             : sim
> ```
>
> Note que **PCMA e PCMU estão na oferta**, e as chamadas deste mesmo ramal **já cursam PCMA
> hoje** pelo softphone desktop — portanto existe codec em comum. O que o navegador exige, e não
> é negociável do nosso lado, é o **perfil `RTP/SAVPF` com DTLS-SRTP**: um endpoint configurado
> como RTP puro (`RTP/AVP`) recusa com `488` mesmo havendo codec compatível.
>
> Pedimos, para o ramal 5125 (e depois para a faixa 5125–5150):
> 1. Ativar o **perfil WebRTC** no endpoint — no Asterisk corresponde a `webrtc=yes`, que liga
>    `use_avpf=yes`, `media_encryption=dtls`, `dtls_auto_generate_cert=yes`, `ice_support=yes` e
>    `rtcp_mux=yes`.
> 2. Garantir **PCMA e/ou PCMU** (e **Opus**, se disponível) habilitados nesse endpoint.
> 3. Se possível, informar o header `Warning` que acompanha o `488` do lado de vocês — a nossa
>    resposta não veio com ele.
>
> Podemos repetir o teste a qualquer momento e enviar os logs.

## 1.3. Existe contorno do nosso lado?

**Não há contorno client-side. Nenhum.** Vale registrar por quê, para ninguém tentar de novo:

| Tentativa | Por que não funciona |
|---|---|
| Desligar o DTLS e mandar RTP puro | **Impossível por especificação.** WebRTC exige DTLS-SRTP; nenhum navegador expõe flag para isso. Não é limitação de biblioteca |
| Oferecer G.729 ou GSM no SDP | Os navegadores **não implementam** esses codecs. Não há como adicionar |
| Trocar sip.js por outra lib | Todas usam a mesma `RTCPeerConnection` do navegador e produzem o mesmo SDP |
| Mexer na ordem/prioridade dos codecs | PCMA/PCMU **já estão na oferta** — o problema não é preferência |

Sobram três caminhos reais:

### A. Provisionamento na Intelbras (o caminho)
Ticket da §1.2. Custo zero, resolve na fonte, e o WebRTC passa a valer para os 26 ramais.
**Recomendado.** Enquanto não responde, o helper roda normalmente.

### B. Gateway/SBC próprio — **resolve, tecnicamente** (mas leia o custo)

Um Asterisk/FreeSWITCH nosso numa VPS, falando **WebRTC com os agentes** e **SIP comum com o
Widevoice**.

**Por que funciona com certeza:** a perna que o Widevoice enxerga passa a ser idêntica à do
MicroSIP de hoje — registro SIP comum, UDP, `RTP/AVP`, PCMA. Isso **comprovadamente funciona**,
é o que roda em produção. O `webrtc=yes` que falta no endpoint deles passa a existir **no nosso**
servidor, onde temos acesso à configuração. O `488` desaparece por construção.

**Detalhe que barateia muito:** o navegador **já oferece PCMA** (ver §1.1). Se fixarmos PCMA no
lado WebRTC, o SBC não transcodifica codec nenhum — PCMA entra, PCMA sai. Sobra só **terminar o
DTLS/SRTP**, que é ordens de grandeza mais barato que transcodificar Opus↔G.711. Isso muda o
dimensionamento de "servidor robusto" para "VPS modesta".

**O que custa de verdade — e não é o dinheiro:**

| Custo | Detalhe |
|---|---|
| **Ponto único de falha** | Hoje o helper cai → **1 agente** parado. O SBC cai → **26 agentes** parados. É mudança qualitativa de risco, não quantitativa |
| **Toda a mídia passa por ele** | No pico (26 × 3 = 78 chamadas), ordem de **20–25 Mbps sustentados** — estimativa a partir dos 32–100 kbps/chamada que a própria Intelbras informou (Bloco 8), contando as duas pernas |
| **Operar telefonia** | Certificado TLS do WSS, domínio, atualizações de segurança, monitoramento. E depurar áudio passa a ter **três** lugares para olhar em vez de dois |
| **VPS** | ~R$100–200/mês nacional. Baixo em absoluto — mas o dono estabeleceu "sem custo nenhum" |
| **Praticamente irreversível** | Uma vez que 26 agentes dependem dele, remover é outro projeto |

**A questão de proporção:** o bloqueio é **uma linha de configuração no endpoint do lado deles**.
Montar e manter infraestrutura permanente de telefonia para contornar um chamado de suporte é
resposta desproporcional — *enquanto o chamado não for recusado*.

**Mas há um enquadramento que muda a conta.** O SBC não entrega só o contorno do `488`: entrega
**AMD de verdade** (o áudio passa por nós), **gravação**, controle total de codec e a
classificação SIP completa. O bloqueio de spam de 8,9s — que a medição provou insolúvel por tempo
e que hoje não tem solução na stack — passa a ser resolvível. Se esses itens estiverem no
roadmap, o SBC deixa de ser "contorno" e vira **plataforma**, e aí o custo se justifica por outro
motivo que não o `488`.

> 🔎 **Enquadramento honesto:** o helper de hoje **já é** um gateway — só que **distribuído**, um
> por máquina. A escolha real nunca foi "com ou sem componente extra", e sim **onde ele fica**:
> distribuído (26 instalações, falhas isoladas) ou centralizado (zero instalação, falha única).
> O WebRTC *puro*, sem intermediário nenhum, só existe se a Intelbras habilitar o endpoint — é a
> única opção das três que elimina o componente em vez de mudá-lo de lugar.

**Gatilho recomendado:** abrir o ticket e dar um prazo (~2 semanas). Só montar o SBC se houver
recusa explícita ou silêncio — e, nesse caso, decidir pelo valor de plataforma (AMD/gravação),
não pelo `488`.

### C. Ficar no helper
Custo zero, funciona hoje, nada a fazer. É o estado atual e o padrão até B ou A mudarem o quadro.

### Enquanto isso

**A Etapa 1 continua válida e entregue** — ela não depende do WebRTC, e a camada de transporte
serve igualmente ao caminho B (um `webrtcTransport` apontando para um SBC próprio usa exatamente
a mesma interface).

As Etapas 2, 3 e 4 ficam paradas: fazer a migration de credenciais e o `webrtcTransport` antes da
resposta seria construir sobre um canal que hoje não completa chamada.

**O helper segue como produção, sem prazo pressionado.** Nada regrediu.

---

## 2. Arquitetura alvo — uma camada de transporte

A ideia central que evita reescrever o discador: **o helper já tem uma interface**. `/call`,
`/dial-parallel`, `/parallel-status`, `/hangup`, `/hangup-calling`, `/mute`, `/events`, `/ping`.
Em vez de arrancar essas chamadas do front, nós as transformamos em uma **interface TypeScript**
com duas implementações.

```
      usePowerDialer · ManualDialTab · CallControls · SoftphoneClient · DialerTab
                                    │
                                    ▼
                    src/lib/telephony/  ← TelephonyTransport (interface)
                            ┌───────────┴───────────┐
                            ▼                       ▼
                   helperTransport            webrtcTransport
                  (embrulha o helper)     (sip.js — navegador, SEM instalação)
                            │                       │
                            ▼                       ▼
                   MicroSIP + helper          wss://…:8089/ws
                            └───────────┬───────────┘
                                        ▼
                             PABX Intelbras (Asterisk 22)
```

**O front não sabe qual está ativo.** É isso que torna o rollout, o teste no PC do dono e o
rollback triviais — e é o que responde ao pedido de "modularizar em vez de criar do zero".

### A interface (espelha o helper de hoje, de propósito)

```ts
// src/lib/telephony/types.ts
export type LineState = 'calling' | 'answered' | 'busy' | 'cut' | 'machine' | 'ended'

export interface TelephonyTransport {
  readonly kind: 'helper' | 'webrtc'
  init(): Promise<void>                                    // ~ subir/registrar
  dispose(): Promise<void>
  getStatus(): TransportStatus                             // ~ GET /ping
  call(number: string, opts?: { raw?: boolean }): Promise<void>          // ~ POST /call
  dialParallel(numbers: string[]): Promise<{ sessionId: number | null; error?: string }>
  getParallelStatus(): Promise<ParallelStatus>             // ~ GET /parallel-status
  hangup(): Promise<void>                                  // ~ POST /hangup
  hangupCalling(): Promise<void>                           // ~ POST /hangup-calling
  setMuted(device: 'mic' | 'speaker', muted: boolean): Promise<boolean>  // ~ POST /mute
  getLastEvent(): Promise<CallEvent>                       // ~ GET /events
}
```

Manter a assinatura idêntica na primeira passada é intencional: o `usePowerDialer` muda quase
só nos imports. Trocar o polling por callbacks é uma limpeza **posterior**, quando o WebRTC já
estiver estável em produção — não misturar as duas mudanças.

---

## 3. Inventário de paridade — tudo que funciona hoje

Nada desta tabela pode ficar para trás. A coluna **Origem** é o que responde "reusar, não criar
do zero".

| Funcionalidade de hoje | Onde vive hoje | Como fica no WebRTC | Origem do código |
|---|---|---|---|
| Discagem 1-a-1 | `POST /call` → `microsip.exe` | `Inviter` + `invite()` | **Portar** do `useSipAgent` (git, `31eb432^`) |
| Discagem paralela (N linhas) | `/dial-parallel`, fila `queueMsip` | N `Inviter` sobre o mesmo `Registerer` | **Novo**, mas a máquina de estados é portada |
| Máquina de estados do lote | `parallelSession` no helper | `lib/telephony/parallelSession.ts` | **Portar literal** de [`local-helper/index.js:884-986`](../../../local-helper/index.js) |
| Vencedor derruba as outras | `/hangupcalling` (global) | `inviter.cancel()` **por linha** | Simplifica — ver §6 |
| Corte de toque 20s | `RING_CUTOFF_MS`, timer do lote | Timer **por linha** | Portar a regra, melhorar o alvo |
| Watchdog de lote 90s | `PARALLEL_TIMEOUT_MS` | Idem | Portar literal |
| Piso de atendimento (off) | `MIN_ANSWER_MS` | Idem, segue desligado | Portar literal |
| `answer-times` (calibração) | memória do helper | memória do browser + log | Portar literal |
| Normalização `021`+DDD | `formatNumber` | `lib/telephony/number.ts` | **Copiar literal** ([`index.js:47`](../../../local-helper/index.js)) |
| Match de número por sufixo | `sameNumber`/`digitsOf` | Idem | **Copiar literal** — ver §6 |
| Ramal interno sem CSP (`raw`) | `/call` com `raw:true` | `opts.raw` no transport | Já existe no `ManualDialTab` |
| Fim de chamada | hooks `.bat` → `/events` → polling 1s | `SessionState.Terminated` (evento) | Substitui |
| Ocupado / não atende | hook `call-busy` (grosseiro) | Código SIP real: 486/408/480/404/603 | **Ganho** — ver §6 |
| Mute do microfone | `msip:micmute` | `track.enabled = false` | Simplifica |
| Mute do alto-falante | sessão de áudio do Windows (PowerShell) | `audioEl.muted = true` | Simplifica |
| Desligar | `msip:hangupall` | `bye()`/`cancel()` em todas as sessões | Simplifica |
| Ringback das N linhas | mute global do Windows | **só o vencedor recebe `<audio>`** | **Ganho** — ver §6 |
| "Helper online" | `/ping` a cada 10s | `sipStatus` do `Registerer` | Substitui |
| Multi-chamada / "Preparar MicroSIP" | `singleMode` no `microsip.ini` | **deixa de existir** | Deleta |
| Auto-update do helper | `/update` + `public/helper/` | **deixa de existir** (é deploy) | Deleta |
| Instalação por máquina | `instalar.bat`, `setup-hooks.ps1`, startup | **deixa de existir** | Deleta |
| Presença / heartbeat | `reportPresence` | inalterado | — |
| Tabulação, reciclagem, mailing | Server Actions + Supabase | inalterado | — |

---

## 4. Etapas de implementação

Cada etapa deixa o app **funcionando e testável**. Não pular a ordem.

### Etapa 1 — Extrair a camada (sem mudar comportamento nenhum)

O passo que mais reduz risco: separa *refatorar* de *trocar tecnologia*.

**Cria:**
- `src/lib/telephony/types.ts` — a interface acima
- `src/lib/telephony/number.ts` — `formatNumber`, `digitsOf`, `sameNumber` copiados do helper
- `src/lib/telephony/helperTransport.ts` — embrulha o `helperFetch` atual, 1:1
- `src/lib/telephony/index.ts` — `getTransport()`, escolhe a implementação

**Altera** (só troca a origem da chamada):
[`usePowerDialer.ts`](../../../src/hooks/usePowerDialer.ts) · [`ManualDialTab.tsx`](../../../src/app/softphone/ManualDialTab.tsx) ·
[`CallControls.tsx`](../../../src/app/softphone/CallControls.tsx) · [`SoftphoneClient.tsx`](../../../src/app/softphone/SoftphoneClient.tsx) ·
[`DialerTab.tsx`](../../../src/app/softphone/DialerTab.tsx)

**Como saber que deu certo:** o discador funciona exatamente como antes, com o helper. Se algo
mudou de comportamento aqui, a refatoração está errada — conserte antes de seguir.

### Etapa 2 — Credenciais SIP

Hoje o app **nunca soube a senha do ramal** (mora no `microsip.ini` da máquina). `profiles` só
tem `extension`.

**Migration** `supabase/migrations/Migrations_discadora/20260814_sip_credentials.sql`:

```sql
create table if not exists public.sip_credentials (
  profile_id      uuid primary key references public.profiles(id) on delete cascade,
  sip_username    text not null,          -- normalmente = extension
  sip_password    text not null,
  telephony_mode  text not null default 'helper',   -- 'helper' | 'webrtc'
  updated_at      timestamptz not null default now()
);
```

- **Tabela separada, não coluna em `profiles`** — `profiles` é lido em muitos joins; senha ali
  vaza fácil por descuido.
- **RLS:** o dono lê **só a própria linha**; admin escreve. Nunca `select *` da tabela no client.
- `telephony_mode` **por agente** é o que permite migrar um de cada vez sem rebuild (uma flag
  `NEXT_PUBLIC_*` é assada no build — ver a nota do `NEXT_PUBLIC_CEO_ENABLED` no `.env.example`).
- Server Action `getMySipCredentials()` — devolve só as do usuário da sessão.
- Tela em `/admin` para preencher (ao lado do campo de ramal que já existe).

**Nota de segurança:** a senha passa a existir na memória do browser. Não é regressão real — o
`microsip.ini` é legível na máquina do agente hoje. Mas amplia o alcance, então: uma credencial
por ramal, revogável, e nunca logada no console.

**Variáveis** (novas, no `.env.example` e no Cloudflare):
```
NEXT_PUBLIC_SIP_WS_URL=wss://widevoice8.intelbras.com.br:8089/ws
NEXT_PUBLIC_SIP_DOMAIN=widevoice8.intelbras.com.br
```

### Etapa 3 — `webrtcTransport`, modo 1-a-1

**Ponto de partida:** recuperar o hook do Sprint 1 (221 linhas, sip.js `^0.21.2`):

```bash
git show 31eb432^:src/hooks/useSipAgent.ts > src/lib/telephony/webrtc/sipAgent.ts
```

Ele já traz `UserAgent`/`Registerer`/`Inviter`/`SessionState`, `attachRemoteAudio` via
`RTCPeerConnection` e o ciclo de vida certo. **Adaptar:** virar transporte (não hook), tirar o
fluxo de chamada recebida (o discador é outbound; entra depois se quiser), mapear os códigos SIP.

Entrega `call()`, `hangup()`, `setMuted()`, `getStatus()`, `getLastEvent()`.

**Testar:** discagem manual + power dialer 1-a-1 com `telephony_mode = 'webrtc'` no seu perfil,
com todo o resto da operação ainda no helper.

### Etapa 4 — `webrtcTransport`, modo paralelo

- Portar `parallelSession` do helper para `src/lib/telephony/parallelSession.ts` — a lógica é a
  mesma, só troca "quem executa o hangup".
- N `Inviter` sobre a **mesma** registration.
- **Uma única `getUserMedia` compartilhada** entre as N sessões (ver §6).
- Corte de toque e watchdog **por linha**.
- Só o vencedor é anexado ao elemento `<audio>`.

**Testar:** campanha com `parallel_lines = 3`, os mesmos cenários já validados em 07/08.

### Etapa 5 — Limpeza (só depois de produção estável)

**Apaga:** [`local-helper/`](../../../local-helper/) inteiro · [`scripts/sync-helper.mjs`](../../../scripts/sync-helper.mjs) ·
`public/helper/` · os scripts `prebuild`, `prebuild:cf`, `sync:helper` do `package.json` ·
`helperFetch` e `HELPER_URL` em [`constants.ts`](../../../src/lib/constants.ts) ·
`helperOnline`/`helperVersion`/`multiCall` do [`softphoneStore`](../../../src/store/softphoneStore.ts) ·
o botão "Preparar MicroSIP" e o banner de atualização do helper.

**Atualiza:** `README.md` (o parágrafo do `ws://`, a seção "Helper local", o diagrama, a Stack) ·
[`../reference/arquitetura-e-proximos-passos.md`](../reference/arquitetura-e-proximos-passos.md) §3 ·
[`docs/links.md`](../../links.md).

---

## 5. Teste no seu PC (antes de qualquer deploy)

```powershell
# NÃO precisa mais do helper — mas deixe-o rodando enquanto o modo 'helper' for o fallback
npm run dev
```

1. Rode a migration da Etapa 2 no SQL Editor e preencha **a sua** credencial SIP.
2. Ponha só o **seu** perfil em `telephony_mode = 'webrtc'`.
3. Teste em `localhost:3000` — é *secure context*, então `getUserMedia` e `wss://` funcionam sem
   HTTPS. O site publicado continua no fluxo antigo.
4. Roteiro mínimo: ① registrar (ver o status virar "registrado") · ② discagem manual para celular ·
   ③ ramal interno (≤6 dígitos, sem CSP) · ④ mute mic e som · ⑤ desligar pelo painel ·
   ⑥ power dialer 1-a-1 com tabulação · ⑦ campanha com 3 linhas · ⑧ ninguém atende (o lote emenda
   sozinho) · ⑨ pausar com lote tocando (contatos voltam para a fila) · ⑩ corte de toque em 20s.
5. Conferir no histórico se `call_logs` gravou igual ao fluxo antigo.

---

## 6. Detalhes técnicos que decidem o resultado

**Uma só `getUserMedia` para N linhas.** Por padrão o sip.js captura uma stream por sessão — com
3 linhas isso é 3 capturas, 3 acessos ao mic e comportamento imprevisível. Capturar **uma** stream
no registro e injetá-la em todas as sessões (`mediaStreamFactory`). Pedir a permissão do microfone
**ao registrar**, não na primeira ligação.

**Só o vencedor recebe áudio.** Hoje o MicroSIP toca o ringback das N linhas e por isso existe
aquele mute do alto-falante via sessão de áudio do Windows. No navegador, as N-1 perdedoras
simplesmente nunca são anexadas a um `<audio>`. O problema deixa de existir em vez de ser
contornado.

**Corte de toque deixa de ser global.** O comentário em [`index.js:456`](../../../local-helper/index.js)
explica que `/hangupcalling` é global e que "é justamente por ser global que ele não erra". No
navegador cada linha é um objeto: `inviter.cancel()` derruba exatamente aquela. Some a classe
inteira de risco de derrubar a conversa errada.

**Classificação de verdade.** Onde hoje há três hooks grosseiros, passa a haver o código SIP real
via `requestDelegate.onReject` — 486 ocupado, 408/480 não atende, 404/484 inexistente, 603 recusada.
Isso resolve sozinho o Bloco 1, que a Intelbras nunca respondeu caso a caso, e melhora a reciclagem
(não insistir em número inválido).

**`sameNumber` continua necessário.** Mesmo com sip.js, o `To`/`Contact` da resposta pode voltar
sem o CSP ou com o domínio junto. Copie a função como está — ela existe porque um evento que não
casa travava o lote inteiro em "Discando 3…".

**Não misturar AMD neste plano.** Com o áudio no navegador, AMD passa a ser possível (Web Audio) e
é o único caminho para o bloqueio de spam de 8,9s que a medição provou insolúvel por tempo. É
**fase 2**, depois da paridade — a lição registrada na v1.13 é justamente a de não implementar
sobre suposição antes de medir.

---

## 7. Fora de escopo (deliberadamente)

Chamada **recebida** (inbound), gravação de chamada no navegador, AMD, transferência e
conferência. Todos ficam **mais fáceis** depois desta migração — nenhum entra agora.

---

## 8. Riscos

| Risco | Gravidade | Mitigação |
|---|---|---|
| Codec incompatível (conta com GSM/G729) | **Bloqueia tudo** | Etapa 0 responde em 30 min; é ticket, não código |
| `webrtc=yes` faltando no ramal | **Bloqueia tudo** | Etapa 0; conferir *Sistema PABX → RAMAIS* antes |
| Multi-linha não suportada por ramal | Alta | Etapa 0 teste 3; se falhar, só o 1-a-1 migra e a preditiva fica no helper |
| Rede exigir TURN | Média | Etapa 0 teste 4; hoje o RTP já passa nessas máquinas |
| Qualidade de áudio pior que o MicroSIP | Média | Comparar na Etapa 3, mesma ligação nos dois modos |
| Regressão na preditiva com 26 agentes | Média | `telephony_mode` por agente; rollback = virar a coluna de volta |
| Aba fechada derruba a chamada | Baixa | Já é assim na prática; avisar o agente com `beforeunload` |

---

## 9. Ordem resumida

```
Etapa 0  spike            → GATE, 30 min, decide o projeto
Etapa 1  camada           → app idêntico, ainda no helper
Etapa 2  credenciais      → migration + admin + env
Etapa 3  WebRTC 1-a-1     → testar no PC do dono
Etapa 4  WebRTC paralelo  → testar no PC do dono
   ↓  rollout agente a agente via telephony_mode
Etapa 5  limpeza          → apaga o helper e atualiza a doc
```
