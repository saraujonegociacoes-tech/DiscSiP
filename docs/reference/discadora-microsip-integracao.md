# DiscSiP — Integração com MicroSIP (discagem, encerramento, eventos)

> Estado consolidado da sessão. Fonte de verdade da integração discador ↔ MicroSIP.
> Complementa `arquitetura-e-proximos-passos.md` (mesma pasta `docs/reference/`).

---

## 1. Objetivo do fluxo (decisão do usuário)

Fluxo desejado, com MicroSIP e helper **invisíveis** (agente só usa o DiscSiP):

```
Iniciar discagem → liga → botão "Encerrar" (no DiscSiP) encerra a chamada
→ aparece tabulação → agente qualifica → roda a próxima → ... até a lista acabar
```

Meta: **1 clique por contato** (só a qualificação). Hoje são 3 (desligar no MicroSIP +
Encerrar no DiscSiP + qualificar).

---

## 2. Descobertas essenciais do MicroSIP (NÃO ESQUECER)

Versão: **MicroSIP 3.22.x**. Source baixado em `C:\Users\Filipe Crepaldi\Downloads\MicroSIP-3.22.3-src.7z`
(extraído em `...\OneDrive\Desktop\MicroSIP-3.22.3-src`). **Não precisa recompilar** — tudo é config.

### Caminhos nesta máquina
- Executável: `C:\Users\Filipe Crepaldi\AppData\Local\MicroSIP\microsip.exe` (instalação por usuário; o helper auto-detecta)
- Config: `C:\Users\Filipe Crepaldi\AppData\Roaming\MicroSIP\microsip.ini` (UTF-16 LE!) — **não** fica junto do .exe
- Conta SIP (ramal 5125): server/domain `widevoice8.intelbras.com.br:7048`, username/authID `5125`, transport UDP

### Controle externo (API `msip:`) — confirmado funcionando
A instância em execução recebe comandos via `WM_COPYDATA` → `CommandLine()` (`mainDlg.cpp` ~3980).
Forma de disparar: `microsip.exe "<comando>"`.
- `microsip.exe <numero>` → **disca** (auto-disca; já em uso pelo helper)
- `microsip.exe "msip:hangupall"` → **encerra a chamada ativa**, escondido, sem trazer janela à frente ✅ TESTADO
- Outros: `msip:answer`, `msip:hold`, `msip:micmute`/`micunmute`, `msip:speakmute`/`speakunmute`, `msip:minimize`
- ⚠️ `/hangup` **NÃO existe** (vira número discado — confirmado no histórico `[Dialed]` do ini). O certo é `msip:hangupall`.
- ❌ Teclas de mídia (WM_APPCOMMAND / "Handle Media Buttons") NÃO encerram — descartado.

> **ATUALIZAÇÃO 2026-06-19 — comandos de hangup (correção):** a doc oficial do MicroSIP
> lista, além do `/hangupall`, dois comandos de encerramento SELETIVO confirmados em
> teste: **`microsip.exe /hangupcalling`** (derruba só as chamadas que ainda TOCAM,
> mantendo a já atendida) e `microsip.exe /hangupincoming` (só as entrantes). O
> `/hangupcalling` é a peça que viabiliza a **discagem paralela/preditiva** sem
> recompilar o MicroSIP. Ou seja, NÃO é verdade que "só existe hangupall". Detalhes e
> resultados dos testes em [`discagem-paralela-preditiva.md`](../updates/discagem-paralela-preditiva.md).

### Eventos de chamada (hooks no `microsip.ini`, seção `[Settings]`)
Lidos só na inicialização (`settings.cpp:643-649`). Executados por `MSIP::RunCmd` (`lib/MSIP.cpp:498`)
com a janela escondida (`SW_HIDE`) e o **número anexado como parâmetro**.
- `cmdCallStart` → dispara quando a chamada **é ATENDIDA** (estado `PJSIP_INV_STATE_CONFIRMED`, `mainDlg.cpp:434`)
- `cmdCallEnd` → dispara quando **desconecta** (exceto "ocupado" 486/600/603, que vai pra `cmdCallBusy`; `MessagesDlg.cpp:1006`)
- Outros: `cmdOutgoingCall` (ao iniciar saída, `CALLING`), `cmdIncomingCall`, `cmdCallRing`, `cmdCallAnswer`, `cmdCallBusy`
- `autoHangUpTime` = encerra após N segundos

Valores corretos (apontam para a pasta SEM espaço — ver bloqueador resolvido na seção 4):
```ini
cmdCallStart="C:\Users\Public\discsip-helper\on-call-start.bat"
cmdCallEnd="C:\Users\Public\discsip-helper\on-call-end.bat"
cmdCallBusy="C:\Users\Public\discsip-helper\on-call-busy.bat"
```
Editar o ini só com o MicroSIP FECHADO (ele reescreve o ini ao sair). É UTF-16 LE — preservar encoding.
Aplicar/reproduzir com `local-helper/setup-hooks.ps1` (copia os .bat p/ a pasta pública + aplica no ini).

