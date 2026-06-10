// Utilitários de parsing de mailing — rodam no browser (cliente).
// O xlsx é carregado via dynamic import para não entrar no bundle do worker.

export interface ParsedFile {
  headers: string[]
  rows: Record<string, string>[]
}

// Lê um .csv ou .xlsx e devolve cabeçalhos + linhas (tudo como string)
export async function parseMailingFile(file: File): Promise<ParsedFile> {
  const XLSX = await import('xlsx')
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  if (!ws) return { headers: [], rows: [] }

  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    defval: '',
    raw: false,
  })

  const headers = (aoa[0] ?? []).map((h) => String(h).trim())
  const rows = aoa
    .slice(1)
    .filter((r) => r.some((c) => String(c).trim() !== ''))
    .map((r) => {
      const obj: Record<string, string> = {}
      headers.forEach((h, i) => {
        obj[h] = String(r[i] ?? '').trim()
      })
      return obj
    })

  return { headers, rows }
}

// Normaliza telefone BR: remove formatação, tira +55, valida 10–11 dígitos com DDD
export function normalizePhone(raw: string): string | null {
  let d = (raw ?? '').replace(/[^0-9]/g, '')
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2)
  if (d.length === 10 || d.length === 11) return d
  return null
}

// Converte um cabeçalho em uma chave segura para extra_data (remove acentos)
const COMBINING_MARKS = new RegExp('[\\u0300-\\u036f]', 'g')

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(COMBINING_MARKS, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'campo'
  )
}
