# Blue Line — Restilização da interface do Blue Line

Recriar a interface inteira aplicando a identidade visual **Blue Line Power Dialer**. Foco 100% em UI/visual: tokens, tema dark institucional, layout, componentes e telas. Nenhuma lógica de negócio, integração SIP, Supabase ou helper local é tocada — entrego um shell visual navegável que depois pode ser plugado ao backend real do Blue Line.

## 1. Design system (src/styles.css)

Substituir o tema padrão pelo tema Blue Line dark, todo via tokens semânticos `oklch`:

- `--background` `#000020` · `--sidebar` `#000A30` · `--card` `#07133F` · `--accent/hover` `#0B1D55`
- `--primary` `#0066CC` · `--secondary` `#001F5B` · `--success` (ciano) `#00C2A8`
- `--warning` `#FFB020` · `--destructive` `#FF4D4F`
- `--foreground` `#FFFFFF` · `--muted-foreground` `#AAB4D0` · `--border` `rgba(255,255,255,0.08)`
- `--gradient-premium: linear-gradient(135deg, #000020 0%, #001F5B 50%, #0066CC 100%)`
- Sombras suaves azuladas + `--radius` 0.75rem
- Fonte **Inter** (300/400/500/600/700) carregada via `<link>` no `__root.tsx` e registrada em `@theme` como `--font-sans`

Forçar tema escuro por padrão (classe `dark` no `<html>`).

## 2. Logo Blue Line

Componente SVG `BlueLineLogo` reutilizável:
- Símbolo: ondas de voz / linha de transmissão estilizada em gradiente azul→ciano (sem telefone/headset)
- Variante completa: símbolo + "BLUE LINE" / "POWER DIALER"
- Variante compacta: só o símbolo (favicon, sidebar colapsada)
- Favicon gerado a partir do mesmo símbolo

## 3. Shell e navegação

Estrutura de rotas TanStack espelhando o app real (apenas a casca visual, com dados mockados):

```
src/routes/
  __root.tsx              -> SidebarProvider + tema dark + Inter
  index.tsx               -> redireciona para /dashboard
  login.tsx               -> tela de auth restilizada
  aguardando.tsx          -> estado "pending"
  dashboard.tsx           -> visão geral
  campaigns.tsx           -> lista de campanhas (supervisor)
  campaigns.$id.tsx       -> detalhe da campanha + mailings
  dialer.tsx              -> tela do agente (discagem)
  reports.tsx             -> relatórios e gráficos
  users.tsx               -> admin / RBAC
  settings.tsx            -> configurações + ramal
```

Sidebar colapsável (shadcn) com cor `#000A30`, item ativo em `#0B1D55`, ícones lucide, logo compacta no topo, perfil do usuário no rodapé. Header superior com `SidebarTrigger`, breadcrumb e badge de status do ramal.

## 4. Telas (mock data, sem backend)

- **Login / Aguardando** — card centralizado sobre gradiente premium, logo grande, Inter, botão primário `#0066CC`.
- **Dashboard** — KPIs (chamadas, conversões, tempo médio, taxa de atendimento) em cards `#07133F` com bordas sutis; gráfico de linhas (Recharts) usando paleta de status (`#0066CC` linha, `#00C2A8` meta, `#FFB020` alertas, `#FF4D4F` falhas); lista de campanhas ativas.
- **Campaigns** — tabela de campanhas com status pill (Disponível / Em chamada / Pausado / Erro), botões de ação, modal de criar campanha, upload de mailing `.csv/.xlsx`.
- **Campaign detail** — abas (Mailings · Agentes · Configuração · Histórico), tabela de contatos, progresso da fila.
- **Dialer (agente)** — layout dedicado: card grande com o próximo contato, controles (Atender / Próximo / Pausar / Encerrar), timer em destaque, painel lateral com histórico do contato e notas, indicador "Em chamada" em ciano `#00C2A8`.
- **Reports** — filtros + gráficos (linha, barras, donut) com a paleta de status.
- **Users (admin)** — tabela de usuários com papel, departamento, ramal; ações de aprovar pendentes.
- **Settings** — perfil, ramal softphone utilizado, preferências.

## 5. Componentes reaproveitáveis

`StatusBadge`, `KpiCard`, `GradientPanel`, `SectionHeader`, `EmptyState`, `DataTable` (wrapper sobre shadcn Table), `PageHeader`, `AgentCallCard`. Todos consumindo apenas tokens semânticos.

## 6. Sensação visual

SaaS corporativo de vendas — nada de telemarketing/call-center. Tipografia Inter limpa, muito espaço negativo dentro dos cards escuros, gradiente premium reservado para áreas de destaque (login, hero do dashboard, header da campanha), microinterações sutis (hover trocando para `#0B1D55`, transições 150ms).

## Fora de escopo

- Integração SIP / softphone utilizado / helper local
- Supabase Auth, RLS, server actions, RBAC real
- Upload e parsing real de `.csv/.xlsx`
- Persistência — tudo com mocks em memória só para o visual

Resultado: um app navegável idêntico em estrutura ao Blue Line, totalmente vestido com a marca Blue Line, pronto para depois ser conectado ao backend existente.
