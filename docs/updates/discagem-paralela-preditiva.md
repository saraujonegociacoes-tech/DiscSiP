# Blue Desk — Discagem Paralela / Preditiva (estudo de viabilidade + testes)

> Criado em 2026-06-19. Registro do estudo e dos testes empíricos da feature de
> **discagem paralela** (discar N números ao mesmo tempo, conectar o primeiro que
> atende ao agente, derrubar os demais). Fonte de verdade desta feature.
> Complementa `../reference/discadora-microsip-integracao.md` e `../reference/arquitetura-e-proximos-passos.md`.

---

## 1. Objetivo da feature (pedido do usuário)

Sair do modelo atual de **power dialer** (1 chamada por vez, agente espera cada
ligação ser produtiva/improdutiva) para **discagem preditiva/paralela**:

- Discar **3 a 5 números ao mesmo tempo** ("como 5 abas do softphone utilizado abertas").
- Assim que **uma atende**, **derrubar as outras** e mostrar ao agente a que atendeu.
- O agente pode fazer outras coisas enquanto a discadora roda; quando alguém atende,
  ele já começa a conversar.

**Decisão registrada:** começar com **N = 3 linhas paralelas** por agente (configurável).

---

## 2. Veredito: VIÁVEL client-side (sem infra nova, sem recompilar softphone utilizado)

A avaliação inicial supôs que preditiva exigiria backend de telefonia server-side
(Asterisk/FreeSWITCH originando chamadas + AMD + bridge), o que reabriria o problema
de infra que a arquitetura do Blue Desk foi feita pra evitar (`ws://` only, sem IP fixo,
sem API Intelbras). **Isso foi refutado pelos testes.** A feature é viável com a
arquitetura atual (helper + softphone utilizado em multi-call), graças a duas descobertas:

1. **softphone utilizado Extended mode** (single call mode desligado → `singleMode=0`) gerencia
   várias chamadas simultâneas.
2. **`microsip.exe /hangupcalling`** derruba **apenas as chamadas que ainda tocam**
   (estado "calling"), **mantendo a que já foi atendida** (estado CONFIRMED). É o
   "hangup seletivo" que torna a preditiva possível sem recompilar o softphone utilizado.

---

## 3. Descobertas técnicas (corrigem o doc do softphone utilizado)

### 3.1. Comandos de linha de comando do softphone utilizado (doc oficial)
Forma: `microsip.exe <comando>`. A instância em execução recebe via `WM_COPYDATA`.

| Comando | Função |
|---|---|
| `microsip.exe <numero>` | disca |
| `microsip.exe /hangupall` | **derruba TODAS** as chamadas |
| `microsip.exe /hangupcalling` | **derruba só as que estão chamando (tocando, não atendidas)** ← chave da preditiva |
| `microsip.exe /hangupincoming` | derruba só as entrantes não atendidas |
| `microsip.exe /answer` | atende |
| `microsip.exe /transfer:XXX` | transfere |
| `microsip.exe /dtmf:12345` | envia DTMF |
| `microsip.exe /minimized` | inicia minimizado |
| `microsip.exe /exit` | encerra o softphone utilizado |

> ⚠️ **Correção ao `discadora-microsip-integracao.md`:** aquele doc afirma que "só
> existe `msip:hangupall`" e que "`/hangup` não existe (vira número discado)". O
> primeiro está **incompleto** (existe `/hangupcalling` e `/hangupincoming`); o
> segundo está certo — `/hangup` **não** é comando e de fato é discado como número
> (confirmado: aparece no histórico `[Dialed]` do `microsip.ini` como `/hangup`).

### 3.2. Eventos por chamada
- `cmdCallStart` dispara **quando a chamada é ATENDIDA** (estado CONFIRMED) e leva o
  **número como parâmetro** → permite saber **qual** das N chamadas atendeu.
- `cmdCallEnd` ao desconectar; `cmdCallBusy` em ocupado/rejeição (486/600/603).
- **Assinatura para distinguir "tocou" de "rejeitado":** rejeição/inválido cai em
  `call-busy` em **~2s sem tocar**; chamada que toca de verdade dá `call-end` (ou
  `call-start`) após **~15–30s**. Usado nos testes pra ler o log.

---

## 4. Testes empíricos realizados (2026-06-18/19)

**Ambiente:** máquina de teste do usuário · softphone utilizado **3.22.9** · ramal **5125** ·
helper **v1.5** · `singleMode=0` (multi-call) · hooks de evento ativos.
Disparos via `POST http://localhost:3001/call` (caminho de produção).
Números de teste: `11952085521`, `11947468059`, `11989898727`.

### 4.1. ✅ 2 chamadas simultâneas — PASSOU (várias rodadas)
Duas discagens em rajada → as duas saíram juntas, as duas tocaram, ambas chegaram a
`call-start`/`call-end` distintos. Sem `call-busy` instantâneo.

### 4.2. ✅ Hangup seletivo (`/hangupcalling`) — PASSOU
Cenário limpo: discou 2; **atendeu** `02111952085521`; deixou `02111947468059`
**tocando**; rodou `microsip.exe /hangupcalling`. Resultado: a que tocava **caiu**
(`call-end`), a **atendida continuou viva** (sem `call-end`, áudio seguiu). Confirma
que `/hangupcalling` poupa a CONFIRMED e derruba só as "calling".

### 4.3. ✅ 3 chamadas simultâneas — PASSOU (3 rodadas)
Três discagens em rajada → todas ficaram **15–24s tocando** antes de `call-end`,
**nenhuma** com `call-busy` instantâneo → o ramal segurou as 3 saídas simultâneas.

