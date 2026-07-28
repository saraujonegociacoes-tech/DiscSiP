import { Fragment, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Render leve de texto formatado, sem dependências nem HTML injetado (constrói
 * nós React puros). Usado nas descrições de tarefas e nos objetivos de sprint,
 * onde o usuário escreve com tópicos e quebras de linha que antes eram perdidos.
 *
 * Suporta:
 *  - Tópicos    → linhas começando com `-`, `*` ou `•`
 *  - Lista num. → linhas começando com `1.`, `2)` etc.
 *  - Negrito    → `**texto**`
 *  - Itálico    → `*texto*` ou `_texto_`
 *  - Parágrafos → linhas em branco separam blocos; quebras simples são mantidas.
 */

const UL_RE = /^\s*[-*•]\s+(.*)$/
const OL_RE = /^\s*\d+[.)]\s+(.*)$/

type Block =
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] }
  | { type: 'p'; lines: string[] }

function parseBlocks(content: string): Block[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const blocks: Block[] = []
  let cur: Block | null = null
  const flush = () => {
    if (cur) blocks.push(cur)
    cur = null
  }

  for (const line of lines) {
    if (line.trim() === '') {
      flush()
      continue
    }
    const ul = line.match(UL_RE)
    const ol = line.match(OL_RE)
    if (ul) {
      if (cur?.type !== 'ul') {
        flush()
        cur = { type: 'ul', items: [] }
      }
      cur.items.push(ul[1])
    } else if (ol) {
      if (cur?.type !== 'ol') {
        flush()
        cur = { type: 'ol', items: [] }
      }
      cur.items.push(ol[1])
    } else {
      if (cur?.type !== 'p') {
        flush()
        cur = { type: 'p', lines: [] }
      }
      cur.lines.push(line)
    }
  }
  flush()
  return blocks
}

// **negrito**, *itálico* e _itálico_ — aplicado por linha (não atravessa quebras).
const INLINE_RE = /(\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|_([^_\s][^_]*)_)/g

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let last = 0
  let i = 0
  let m: RegExpExecArray | null
  INLINE_RE.lastIndex = 0
  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index))
    if (m[2] !== undefined) {
      nodes.push(<strong key={`${keyPrefix}-${i}`}>{m[2]}</strong>)
    } else {
      nodes.push(<em key={`${keyPrefix}-${i}`}>{m[3] ?? m[4]}</em>)
    }
    last = m.index + m[0].length
    i++
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

export function RichText({ content, className }: { content: string; className?: string }) {
  const blocks = parseBlocks(content)
  if (blocks.length === 0) return null

  return (
    <div className={cn('space-y-2 break-words', className)}>
      {blocks.map((b, bi) => {
        if (b.type === 'ul') {
          return (
            <ul key={bi} className="list-disc space-y-0.5 pl-4">
              {b.items.map((it, ii) => (
                <li key={ii}>{renderInline(it, `${bi}-${ii}`)}</li>
              ))}
            </ul>
          )
        }
        if (b.type === 'ol') {
          return (
            <ol key={bi} className="list-decimal space-y-0.5 pl-4">
              {b.items.map((it, ii) => (
                <li key={ii}>{renderInline(it, `${bi}-${ii}`)}</li>
              ))}
            </ol>
          )
        }
        return (
          <p key={bi} className="whitespace-pre-wrap">
            {b.lines.map((ln, li) => (
              <Fragment key={li}>
                {li > 0 && '\n'}
                {renderInline(ln, `${bi}-${li}`)}
              </Fragment>
            ))}
          </p>
        )
      })}
    </div>
  )
}
