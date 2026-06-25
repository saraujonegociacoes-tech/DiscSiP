# Update — Discagem em background (DialerEngine)

> Criado em 2026-06-25. **Design/plano** (ainda NÃO implementado) para a discadora
> continuar discando mesmo quando o agente sai da tela do discador. Documenta a causa,
> a arquitetura proposta, o limite honesto e o plano de teste/rollout.
> Relacionado: [`discagem-paralela-preditiva.md`](discagem-paralela-preditiva.md),
> [`../fixes/correcoes-producao-2026-06.md`](../fixes/correcoes-producao-2026-06.md).

---

## 1. Problema

Um agente relatou: ao tabular e aguardar a próxima discagem, **se sair da tela do
discador, a ligação não dispara**. Reproduzido.

### Causa raiz (confirmada no código)
O **estado** do discador (campanha, `dialerStatus`, contato) vive nos stores Zustand
(`dialerStore` / `softphoneStore`) e **sobrevive** à navegação. Mas o **motor** —
o `setTimeout` da próxima discagem e os `setInterval` de polling — vive no hook
[`src/hooks/usePowerDialer.ts`](../../src/hooks/usePowerDialer.ts), que é montado
**dentro da tela do discador** (`DialerTab`, em `/softphone`).

Sequência do bug:
1. Ao tabular, `submitDisposition` agenda a próxima via `setTimeout(pauseBetweenCalls)`.
2. O agente sai de `/softphone` → o componente desmonta → o cleanup
   `clearTimeout(pauseTimerRef.current)` **cancela a discagem agendada**.
3. Nenhuma próxima ligação dispara. Ao voltar, o status ainda é `running`, mas não há
   motor rodando → travado.

> O "piscar" do MicroSIP na barra de tarefas é assunto à parte (o hider tem polling de
> ~250ms, então a janela aparece por instantes a cada discagem) e **não** é prioridade.

---

## 2. Objetivo e limite (escopo)

**Objetivo:** o motor de discagem roda **independente de qual página/aba** o agente vê,
enquanto a aba do navegador estiver aberta.

**Limite honesto (fora de escopo):** **não** sobrevive a **fechar o navegador / dar
F5**. O motor vive no navegador; não há processo em segundo plano no servidor. Para
sobreviver a fechar tudo seria outra arquitetura (Web Worker persistente, ou originação
server-side via API do PABX — ver Bloco 5/6 de `../reference/perguntas-intelbras-widevoice.md`),
um esforço bem maior, deixado como evolução futura.

---

## 3. Arquitetura atual × proposta

```
HOJE
  /softphone → SoftphoneClient → DialerTab → usePowerDialer  (motor vive aqui)
  sair de /softphone  ⇒  DialerTab desmonta  ⇒  motor morre  ⇒  para de discar

PROPOSTA
  app/layout.tsx → <DialerEngine/>  (sempre montado, invisível, instância única)
                     └ roda o motor (timers + pollings), lendo os stores
  /softphone → DialerTab  ⇒  só a UI; comanda o MESMO motor via store
  navegar entre páginas/abas  ⇒  layout persiste  ⇒  motor continua discando
```

O `app/layout.tsx` (layout raiz do App Router) **não desmonta** em navegação client-side
dentro do app, então um client component montado nele permanece vivo — esse é o ponto-chave.

---

## 4. Design detalhado

### 4.1. `DialerEngine` (novo componente, invisível)
- Client component que **renderiza `null`** e roda todo o motor hoje em `usePowerDialer`:
  `dialNext`, `dialNextBatch`, os efeitos de resolução do lote paralelo, detecção de fim
  (1-a-1 via `/events`, paralelo via `/parallel-status`), o `setTimeout` entre chamadas e
  o disparo de `pendingDisposition`.
- Montado **uma única vez** em `app/layout.tsx`.

### 4.2. Instância ÚNICA (invariante crítica)
Se o motor rodar em dois lugares ao mesmo tempo, **disca em dobro**. Logo:
- `usePowerDialer` (os efeitos do motor) passa a ser chamado **só** dentro de `DialerEngine`.
- `DialerTab` **deixa de chamar** `usePowerDialer` para os efeitos; passa a apenas
  **acionar** o motor (ver 4.3) e ler estado dos stores.