---

## 3. Helper local (`local-helper/`) — v1.3

Express na porta 3001. Endpoints:
- `GET /ping` → `{ ok, microsip }`
- `POST /call` `{ number }` → disca via `microsip.exe <numero>` (fallback `tel:`)
- `POST /hangup` → `microsip.exe "msip:hangupall"`
- `GET /event/call-start?number=` e `GET /event/call-end?number=` → recebem do MicroSIP (via curl nos .bat)
- `GET /events` → último evento `{ id, type, number, at }` (DiscSiP faz polling)

Normalização de número (`formatNumber`): tira não-dígitos e o código de país (`+55`/`55`) e **sempre**
prefixa o CSP `021`, discando `021 + DDD + número` (ex: `11952085529` → `02111952085529`,
`33952085522` → `02133952085522`). Sem o `021` o MicroSIP não completa chamadas interurbanas.
Vale para TODO número, inclusive DDD 11 (não disca mais local sem DDD).
Envs: `MICROSIP_PATH`, `DIAL_PREFIX` (default **`021`**; só muda se trocar de operadora de longa distância).

> **Histórico (até v1.2):** havia `LOCAL_DDD` (default 11) que discava o DDD local em formato LOCAL
> (sem DDD) e `DIAL_PREFIX` vazio. Removido na v1.3 — outros estados não completavam sem o `021`.

Arquivos novos: `on-call-start.bat`, `on-call-end.bat` (disparam `curl` não-bloqueante pro helper, `start /b`).

### Atualização do helper nas máquinas (`atualizar.bat`)
A regra de discagem vive no `index.js` (Opção A — cravada no código, não por máquina). Logo:
- **Máquinas novas (26 agentes):** rodar o `instalar.bat` já nasce certo, zero config por máquina.
- **Máquina já instalada:** levar o `index.js` novo pra pasta `local-helper` e rodar `atualizar.bat`,
  que: `git pull` (se a pasta for repo) → para SÓ o `node` do helper (filtra `index.js` na cmdline,
  não mata outros node) → `npm install` → sobe oculto via `start-hidden.vbs`. (Ou reiniciar o Windows.)
  O `instalar.bat` roda da própria pasta e não copia o `atualizar.bat` — sem impacto.

### Cadeia de eventos — testada parcialmente
- helper ↔ .bat ↔ curl ↔ /events: ✅ funciona (rodando o .bat manual, `/events` registra).
- MicroSIP → .bat (eventos reais): ❌ **NÃO dispara ainda** (ver Aberto).

---

## 4. PENDÊNCIAS / EM ABERTO

