// Barrel do feature Minutas Processuais (Jurídico) — domínio SEPARADO das "Minutas" do CS.
//
// ⚠️ Visão Geral (Recharts) e Calendário (date-fns) saíram daqui e vivem em `./lazy`:
// re-exportá-las neste módulo trazia as duas bibliotecas para o First Load JS da rota mesmo
// sem ninguém usar a exportação. Ver o comentário equivalente em features/leads/index.ts.
export { MinutasTabNav, type MinutaTab } from './components/MinutasTabNav'
export { MinutasLista } from './components/MinutasLista'
export { MinutaForm } from './components/MinutaForm'
