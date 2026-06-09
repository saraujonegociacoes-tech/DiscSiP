# DiscSiP — Power Dialer

Sistema web de discagem semi-automática para a equipe de vendas da Araujo Negociações, integrado ao PABX Intelbras WidevoiceX via MicroSIP.

- **App:** https://discsip.pages.dev
- **Deploy:** Cloudflare Pages

## Como funciona

1. Agente abre o DiscSiP no browser e entra com seu ramal
2. Seleciona uma campanha e clica **Iniciar discagem**
3. O sistema busca o próximo contato da fila e aciona o MicroSIP via helper local
4. O MicroSIP disca automaticamente — agente só atende o telefone
5. Ao encerrar, agente registra o resultado e o próximo contato é carregado

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
