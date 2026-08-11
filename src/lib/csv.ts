// Export CSV do painel — um escritor só para todas as abas.
//
// Nasceu de quatro cópias iguais do mesmo trecho (CsMatrix, CsMinutas, CsPagamento,
// MinutasLista): cada uma tinha seu `cell()`, seu BOM e seu <a download>. Quando o dono
// pediu "toda exportação tem que sair com a URL" (11/ago/2026), a regra teria que ser
// aplicada quatro vezes — e esquecer uma é o tipo de erro que ninguém vê. As COLUNAS
// continuam sendo decisão de cada aba (o dado é diferente); o que mora aqui é o formato.
//
// Formato (mantido igual ao que as abas já geravam, pra não quebrar planilha de ninguém):
//   · separador `;` — é o que o Excel em pt-BR espera;
//   · BOM UTF-8 na frente — sem ele o Excel come os acentos;
//   · aspas só quando o valor tem `;`, `"` ou quebra de linha (aspas internas dobradas).

/** Um valor de célula. `null`/`undefined` viram string vazia. */
export type CsvValue = string | number | null | undefined

function cell(v: CsvValue): string {
  const s = v == null ? '' : String(v)
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Monta o texto do CSV (com BOM). Separado do download pra poder ser testado. */
export function buildCsv(head: string[], rows: CsvValue[][]): string {
  const lines = rows.map((r) => r.map(cell).join(';'))
  return '﻿' + [head.map(cell).join(';'), ...lines].join('\n')
}

/** Monta e dispara o download no navegador. `filename` sem extensão — o `.csv` entra aqui. */
export function downloadCsv(filename: string, head: string[], rows: CsvValue[][]): void {
  const blob = new Blob([buildCsv(head, rows)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${filename}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
