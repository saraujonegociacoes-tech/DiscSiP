// Helpers puros de @menção nos comentarios de tarefa. Sem dependencia de React —
// usados tanto pela renderizacao (segmentMentions) quanto pela extracao de ids no
// envio (extractMentionIds). Um "membro mencionavel" e so { id, label }.

export type Mentionable = { id: string; label: string }

function sortByLabel(members: Mentionable[]): Mentionable[] {
  // Casa o rotulo mais LONGO primeiro (nomes compostos antes do primeiro nome).
  return [...members].filter((m) => m.label).sort((a, b) => b.label.length - a.label.length)
}

// Casa o rotulo de um membro logo apos o '@' em `at` (indice do @). Exige fronteira:
// o char seguinte ao nome nao pode ser letra/numero (evita "@Ana" casar em "@Anabela").
function matchAt(
  text: string,
  at: number,
  sorted: Mentionable[],
): { member: Mentionable; len: number } | null {
  const rest = text.slice(at + 1)
  const lower = rest.toLowerCase()
  for (const m of sorted) {
    if (lower.startsWith(m.label.toLowerCase())) {
      const next = rest.charAt(m.label.length) // '' no fim da string = fronteira valida
      if (!/[\p{L}\p{N}]/u.test(next)) return { member: m, len: m.label.length }
    }
  }
  return null
}

/** Ids (dedup) dos membros cujo @rotulo aparece no corpo do comentario. */
export function extractMentionIds(body: string, members: Mentionable[]): string[] {
  const sorted = sortByLabel(members)
  const ids = new Set<string>()
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== '@') continue
    const hit = matchAt(body, i, sorted)
    if (hit) {
      ids.add(hit.member.id)
      i += hit.len // pula o nome ja casado
    }
  }
  return [...ids]
}

export type BodySegment = { text: string; mention: boolean }

/** Quebra o corpo em segmentos texto/mencao para renderizar @nomes destacados. */
export function segmentMentions(body: string, members: Mentionable[]): BodySegment[] {
  const sorted = sortByLabel(members)
  const segs: BodySegment[] = []
  let buf = ''
  const flush = () => {
    if (buf) {
      segs.push({ text: buf, mention: false })
      buf = ''
    }
  }
  for (let i = 0; i < body.length; ) {
    if (body[i] === '@') {
      const hit = matchAt(body, i, sorted)
      if (hit) {
        flush()
        segs.push({ text: body.slice(i, i + 1 + hit.len), mention: true })
        i += 1 + hit.len
        continue
      }
    }
    buf += body[i]
    i++
  }
  flush()
  return segs
}

/**
 * Token de @menção em digitacao na posicao do cursor: o '@' precisa estar no
 * inicio ou apos espaco, e nao pode haver espaco entre ele e o cursor. Retorna a
 * posicao do '@' e o texto ja digitado (query), ou null se nao ha token ativo.
 */
export function mentionQueryAt(
  value: string,
  caret: number,
): { start: number; query: string } | null {
  for (let i = caret - 1; i >= 0; i--) {
    const ch = value[i]
    if (ch === '@') {
      const before = i === 0 ? ' ' : value[i - 1]
      if (i === 0 || /\s/.test(before)) return { start: i, query: value.slice(i + 1, caret) }
      return null
    }
    if (/\s/.test(ch)) return null // achou espaco antes do @ → nao e menção
  }
  return null
}
