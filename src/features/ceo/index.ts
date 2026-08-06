// Peças apresentacionais do Painel do CEO (painel de 3 abas — ver
// docs/projetopainelceo-docs/updates/painel-ceo-sprints.md). A composição vive em
// app/ceo/CeoClient.tsx (dentro do AppShell), como em CS e no dashboard de leads.
//
// Domínio SEPARADO: réplica local, nada compartilhado com cs/leads. Diferente das outras
// features, esta não terá schema próprio — o painel é camada de leitura/agregação por cima
// das verticais isoladas, e os dados chegam por RPCs de composição em app/actions/ceo.ts.
//
// ⚠️ As abas com gráfico (Financeiro, Projeções) saíram deste barrel e vivem em `./lazy` —
// re-exportá-las aqui trazia o Recharts inteiro para o First Load JS da rota. Ver o comentário
// equivalente em features/leads/index.ts.
export { CeoTabNav, type CeoTab } from './components/CeoTabNav'
export { CeoPeriodPicker, type CeoPeriodMode } from './components/CeoPeriodPicker'
