# Integração Blue Desk → Make → Meta (Aquecimento WhatsApp)

Ao contrário dos cenários de Pipefy (poll que **entra** no Supabase), aqui o fluxo é ao
contrário: o **Blue Desk dispara** o Make, que executa a chamada na **Graph API da Meta** e
**devolve** o resultado. O Blue Desk é o plano de controle; o Make é só o braço executor —
toda decisão (quem fala com quem, template ou sessão) já vem pronta no payload.

> **Estado (20/jul):** o **Cenário 1 ("Aquecimento · Disparo") já está montado no Make.** O
> que falta para ele funcionar é o **token do System User** — os ativos ainda não foram
> atribuídos (ver seção abaixo, é o próximo passo). O Cenário 2 (Status Meta) segue como
> fase 2.
>
> Pré-requisitos: migrations [`20260719_warmup_schema.sql`](../../supabase/migrations/20260719_warmup_schema.sql)
> e `20260719b_warmup_supervisor_access.sql` **aplicadas** (feito); secrets definidos no
> Cloudflare e no GitHub (ver [`aquecimento-whatsapp.md`](aquecimento-whatsapp.md), checklist).

---

## Conexão única para os 6 números (System User) — ⛔ próximo passo (pendente)

**Não** é preciso 1 token/conexão por número. Um **System User** da BM com permissão em
**todas as WABAs** do pool gera **1 token de longa duração** → no Make vira **1 conexão HTTP
reutilizável**: o `sender_id` (phone_number_id) que muda a cada chamada vai só na **URL**
(`/v21.0/{{sender_id}}/messages`), não na autenticação. Adicionar um 7º número no futuro não
exige nova conexão — só cadastrar em `warmup_numbers` e garantir a permissão do System User
na WABA dele.

**Passo-a-passo (tudo em `business.facebook.com` → Configurações do Negócio):**

1. **Usuários → Usuários do sistema** → *Adicionar* (ou usar um existente). Tipo **Admin**
   simplifica gerar um token que não expira.
2. Com o usuário selecionado → **Adicionar ativos** → aba **Contas do WhatsApp** → marcar
   **cada WABA** do pool → ligar **Controle total** → *Salvar*. **← é o passo que falta.**
   O ativo é a **WABA** (não o número solto); com controle total nela, o System User herda
   todos os `phone_number_id` embaixo.
3. **Gerar novo token** → escolher o **App** (o que tem o produto WhatsApp) → marcar as
   **duas** permissões `whatsapp_business_messaging` **e** `whatsapp_business_management` →
   expiração **Nunca** (se disponível) → *Gerar* → **copiar na hora** (só aparece uma vez).
4. Colar o token na **conexão/keychain do Make** (header `Authorization: Bearer <token>`),
   **nunca** hardcoded num módulo.

> Pré-requisito de cada número: estar **registrado na Cloud API** (ter `phone_number_id`).
> Esse `phone_number_id` é o `sender_id` cadastrado em `warmup_numbers` no painel do Blue Desk.