### ✅ RESOLVIDO: cmdCallStart/cmdCallEnd não disparavam (era espaço no caminho)
Causa raiz (hipótese (c) confirmada): o MicroSIP grava o hook entre aspas no ini, mas ao ler com
`GetPrivateProfileString` **as aspas são removidas**; aí `RunCmd`→`CommandLineToArgvW` (`lib/MSIP.cpp:476`)
**quebra o caminho no espaço** de "Filipe Crepaldi" → `lpFile="C:\Users\Filipe"` → `ShellExecuteEx`
falha em silêncio (`SEE_MASK_FLAG_NO_UI`). Provado empiricamente (1 arg vs 2 args).
Fix: mover os hooks para um caminho SEM espaço — `C:\Users\Public\discsip-helper\` (Public existe em
todo Windows, gravável sem admin, serve p/ qualquer usuário, inclusive nomes com espaço/acento).
Automatizado em `local-helper/setup-hooks.ps1` (chamado pelo `instalar.bat`). NÃO precisa recompilar.

### Sub-sprint B — wiring no DiscSiP (FEITO em parte)
- ✅ Botão "Encerrar" → `POST /hangup` + `setCallStatus('ended')` (`SoftphoneClient.tsx`, `handleHangup`)
- ✅ Polling em `/events` (`usePowerDialer.ts`): enquanto `callStatus==='calling'`, 1ª leitura vira baseline;
  evento novo `call-end`/`call-busy` → `setCallStatus('ended')` → tabulação aparece sozinha. Cobre os 2 fluxos
  (remoto desligou OU agente desligou no MicroSIP/botão). Helper ganhou `/event/call-busy` (+ `on-call-busy.bat`).
- ⏳ ainda não: `call-start` → estado "atendido"/cronômetro real (mata #5); qualificação em loop disparando a próxima.
- **Fix de concorrência** (CRÍTICO p/ 2+ agentes): em `getNextContact` (`src/app/actions/campaigns.ts`),
  quando o claim atômico volta `null` por perder a corrida, hoje o `dialNext` trata como "campanha concluída"
  e PARA. Corrigir: distinguir "perdi a corrida" de "sem pendentes" — fazer loop de claim, só retornar
  null quando não há mais pendente.

### ✅ Lançadores ocultos (Sub-sprint C) — FEITO
- MicroSIP escondido: chave `minimized=1` no ini (`settings.cpp:652`) faz nascer na bandeja —
  o startup pula `ShowWindow(SW_SHOW)` (`mainDlg.cpp:2144`). Com `singleMode=1`, `MakeCall` seta
  `doNotShowMessagesWindow` (`mainDlg.cpp:4279`) e `CommandLine`/`hangupall` retornam sem foco →
  discar e encerrar NÃO mostram janela. Aplicado pelo `setup-hooks.ps1`. (`/minimized` só funciona se a
  cmdline for EXATAMENTE "/minimized" — como o helper passa o número, a chave do ini é o caminho certo.)
- Helper sem janela: `local-helper/start-hidden.vbs` (WScript.Shell Run com window style 0) roda o
  `start.bat hidden` oculto — NÃO o `node` direto. Isso é essencial: o `start.bat` tem o loop que
  reinicia o node ao sair com código 42 (auto-atualização). Se o vbs chamasse `node index.js` direto,
  o helper se atualizaria, sairia com 42 e nunca voltaria (ficaria offline até o próximo boot). O
  `instalar.bat` registra o atalho de startup apontando pro vbs (via wscript) e, antes de criar,
  apaga atalhos antigos de nomes divergentes (evita dois helpers brigando pela porta 3001). O
  `start.bat` sem argumento (com console) fica pra debug.
- ⚠️ GOTCHA: `minimized` só controla o NASCIMENTO. Se o MicroSIP já estiver aberto/visível (alguém clicou
  no ícone da bandeja, restaurou a janela), ele FICA visível e discar não esconde. Provado empiricamente:
  startup com `minimized=1` → `MainWindowHandle=0` (escondido); enviar comando (msip:/número) à instância
  rodando → continua `MainWindowHandle=0`. Ou seja: deixe o MicroSIP só na bandeja; não abra a janela.
- `bringToFrontOnIncoming=0` (defensivo, `mainDlg.cpp:482`) — só afeta recebidas/auto-atender, mas zerado.
- Chaves relevantes no `[Settings]` do ini: `minimized`, `singleMode`, `bringToFrontOnIncoming`.
  Na GUI do MicroSIP: Settings → "Minimize on Startup" e "Bring to Front on Incoming".

### Outros problemas relatados (ainda não feitos)
1. **SQL `notify_dispositions`** — migração `20260610_campaign_notify_dispositions.sql` NÃO foi rodada.
   Coluna certa: `campaigns.notify_dispositions` (PLURAL, jsonb). O usuário criou `notify_disposition`
   (singular, text) errada. Rodar:
   ```sql
   ALTER TABLE public.campaigns DROP COLUMN IF EXISTS notify_disposition;
   ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS notify_dispositions jsonb NOT NULL DEFAULT '[]'::jsonb;
   ```
   (+ verificar demais migrações com as queries de checagem já passadas.)
2. **Excluir campanha** (#2) — falta `deleteCampaign` (cascade contatos/listas/agentes) + botão em `CampaignsListClient.tsx`
3. **Painel de discagem manual** (#3)
4. **Pausa entre ligações na config da campanha** (#4) — tirar do agente; migração `campaigns.pause_between_calls`;
   ler do `campaign` em `usePowerDialer.ts`; remover slider do `DialerTab.tsx`
5. **Estado falso "Em chamada"** (#5) — resolvido junto do polling de `/events` + redesign
6. **Redesign visual do discador** — pedido do usuário ("feio e simples"); fazer depois da 1ª ligação automática

### Decisão registrada
Softphone próprio (Electron/PJSIP) avaliado: caro (semanas–meses) e arriscado; só compensaria se a
integração via MicroSIP falhasse. Como `msip:hangupall` + hooks funcionam, **fica descartado por ora**.

---

## 5. Preferências de trabalho (reforço)
- Usuário controla git (add/commit/push) — nunca commitar sem autorização. Commits deste repo usam
  `f.filipecrepaldii@gmail.com` (o `...santos3454` era override local errado; já corrigido).
- Mostrar conceito antes de editar; validar sub-sprint a sub-sprint; iterar via logs.
- Migrações SQL: idempotentes, em `supabase/migrations/`, rodadas manualmente pelo usuário no Supabase.
- `docs/reference/arquitetura-e-proximos-passos.md` é a fonte de verdade — manter atualizado.
