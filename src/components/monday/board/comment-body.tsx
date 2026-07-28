import { segmentMentions, type Mentionable } from '@/lib/monday/mentions'

/**
 * Corpo de um comentario com as @menções destacadas. Mantem o mesmo estilo do
 * texto puro anterior (whitespace-pre-wrap + break-words); as menções conhecidas
 * (membros do projeto) viram <span> em cor primaria, sem injetar HTML.
 */
export function CommentBody({ body, members }: { body: string; members: Mentionable[] }) {
  const segments = segmentMentions(body, members)
  return (
    <p className="whitespace-pre-wrap break-words text-sm">
      {segments.map((seg, i) =>
        seg.mention ? (
          <span key={i} className="font-medium text-primary">
            {seg.text}
          </span>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </p>
  )
}
