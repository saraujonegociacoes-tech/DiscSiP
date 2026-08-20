// Barrel do feature Central de Aparelhos (inventário de TI, rota /aparelhos).
//
// ⚠️ NÃO existe `lazy.tsx` aqui de propósito, e ele não deve ser criado sem motivo:
// as quatro abas são tabelas e formulários, nenhuma puxa Recharts nem date-fns.
// Não há chunk pesado pra adiar — o `next/dynamic` só acrescentaria um estado de
// carregamento a mais. Se um dia alguma aba ganhar gráfico, ela sai deste barrel
// para um `./lazy` ANTES de importar a biblioteca: exportar daqui um componente
// que usa Recharts arrasta a biblioteca inteira para o First Load JS da rota mesmo
// sem ninguém usar a exportação (a armadilha documentada em
// docs/performance-docs/updates/auditoria-performance-2026-08.md).
export { AparelhosTabNav, type AparelhoTab } from './components/AparelhosTabNav'
export { InventarioVisaoGeral } from './components/InventarioVisaoGeral'
export { AparelhosLista } from './components/AparelhosLista'
export { ChipsLista } from './components/ChipsLista'
export { PessoasLista } from './components/PessoasLista'
