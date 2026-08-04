// Peças apresentacionais do painel de Sucesso do Cliente (CS) reformulado (painel de 4 abas —
// ver docs/painelcs-docs/updates/painel-sucesso-cliente-cs.md). A composição vive em app/cs/CsClient.tsx
// (dentro do AppShell), como no dashboard de leads. Domínio SEPARADO: réplica local, nada
// compartilhado com leads/comercial.
//
// ⚠️ As abas 2–4 (Equipe, Minutas, Pagamento) saíram deste barrel e vivem em `./lazy` — juntas
// respondiam por quase todo o bundle da rota, embora só uma fique montada por vez. Ver o
// comentário equivalente em features/leads/index.ts.
export { CsTabNav, type CsTab } from './components/CsTabNav'
export { CsTabPlaceholder } from './components/CsTabPlaceholder'
export { CsMatrix } from './components/CsMatrix'