**Decisão fixada:** usar o **módulo HTTP genérico** do Make (não o app nativo "WhatsApp
Business Cloud"), porque o app nativo tende a amarrar a conexão a um phone_number_id fixo — e
aqui o remetente muda a cada chamada. O token do System User fica no **keychain/conexão** do
Make, nunca hardcoded num módulo.

---

## Cenário 1 — "Aquecimento · Disparo"

```
Custom webhook (recebe WarmupMessagePayload)
  → Router
      ├─[message_type = template]→ HTTP POST Graph API (type: template)
      └─[message_type = session ]→ HTTP POST Graph API (type: text)
  → HTTP POST callback /api/aquecimento/dispatch-result   (sucesso e erro)
```

### 1. Custom webhook
Recebe o POST de `sendWarmupNotification`. A URL gerada pelo Make vira o valor de
`MAKE_WEBHOOK_URL_WARMUP` no Cloudflare. Campos do corpo (`WarmupMessagePayload`):

| Campo | Uso |
|---|---|
| `message_log_id` | id de `warmup_messages` — **idempotency key** e chave do callback |
| `message_type` | `template` \| `session` — decide o ramo do Router |
| `sender.sender_id` | phone_number_id da Meta → vai no **path** da URL |
| `sender.waba_id` / `sender.phone_number` | informativos |
| `receiver.receiver_number` | E.164 → `to` da mensagem |
| `template.name` / `template.language` | presentes só quando `template` |
| `session_text` | presente só quando `session` |
| `dry_run` | em `dry_run` o Blue Desk **nem chama** o Make (no-op na origem) — não deve chegar aqui |

### 2. Router — ramo A (`message_type = template`)
HTTP → Make a request:

| Campo | Valor |
|---|---|
| Method | `POST` |
| URL | `https://graph.facebook.com/v21.0/{{1.sender.sender_id}}/messages` |
| Headers | `Authorization`: `Bearer {{token do System User (conexão/keychain)}}` |
| Body content type | `Raw` · `application/json` |
| Request content | (abaixo) |

```json
{
  "messaging_product": "whatsapp",
  "to": "{{1.receiver.receiver_number}}",
  "type": "template",
  "template": {
    "name": "{{1.template.name}}",
    "language": { "code": "{{1.template.language}}" }
  }
}
```

### 2. Router — ramo B (`message_type = session`)
Mesma URL/headers, corpo:

```json
{
  "messaging_product": "whatsapp",
  "to": "{{1.receiver.receiver_number}}",
  "type": "text",
  "text": { "body": "{{1.session_text}}" }
}
```

### 3. Callback para o Blue Desk (nos dois ramos)
Ligue a rota de **erro** do módulo HTTP (botão direito → Add error handler) para também cair
aqui, de modo que sucesso **e** falha reportem. HTTP → Make a request:

| Campo | Valor |
|---|---|
| Method | `POST` |
| URL | `{{BLUELINE_URL}}/api/aquecimento/dispatch-result` |
| Headers | `X-Warmup-Callback-Secret`: *valor de `MAKE_CALLBACK_SECRET`* |
| Body | `application/json` (abaixo) |

Sucesso:
```json
{
  "message_log_id": "{{1.message_log_id}}",
  "ok": true,
  "graph_message_id": "{{2.body.messages[].id}}",
  "error_code": null,
  "error_detail": null
}
```
Erro (ramo do error handler): `"ok": false`, `graph_message_id: null`, e
`error_code`/`error_detail` com o retorno da Meta (`{{2.body.error.code}}` /
`{{2.body.error.message}}`).

O endpoint atualiza `warmup_messages` e, em códigos de número indisponível
(`131026`/`131031`/`368`), marca o remetente como `blocked`.

### Códigos de erro da Meta a diferenciar
| Código | Significado | Ação |
|---|---|---|
| `131047` | Fora da janela de 24h (re-engagement) | **Não deveria ocorrer** dado o cálculo interno — se ocorrer, é bug no tick; alertar, não retry silencioso |
| `131026` / `131031` / `368` | Número não entregável / bloqueado / restrito | Callback marca o remetente `blocked` |
| `130429` / rate limit / tier | Volume acima do permitido | Reduzir `tick_max_sends` ou pausar (manual no MVP) |
| Template reprovado/pausado | Nome/idioma inválido | Desativar o `warmup_templates.active` correspondente |

---

## Cenário 2 — "Aquecimento · Status Meta" (fase 2, opcional)

Não bloqueia o MVP. A Meta emite webhooks de conta quando configurados no App (Meta for
Developers → App → Webhooks → objeto `whatsapp_business_account`):

```
Custom webhook (evento da Meta, responde o hub.challenge)
  → Router por tipo
      ├─ phone_number_quality_update       → HTTP → Blue Desk (atualiza quality_rating/status)
      └─ message_template_status_update     → HTTP → Blue Desk (desativa template reprovado)
```

Exige um novo endpoint Blue Desk (ex.: `/api/aquecimento/quality-update`) — a implementar na
Sprint 5. Elimina a checagem manual do quality rating no Meta Business Suite.

---

## Segredos/variáveis
- **Cloudflare**: `MAKE_WEBHOOK_URL_WARMUP` (URL do webhook do Cenário 1), `WARMUP_CRON_SECRET`
  (endpoint do tick), `MAKE_CALLBACK_SECRET` (endpoint do callback).
- **GitHub Actions**: `BLUELINE_URL`, `WARMUP_CRON_SECRET`.
- **Make**: token do System User no gerenciador de conexões/keychain (nunca em texto plano
  num módulo).

## Onde ver o status da BM / Business Verification
Meta Business Suite (business.facebook.com) → Configurações da Empresa → Central de
Segurança; ou developers.facebook.com → App → Configurações → Verificação de Negócio. BM
não verificada trava o tier de mensagens no nível mais baixo (250 conversas/24h) — a causa
provável das restrições, não a quantidade de números por BM.
