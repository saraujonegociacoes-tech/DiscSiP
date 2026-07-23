# Stack blueprint — criar um novo projeto na stack da Blue Line (Araújo)

Documento de referência para **começar um projeto novo** (no caso, um **"Monday" —
controle visual de tarefas e sprints**) usando **exatamente a mesma stack** do sistema da
Araújo (Blue Line). O objetivo é que o novo app seja um **irmão técnico**: mesma base de
código, mesmo jeito de autenticar, mesmo design system, mesmo deploy — só muda o domínio.

> Este doc é **portátil**: pode ser copiado para dentro do repositório do "Monday" e usado
> como especificação de bootstrap. Nada aqui depende do discador/leads/CS — é só a fundação
> reaproveitável.

---

## Índice

- [1. Stack em uma tabela](#1-stack-em-uma-tabela)
- [2. Princípios de arquitetura](#2-princípios-de-arquitetura)
- [3. Bootstrap do projeto (do zero)](#3-bootstrap-do-projeto-do-zero)
- [4. Arquivos de configuração (verbatim)](#4-arquivos-de-configuração-verbatim)
- [5. Estrutura de pastas](#5-estrutura-de-pastas)
- [6. Supabase — 3 clientes + service](#6-supabase--3-clientes--service)
- [7. Auth + RBAC (middleware)](#7-auth--rbac-middleware)
- [8. Design system (Tailwind v4 + tokens + shadcn)](#8-design-system-tailwind-v4--tokens--shadcn)
- [9. Padrões de código](#9-padrões-de-código)
- [10. Deploy (Cloudflare Pages)](#10-deploy-cloudflare-pages)
- [11. Cron / agendamento](#11-cron--agendamento)
- [12. O que NÃO trazer da Blue Line](#12-o-que-não-trazer-da-blue-line)
- [13. Checklist do zero ao 1º deploy](#13-checklist-do-zero-ao-1º-deploy)
- [Apêndice — modelo de dados sugerido pro "Monday"](#apêndice--modelo-de-dados-sugerido-pro-monday)

---

## 1. Stack em uma tabela

| Camada | Tecnologia | Versão na Blue Line |
|--------|-----------|---------------------|
| Framework (front + back) | **Next.js** App Router + Server Actions | `15.5.19` |
| Runtime UI | **React** + React DOM | `19.1.0` |
| Linguagem | **TypeScript** | `^5` (strict) |
| Banco + Auth + Realtime | **Supabase** (PostgreSQL + Auth + RLS + Realtime) | `@supabase/supabase-js ^2.107`, `@supabase/ssr ^0.12` |
| Estado global (efêmero) | **Zustand** | `5.0.14` |
| Estilo | **Tailwind CSS v4** (via `@tailwindcss/postcss`) | `^4` |
| Primitivos acessíveis | **Radix UI** (`@radix-ui/react-*`) | várias `^1`/`^2` |
| Variantes de classe | **class-variance-authority** + `clsx` + `tailwind-merge` | — |
| Ícones | **lucide-react** | `^0.575` |
| Gráficos | **Recharts** | `^3.8` |
| Toasts | **sonner** | `^2.0` |
| Parse de planilha | **xlsx** (SheetJS) — client-side, dynamic import | `^0.18` |
| Animação utilitária | **tw-animate-css** | `^1.4` |
| Deploy | **Cloudflare Pages** (Advanced Mode `_worker.js`) via **`@opennextjs/cloudflare`** + `wrangler` | `^1.19` / `^4.98` |
| Lint | **ESLint 9** flat config + `eslint-config-next` | `^9` |

Ferramenta de construção: **Claude Code dentro do VS Code**. Idioma de todo o produto e docs:
**pt-BR**.

---

## 2. Princípios de arquitetura

O que faz esse stack ser coeso — copie estes princípios, não só as libs:

1. **Sem backend próprio.** O "backend" são **Server Actions** do Next (`'use server'`) +
   **RPCs/Views no Postgres**. Não há Express/Nest/API layer separada (a única exceção são
   *Route Handlers* pontuais para webhooks/cron, autenticados por segredo).
2. **RLS-first (segurança no banco).** A regra de "quem vê o quê" mora no **Row Level
   Security** do Postgres, não no frontend. O frontend nunca é a fronteira de segurança —
   é só a apresentação. Server Actions usam a **sessão do usuário** (via cookies) pra que
   `auth.uid()` chegue ao Postgres e o RLS se aplique sozinho.
3. **Cálculo pesado no banco.** Métricas/agregações são **RPCs e Views SQL** calculadas uma
   vez no Postgres; o frontend só lê o resultado pronto (protege egress e mantém a lógica
   num lugar só).
4. **Degrada, não quebra.** Se uma migration ainda não foi aplicada ou o usuário não tem
   acesso, a action **retorna vazio** em vez de estourar (`if (error) return { …: [] }`).
5. **Domínios isolados no mesmo app.** Cada vertical tem schema/RLS/RPCs próprios, sem FKs
   cruzadas (ponte só por `profiles.id`). Um "Monday" novo seria seu próprio domínio limpo.
6. **Feature flags de build.** Módulos novos ficam atrás de `NEXT_PUBLIC_*_ENABLED`; sem a
   flag, a rota mostra "Em breve". Permite mergear código incompleto sem expor.
7. **Migrations idempotentes, aplicadas à mão.** SQL em `supabase/migrations/`
   (`YYYYMMDD_nome.sql`, sempre `create ... if not exists` / `create or replace`), rodado
   **manualmente no SQL Editor do Supabase** pelo dono. O `supabase/` não é obrigatório no
   git (na Blue Line arquivos novos são gitignored; o schema de verdade vive no Supabase).

---

## 3. Bootstrap do projeto (do zero)

```bash
# 1) Scaffold — App Router, TS, Tailwind v4, ESLint, src/, alias @/*, Turbopack no dev
npx create-next-app@15.5.19 monday \
  --typescript --tailwind --eslint --app --src-dir \
  --import-alias "@/*" --turbopack

cd monday

# 2) Dependências de runtime (mesma lista da Blue Line, menos o que é do discador)
npm i @supabase/ssr @supabase/supabase-js zustand recharts sonner \
  class-variance-authority clsx tailwind-merge lucide-react \
  tw-animate-css xlsx \
  @radix-ui/react-avatar @radix-ui/react-checkbox @radix-ui/react-dialog \
  @radix-ui/react-dropdown-menu @radix-ui/react-label @radix-ui/react-progress \
  @radix-ui/react-scroll-area @radix-ui/react-select @radix-ui/react-separator \
  @radix-ui/react-slot @radix-ui/react-switch @radix-ui/react-tabs \
  @radix-ui/react-tooltip

# 3) Deploy Cloudflare (dev deps)
npm i -D @opennextjs/cloudflare wrangler
```

> **Por que pinar `15.5.19` / React 19:** garante paridade com a Blue Line (App Router +
> Server Actions + `cookies()` async do Next 15). Se `create-next-app@latest` trouxer versão
> maior, force `next@15.5.19`, `react@19.1.0`, `react-dom@19.1.0` no `package.json`.

Scripts sugeridos no `package.json` (espelham a Blue Line):

```jsonc
{
  "scripts": {
    "dev": "next dev --turbopack",
    "build": "next build",
    "build:cf": "opennextjs-cloudflare build && node -e \"const fs=require('fs');fs.renameSync('.open-next/worker.js','.open-next/_worker.js');fs.readdirSync('.open-next/assets').forEach(f=>fs.cpSync('.open-next/assets/'+f,'.open-next/'+f,{recursive:true}));const init=fs.readFileSync('.open-next/cloudflare/init.js','utf8');fs.writeFileSync('.open-next/cloudflare/init.js',init.replace('__ASSETS_RUN_WORKER_FIRST__: false','__ASSETS_RUN_WORKER_FIRST__: true'));\"",
    "preview": "opennextjs-cloudflare build && wrangler pages dev",
    "start": "next start",
    "lint": "eslint"
  }
}
```

---

## 4. Arquivos de configuração (verbatim)

Copie estes tal e qual — são a "assinatura" da stack.

**`tsconfig.json`** (o essencial: `strict`, alias `@/*`, `moduleResolution: bundler`):

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules", "docs"]
}
```

**`next.config.ts`** (otimização de memória p/ máquina com pouca RAM / OneDrive):

```ts
import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  experimental: { webpackMemoryOptimizations: true, cpus: 1 },
};
export default nextConfig;
```

**`postcss.config.mjs`** (Tailwind v4 é um plugin do PostCSS, não tem `tailwind.config.js`):

```js
const config = { plugins: ["@tailwindcss/postcss"] };
export default config;
```

**`eslint.config.mjs`** (flat config, ignora `docs/`):

```js
import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";
const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });
export default [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  { ignores: ["node_modules/**", ".next/**", "out/**", "build/**", "next-env.d.ts", "docs/**"] },
];
```

**`open-next.config.ts`**:

```ts
import { defineCloudflareConfig } from "@opennextjs/cloudflare";
export default defineCloudflareConfig();
```

**`wrangler.toml`** (na raiz):

```toml
pages_build_output_dir = ".open-next"
compatibility_flags = ["nodejs_compat"]
compatibility_date = "2024-09-23"
```

---

## 5. Estrutura de pastas

Mesma organização da Blue Line (colando só o esqueleto reaproveitável):

```
src/
├── middleware.ts                 Gate de auth/role + refresh de sessão (@supabase/ssr)
├── app/
│   ├── layout.tsx                <html lang="pt-BR"> + ThemeProvider + boot script anti-flash
│   ├── globals.css               Tailwind v4: @theme inline + tokens OKLCH + utilitários
│   ├── login/ · cadastro/ · verifique-email/ · aguardando/    Telas de auth
│   ├── auth/confirm/route.ts     Handler do link de confirmação de email
│   ├── actions/                  Server Actions ('use server') — o "backend"
│   │   ├── auth.ts               getCurrentProfile, signOut
│   │   └── <dominio>.ts          queries/mutações do domínio (ex.: boards.ts, sprints.ts)
│   └── <rota>/                   Páginas: Server Component busca dados → passa p/ *Client.tsx
├── features/<dominio>/           Componentes ricos por feature (gráficos, tabelas, painéis)
│   ├── components/
│   ├── content/                  Constantes/copy estáticos
│   └── index.ts                  Barrel export
├── components/
│   ├── ui/                       Primitivos shadcn/ui (Radix + CVA + cn): button, card,
│   │                             dialog, select, tabs, tooltip, table, badge, switch...
│   └── brand/ + <marca>/         Camada de marca: Logo, AppShell, PageHeader, KpiCard, tema
├── hooks/                        useMobile, etc.
├── store/                        Zustand — estado efêmero de cliente (não é fonte de verdade)
└── lib/
    ├── utils.ts                  cn() = twMerge(clsx(...))
    ├── types/database.ts         Types das tabelas/RPCs do Supabase (mantidos à mão)
    └── supabase/                 server.ts · client.ts · middleware.ts · service.ts

supabase/migrations/              SQL idempotente YYYYMMDD_*.sql (rodado à mão no Supabase)
.github/workflows/                keep-alive do Supabase (+ crons, se precisar)
docs/                             Documentação técnica em pt-BR
```

**Convenção de página:** `page.tsx` é **Server Component** (busca dados via Server Action),
renderiza um `XxxClient.tsx` (`'use client'`) que cuida de interação. Estado de servidor
fica no server; Zustand só pra estado de UI efêmero (ex.: painel aberto, item em drag).

---

## 6. Supabase — 3 clientes + service

O padrão `@supabase/ssr` usa **três** clientes conforme o contexto. Copie os quatro arquivos.

**`src/lib/supabase/server.ts`** — Server Actions / Server Components (propaga `auth.uid()`):

```ts
import { createServerClient as createSSRClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createServerClient() {
  const cookieStore = await cookies()   // async no Next 15
  return createSSRClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
          } catch { /* no-op fora de Server Action/Route Handler; o refresh real é no middleware */ }
        },
      },
    }
  )
}
```

**`src/lib/supabase/client.ts`** — browser (`'use client'`):

```ts
import { createBrowserClient } from '@supabase/ssr'
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
```

**`src/lib/supabase/middleware.ts`** — refresh de sessão + gate (ver [seção 7](#7-auth--rbac-middleware)).

**`src/lib/supabase/service.ts`** — `service_role`, **só** em Route Handlers de cron/webhook
sem sessão (NUNCA importado em código que vai pro browser). Usa `SUPABASE_SERVICE_ROLE_KEY`,
ignora RLS — use com parcimônia.

**Regras de ouro:**
- Toda Server Action começa com `const supabase = await createServerClient()`.
- Lógica pesada vira **RPC**: `await supabase.rpc('get_board', { p_id })`.
- Degrada: `if (error || !data) return { items: [] }`.
- `types/database.ts` é mantido **à mão** (não usam codegen na Blue Line).

---

## 7. Auth + RBAC (middleware)

Auth é **Supabase Auth (email/senha)** com confirmação de email ligada. Cadastro é
autosserviço: novo usuário entra como `pending` e fica preso em `/aguardando` até um admin
aprovar. O gate roda no `middleware.ts` (defesa além do RLS).

**`src/middleware.ts`:**

```ts
import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function middleware(request: NextRequest) {
  return updateSession(request)
}

export const config = {
  matcher: [
    // roda em tudo, menos assets do Next, favicon, imagens, /auth/* e rotas de webhook/cron
    '/((?!_next/static|_next/image|favicon.ico|auth/|api/webhook/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
```

**`src/lib/supabase/middleware.ts`** — o coração: refresca cookies com `getAll/setAll`,
chama `supabase.auth.getUser()`, e aplica redirects:

- sem sessão → `/login` (exceto rotas públicas: `/login`, `/cadastro`, `/verifique-email`);
- sessão `pending` → `/aguardando`;
- sessão aprovada em tela de auth → home do app;
- áreas restritas por papel → checa `profiles.role` antes de deixar entrar.

O modelo de papéis da Blue Line (`pending` → `agent` → `supervisor` → `manager` → `admin`)
pode ser simplificado no Monday (ex.: `pending` → `member` → `admin`), mas **mantenha o
padrão**: `profiles` espelha `auth.users.id`, trigger cria perfil `pending` no cadastro, e o
escopo de dados é RLS + reforço no middleware.

> Copie de referência o `middleware.ts` completo da Blue Line em
> [`src/lib/supabase/middleware.ts`](../../src/lib/supabase/middleware.ts) e recorte os
> papéis que o Monday não usa.

---

## 8. Design system (Tailwind v4 + tokens + shadcn)

Este é o que dá a **cara** de "sistema da Araújo". Três camadas:

### 8.1 Tailwind v4 sem config JS
Nada de `tailwind.config.js`. Tudo em `globals.css`:
- `@import "tailwindcss";` + `@import "tw-animate-css";`
- `@custom-variant dark (&:is(.dark *));` → dark mode por **classe** `.dark` no `<html>`.
- `@theme inline { --color-*: var(--…) }` → **ponte** que expõe os tokens como utilitários
  Tailwind (`bg-primary`, `text-muted-foreground`, `border-border`, `bg-chart-1`...).
- Tokens de cor em **OKLCH**, definidos em `:root` (light) e sobrescritos em `.dark`.
- `@utility` custom pros gradientes/sombras de marca: `bg-gradient-primary`, `shadow-card`,
  `shadow-glow`, `lift` (hover elevado), `sheen`, `fade-up`, `scrollbar-slim`...

Copie o [`src/app/globals.css`](../../src/app/globals.css) inteiro e **troque a paleta de
marca** (o bloco de comentário lista os HEX: `#000020 #001F5B #0066CC #00C2A8 #FFB020
#FF4D4F #D9E1F2`). Pro Monday, defina a sua própria paleta e reconverta pra OKLCH — a
**estrutura de tokens** (`--primary`, `--success`, `--chart-1..5`, `--sidebar-*`) fica igual.

### 8.2 Tema escuro por padrão, sem flash
- `layout.tsx` injeta um **boot script inline** no `<head>` que aplica `.dark` **antes** da
  hidratação (evita flash branco). Padrão institucional = escuro.
- `ThemeProvider` (Context + `localStorage`) com `useTheme()` e um `ThemeToggle`.
- Copie [`src/components/blueline/theme.tsx`](../../src/components/blueline/theme.tsx) e o
  `layout.tsx` (fonte **Inter** via `next/font/google`, `<html lang="pt-BR"
  suppressHydrationWarning>`).

### 8.3 Componentes: shadcn/ui + camada de marca
- **`src/components/ui/`** — primitivos estilo **shadcn/ui**: Radix + `cva` (variantes) +
  `cn()`. Padrão do `Button` (copie o jeito): `cva(base, { variants, defaultVariants })` +
  `Slot` p/ `asChild`. Gere via `npx shadcn@latest add button card dialog select tabs
  tooltip table badge switch dropdown-menu ...` **ou** copie os arquivos da Blue Line.
  (A Blue Line não usa `components.json` — os primitivos foram colados/gerados uma vez.)
- **`src/components/<marca>/`** — camada de marca por cima dos primitivos: `AppShell`,
  `PageHeader`, `KpiCard`, `StatusBadge`, `Logo`, `ThemeToggle`. Use tokens + utilitários de
  marca (`bg-gradient-card`, `shadow-card`, `lift`). Ver
  [`KpiCard.tsx`](../../src/components/blueline/KpiCard.tsx) como referência de estilo.

### 8.4 Gráficos
Recharts + um hook `useChartTheme()` que lê os tokens CSS (`--chart-1..5`) pra os gráficos
respeitarem o tema claro/escuro. Ver
[`src/components/blueline/useChartTheme.ts`](../../src/components/blueline/useChartTheme.ts).

> **Dica pro Monday:** antes de desenhar qualquer board/gráfico, rode a skill **`dataviz`**
> (guia de cores/heatmap/KPIs consistentes claro+escuro) — casa perfeitamente com os tokens
> `--chart-*` acima.

---

## 9. Padrões de código

- **Server Action** (`src/app/actions/*.ts`, começa com `'use server'`):
  ```ts
  'use server'
  import { createServerClient } from '@/lib/supabase/server'
  import type { Board } from '@/lib/types/database'

  export async function getBoard(id: string): Promise<Board | null> {
    const supabase = await createServerClient()
    const { data, error } = await supabase.rpc('get_board', { p_id: id })
    if (error || !data) return null          // degrada, não quebra
    return data as unknown as Board
  }
  ```
- **Feature flag:** `NEXT_PUBLIC_MONDAY_ENABLED=1`; sem ela, a rota mostra "Em breve".
  `NEXT_PUBLIC_*` é inlinado no build (build-time), então precisa estar setado no Cloudflare.
- **Realtime** (opcional, pro board atualizar sem F5): `createClient().channel(...).on(
  'postgres_changes', ...)` no cliente, atrás de flag `NEXT_PUBLIC_*_REALTIME`.
- **Fuso:** helper tipo `lib/timezone.ts` (America/Sao_Paulo) se houver métrica por dia.
- **Import de planilha:** `xlsx` com **dynamic import** no cliente (não pesa o bundle).
- **Toasts:** `sonner` (`<Toaster />` no layout do app + `toast.success(...)`).

---

## 10. Deploy (Cloudflare Pages)

Mesma pipeline. Cloudflare Pages serve o Next via `@opennextjs/cloudflare` em **Advanced
Mode** (`_worker.js`). O `build:cf` (ver [seção 3](#3-bootstrap-do-projeto-do-zero)) faz o
build OpenNext e pós-processa: renomeia `worker.js`→`_worker.js`, copia `assets/*` pra raiz,
liga `__ASSETS_RUN_WORKER_FIRST__`.

**No painel do Cloudflare Pages:**
- Build command: `npm run build:cf`
- Build output: `.open-next`
- Node.js: **22** · Branch: `main` (deploy automático no push)
- Secrets: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, e as
  `NEXT_PUBLIC_*_ENABLED` (build-time).

**No Supabase:** Authentication → Confirm email ligado; Site URL + Redirect URLs apontando
pro domínio do Pages (+ `localhost` no dev).

---

## 11. Cron / agendamento

**Cloudflare Pages não tem Cron Triggers.** Se o Monday precisar de tarefa agendada (ex.:
mover cards de sprint vencida, disparar lembrete), o padrão da Blue Line é **GitHub Actions**
batendo num Route Handler autenticado por segredo:

- `.github/workflows/<tarefa>.yml` roda no schedule e faz `POST /api/<tarefa>/tick` com um
  header `X-Cron-Secret`.
- O Route Handler valida o segredo e escreve via `service.ts` (`service_role`, sem sessão).
- Excluir `api/<tarefa>/` do matcher do `middleware.ts` (chega sem sessão).

Há também o **keep-alive** do Supabase Free (pausa após 7 dias inativo): workflow que faz
ping a cada 3 dias. Copie de `.github/workflows/`.

---

## 12. O que NÃO trazer da Blue Line

Deixe de fora — é específico do discador e não serve pro Monday:

- **`local-helper/`** (helper Node/Express + softphone/MicroSIP/PABX Intelbras) — só discador.
- **Ingestão Pipefy → Make** (leads/CS) e os scripts `import-*.mjs` — domínio comercial/CS.
- **Warmup WhatsApp** (`warmup_*`, Graph API da Meta) — módulo de infra específico.
- Papéis extras (`supervisor`, `manager`) e escopo por `department_slug`, se o Monday for
  simples — mantenha só o mínimo (`pending`/`member`/`admin`).

Traga **só** a fundação: Next+Server Actions, Supabase (3 clientes + RLS + RBAC no
middleware), design system (Tailwind v4 + tokens + shadcn + marca), Zustand, Recharts,
deploy Cloudflare, migrations idempotentes.

---

## 13. Checklist do zero ao 1º deploy

- [ ] `create-next-app@15.5.19` (App Router, TS, Tailwind, src/, alias `@/*`, turbopack).
- [ ] Instalar deps da [seção 3](#3-bootstrap-do-projeto-do-zero).
- [ ] Colar os configs da [seção 4](#4-arquivos-de-configuração-verbatim) + `wrangler.toml`.
- [ ] Criar projeto no Supabase; pôr URL + anon key no `.env.local`.
- [ ] Colar os 4 clientes Supabase ([seção 6](#6-supabase--3-clientes--service)).
- [ ] `middleware.ts` + gate de auth/role ([seção 7](#7-auth--rbac-middleware)).
- [ ] Migration `0001_auth_rbac.sql`: `profiles` (id = auth.users.id), trigger de perfil
      `pending`, RLS. Rodar à mão no SQL Editor. Bootstrap do 1º admin via `update profiles`.
- [ ] `globals.css` (tokens + paleta do Monday) + `theme.tsx` + `layout.tsx` pt-BR/Inter/boot.
- [ ] `components/ui/` (shadcn) + camada de marca (`AppShell`, `PageHeader`, `KpiCard`...).
- [ ] Telas de auth (`/login`, `/cadastro`, `/verifique-email`, `/aguardando`) + `/auth/confirm`.
- [ ] Modelar o domínio do Monday (ver apêndice) → migration `0002_monday_schema.sql` + RPCs.
- [ ] Primeira rota `/board` atrás de `NEXT_PUBLIC_MONDAY_ENABLED`.
- [ ] `npm run build:cf` local OK → conectar repo no Cloudflare Pages → deploy.

---

## Apêndice — modelo de dados sugerido pro "Monday"

Fora do escopo "stack", mas pra dar direção (desenhe você o schema; aplique como migration
idempotente com RLS). Um "Monday"/board visual costuma ser:

| Tabela | Papel |
|--------|-------|
| `boards` | Um quadro (projeto). `name`, `owner_id`, `archived_at` |
| `groups` | Seções/faixas dentro do board (ex.: "Sprint 1", "Backlog"). `board_id`, `position`, `color` |
| `items` | Os cards/tarefas. `group_id`, `title`, `position`, `assignee_id`, `status`, `due_at` |
| `columns` | Colunas customizáveis do board (status, prioridade, data...). `board_id`, `type`, `settings` (jsonb) |
| `item_values` | Valor de cada célula item×coluna. `item_id`, `column_id`, `value` (jsonb) |
| `sprints` | Sprints/ciclos. `board_id`, `name`, `starts_at`, `ends_at`, `goal` |
| `item_updates` | Comentários/histórico por item (pra timeline). `item_id`, `author_id`, `body`, `created_at` |

Padrões a manter: `position` numérico pra ordenação drag-and-drop; `settings`/`value` como
`jsonb` pra flexibilidade sem migration; RLS por `board` (membro do board lê/escreve, resto
não vê); métricas de sprint (burndown, itens por status) como **RPC/View**, não no frontend;
Realtime opcional pra board colaborativo. Pra drag-and-drop, avaliar `@dnd-kit` (fora da
stack atual — seria a única lib nova relevante).
