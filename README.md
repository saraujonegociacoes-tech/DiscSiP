# DiscSiP — Power Dialer

Sistema web de discagem semi-automática para a equipe de vendas da Araujo Negociações, integrado ao PABX Intelbras WidevoiceX via MicroSIP.

- **App:** https://discsip.pages.dev
- **Deploy:** Cloudflare Pages

## Como funciona

**Supervisor** (em `/campaigns`):
1. Cria uma campanha e a configura: horário de funcionamento, agentes participantes e campos visíveis ao agente
2. Sobe o mailing (`.csv`/`.xlsx`), mapeia as colunas (nome/telefone/extras) e define as regras de reciclagem

**Agente** (em `/softphone`):
1. Entra com seu ramal e vê apenas as campanhas em que participa
2. Seleciona uma campanha e clica **Iniciar discagem** (bloqueado fora do horário configurado)
3. O sistema busca o próximo contato da fila e aciona o MicroSIP via helper local
4. O MicroSIP disca automaticamente — agente só atende o telefone
5. Ao encerrar, o agente registra o resultado e o próximo contato é carregado

Contatos sem sucesso podem voltar à fila automaticamente (reciclagem), até um limite de tentativas.

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Frontend + Backend | Next.js 15 (App Router, Server Actions) |
| Deploy | Cloudflare Pages (`@opennextjs/cloudflare`) |
| Banco de dados | Supabase (PostgreSQL) |
| Estado global | Zustand 5 |
| Estilo | TailwindCSS 4 |
| Discagem | MicroSIP + helper local Node.js |

## Configuração do ambiente

```bash
cp .env.example .env.local
# preencha com suas credenciais Supabase
npm install
npm run dev
```

## Helper local (máquinas dos agentes)

O helper é um script Node.js que roda em background em cada PC de agente e aciona o MicroSIP via protocolo `tel:`.

**Instalação (uma vez por máquina):**

```
local-helper/instalar.bat
```

Requisito: Node.js instalado na máquina.

## Build e deploy

```bash
npm run build:cf   # build para Cloudflare Pages
```

O Cloudflare Pages detecta commits na branch `main` e faz o deploy automaticamente.

## Variáveis de ambiente (Cloudflare Pages dashboard)

| Variável | Descrição |
|----------|-----------|
| `NEXT_PUBLIC_SUPABASE_URL` | URL do projeto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Chave pública do Supabase |
| `MAKE_WEBHOOK_URL` | (Opcional) Webhook do Make para notificação pós-chamada |
