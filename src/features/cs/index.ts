// Peças apresentacionais do painel de Sucesso do Cliente (CS) reformulado (painel de 4 abas —
// ver docs/updates/painel-sucesso-cliente-cs.md). A composição vive em app/cs/CsClient.tsx
// (dentro do AppShell), como no dashboard de leads. Domínio SEPARADO: réplica local, nada
// compartilhado com leads/comercial.
export { CsTabNav, type CsTab } from './components/CsTabNav'
export { CsTabPlaceholder } from './components/CsTabPlaceholder'
export { CsMatrix } from './components/CsMatrix'
export { CsTeam } from './components/CsTeam'
