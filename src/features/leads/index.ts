// Peças apresentacionais do dashboard de leads. A composição vive no
// app/leads/LeadsClient.tsx (dentro do AppShell), como no dashboard do discador.
// PeriodPicker mudou para @/components/bluedesk/PeriodPicker (compartilhado com a discadora).
//
// ⚠️ Os componentes de GRÁFICO não são exportados aqui — eles vivem em `./lazy` (carga sob
// demanda). Não é organização: um barrel é um único módulo, então bastava ele RE-EXPORTAR o
// Recharts para o bundler puxar a biblioteca inteira para o First Load JS da rota, mesmo que
// nenhum importador usasse aquela exportação. Era exatamente o que acontecia. Ao adicionar um
// gráfico novo, registre-o em `./lazy.tsx`, não aqui.
export { LeadKpiRow } from './components/LeadKpiRow'
export { ResponsibleBreakdown } from './components/ResponsibleBreakdown'
export { LeadsTable } from './components/LeadsTable'
export { AgentRanking } from './components/AgentRanking'
export { DuplicateAlert } from './components/DuplicateAlert'
export { ForgottenLeads } from './components/ForgottenLeads'
export { ChannelBreakdown } from './components/ChannelBreakdown'
export { OrphanLeads } from './components/OrphanLeads'
export { AlertsPanel, type AlertItem } from './components/AlertsPanel'
export { LeadsTabNav, type LeadTab } from './components/LeadsTabNav'
export { TabPlaceholder } from './components/TabPlaceholder'
export { PRODUCTIVE_PHASES, DEAD_PHASES, WON_ORDER } from './content/phases'