### 4.4. Teste de teto (10) — NÃO concluído
Tentativa de discar 10 não rolou: o usuário só tinha 3 números reais distintos
(reusar/repetir números gera `call-busy` falso e não testa o ramal). **3 é o máximo
comprovado empiricamente.** O teto real é melhor obtido com a Intelbras (ver §6).

---

## 5. Esboço de implementação (para a próxima conversa)

Nada de infra nova — tudo "código de app":

- **Helper (`local-helper/index.js`):**
  - Rastrear **N chamadas concorrentes** (mapa por número) em vez do `lastEvent` único.
  - No **1º `/event/call-start`**, o **próprio helper** dispara `microsip.exe
    /hangupcalling` imediatamente (sub-100ms) — não esperar o polling de 1s do
    navegador (estreita a janela de corrida; ver §6 compliance).
  - Expor qual número "venceu" (atendeu) e o estado das N chamadas.
  - Novos endpoints para discagem paralela / status agregado.
- **Fila / `usePowerDialer.ts`:** reservar **N contatos de uma vez** (`getNextContact`
  precisa clamar N de forma atômica; **resolver o bug de concorrência** já anotado em
  `discadora-microsip-integracao.md` §4 — distinguir "perdi a corrida" de "sem
  pendentes"). Discar os N em paralelo.
- **UI do agente (`DialerTab.tsx`):** estado "discando 3… → **ATENDEU, fale agora**"
  com aviso **visual forte + som** (o agente está fazendo outra coisa).
- **Config da campanha:** campo "linhas paralelas por agente" (default 3).
- **Modelo de dados:** decidir como marcar os contatos **discados-mas-derrubados**
  (nunca chegaram a falar de verdade → reciclar vs. não contar tentativa).

---

## 6. Pendências / caveats antes de liberar pra produção

1. **Teto global do PABX (CRÍTICO):** os testes foram com **1 agente sozinho**. Com
   **26 agentes × 3 = 78** (ou ×5 = 130) chamadas simultâneas, o gargalo passa a ser o
   **limite global de canais do PABX/tronco**, não o ramal. **Perguntar ao suporte
   Intelbras / admin do WidevoiceX:** "limite de canais simultâneos por ramal" e
   "limite de chamadas simultâneas do PABX/tronco". Não é testável localmente.
2. **UX da janela (TESTE 3 não feito):** com `singleMode=0`, o softphone utilizado pode **voltar
   a mostrar janela** ao discar/atender. A invisibilidade do Sub-sprint C dependia do
   `singleMode=1` (que setava `doNotShowMessagesWindow`). Precisa testar o quanto
   "aparece" em multi-call e domar se necessário.
3. **Compliance / chamadas abandonadas:** preditiva gera abandono quando 2+ atendem
   na mesma janela antes do `/hangupcalling`. Há regras de Anatel/telemarketing no
   Brasil. Mitigação: helper dispara `/hangupcalling` no instante do 1º `call-start`.
   Abandono zero não existe em preditiva — é regra do jogo, tratar conscientemente.
4. **Dial Plan deve ficar VAZIO:** quem formata o número (`021 + DDD + ...`) é o
   helper. Um Dial Plan no softphone utilizado (ex.: `[2-9]...`) **bloquearia** números fora do
   padrão e quebraria a discagem. Confirmado vazio no `.ini` (`dialPlan=`). Manter.

---

## 7. Fatos de ambiente confirmados nos testes

- softphone utilizado **3.22.9** (o `discadora-microsip-integracao.md` registrava 3.22.3).
- `.exe`: `C:\Users\Filipe Crepaldi\AppData\Local\MicroSIP\microsip.exe`
- `.ini` real (UTF-16 LE): `C:\Users\Filipe Crepaldi\AppData\Roaming\MicroSIP\microsip.ini`
- Conta SIP ramal 5125, `transport=udp`, server/proxy/domain `widevoice8.intelbras.com.br:7048`.
- Chaves relevantes do `[Settings]`: `singleMode=0`, `minimized=1`, `callWaiting=1`,
  `maxConcurrentCalls=0` (só limita **entrada**, não atrapalha saída), `disableMessaging=0`,
  `bringToFrontOnIncoming=0`, `autoHangUpTime=0`.
- Hooks de evento apontam para `C:\Users\Public\bluedesk-helper\on-call-*.bat`
  (o doc antigo cita `discsip-helper` — desatualizado; a pasta atual é `bluedesk-helper`).
- Helper em `http://localhost:3001` (`HELPER_URL` em `src/lib/constants.ts`).

### Como testar manualmente (reprodução)
1. Derrubar o helper oculto: `taskkill /IM node.exe /F`.
2. Subir com console: `cd d:\programs\discsip\local-helper` → `node index.js`
   (ou duplo-clique no `start.bat`). Deixar a janela aberta = log ao vivo.
3. Disparar chamadas via PowerShell (ver nota PowerShell abaixo).
4. Observar log do helper + aba **Messages** do softphone utilizado (lista de chamadas ativas).
5. Voltar ao modo produção: fechar console e rodar `start-hidden.vbs`.

> **Nota PowerShell:** `curl` no PowerShell é alias de `Invoke-WebRequest` (não aceita
> `-H`/`-d`). Use `curl.exe` ou, melhor, `Invoke-RestMethod` com `ConvertTo-Json`:
> ```powershell
> Invoke-RestMethod -Uri http://localhost:3001/call -Method Post `
>   -ContentType "application/json" -Body (@{number="11952085521"} | ConvertTo-Json -Compress)
> ```
> O helper normaliza o número (`formatNumber` remove não-dígitos e prefixa `021`).
> ⚠️ Por isso, mandar texto-placeholder (ex.: `SEU_NUMERO_1`) disca lixo (vira só o
> dígito `1` → `0211`). Usar números reais.