### 4.3. Desacoplar controles ↔ motor
A UI precisa de `start / pause / resume / submitDisposition` e do flag `isParallel`, mas
sem instanciar um segundo motor. Abordagem recomendada — **registro de controles no store**:
- O `DialerEngine`, ao montar, registra suas funções de controle num store leve
  (ex.: `dialerStore` ganha `controls: { start, pause, resume, submitDisposition } | null`).
- `DialerTab` lê `controls` do store e chama. Como só existe um `DialerEngine`, há um
  único registro — sem duplicação.
- Alternativa (mais trabalho): mover a lógica de controle para **actions do store**, com o
  `DialerEngine` só hospedando os `setInterval`/`setTimeout`. Decidir na implementação;
  o registro de controles é o de menor risco.

### 4.4. Guards (não agir fora de hora)
Como o `DialerEngine` fica montado em TODAS as rotas (inclusive `/login`), ele só pode
agir quando fizer sentido:
- exige `agentId` (sessão) **e** `campaign` selecionada **e** `dialerStatus === 'running'`;
- os efeitos de polling já têm early-return por `callStatus`/`isParallel` — manter.
- Em idle (sem campanha rodando) o `DialerEngine` é praticamente inerte (sem polling).

### 4.5. O que migra de `usePowerDialer`
Tudo: `dialNext`, `dialNextBatch` (+ `dialNextBatchRef`), efeito de resolução do lote
paralelo (`/parallel-status` → vencedor × ninguém atendeu), efeito de fim do paralelo
atendido, efeito de fim 1-a-1 (`/events`), efeito de `pendingDisposition`, reset de
`callEndHandledRef`, `start/pause/resume/submitDisposition` e o cleanup do `pauseTimerRef`.

---

## 5. Casos de borda
- **F5 / fechar navegador:** estado perdido (stores em memória) → discagem para. É o
  limite declarado (§2). Mitigar UX: ao reabrir, o agente reinicia a campanha.
- **Logout:** `reset()` dos stores zera campanha/status → `DialerEngine` fica inerte.
- **Helper offline:** os `helperFetch` já têm `try/catch`; o motor tenta de novo no
  próximo tick. Sem mudança.
- **Navegar durante `calling`/`answered`:** agora o polling continua (motor vivo), então o
  fim da chamada é detectado e a tabulação aparece quando o agente voltar à tela.
- **Trocar de campanha / voltar à lista:** `setCampaign(null)` torna o motor inerte
  (guard). Comportamento esperado.
- **Painel de áudio (`CallControls`) e disposição:** continuam na tela do discador; só o
  motor sobe de nível. A UI lê `controls` do store.

---

## 6. Riscos e plano de teste
**Risco:** mexe no **núcleo da discagem** (parte mais sensível, em produção). Mitigação:
alteração focada, **testada no npm antes de subir**, de preferência depois do lote de
produção atual (#1/#2/#4/#5) validado — não empilhar risco.

**Teste (npm, com helper + MicroSIP reais):**
1. Iniciar campanha → discar → tabular → **trocar de aba** (Histórico/Meu desempenho) e
   **mudar de página** durante a pausa → a próxima ligação **dispara** mesmo fora da tela.
2. Modo paralelo: lote dispara e resolve (vencedor/ninguém atendeu) com a tela em outra página.
3. **Não disca em dobro** (conferir log do helper: um disparo por contato).
4. `pause`/`resume` e a tabulação funcionam vindo da UI (controles via store).
5. F5 no meio → para (limite esperado); reiniciar a campanha volta ao normal.

---

## 7. Rollout
- **Somente front-end.** Sem migration, **sem mudança no helper** (o helper continua
  recebendo `/call`, `/dial-parallel`, `/event/*` igual). Sai no deploy do site.
- Não interage com o gate de versão do helper (isso é do painel de mute, update separado).

---

## 8. Checklist de implementação (quando aprovado)
- [ ] Criar `src/app/softphone/DialerEngine.tsx` (renders null) hospedando o motor.
- [ ] Mover a lógica de `usePowerDialer` para o engine; manter um ponto único.
- [ ] Expor `controls` no `dialerStore` (registro pelo engine) e consumir no `DialerTab`.
- [ ] Montar `<DialerEngine/>` em `src/app/layout.tsx`.
- [ ] Garantir guards (agentId + campaign + running) e instância única.
- [ ] `tsc --noEmit` + `eslint` + teste manual (Bloco 6) antes do deploy.
