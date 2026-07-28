'use client'

import { useEffect, useRef, useState } from 'react'
import { initials } from '@/lib/monday/domain'
import { mentionQueryAt, type Mentionable } from '@/lib/monday/mentions'
import { cn } from '@/lib/utils'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Textarea } from '@/components/ui/textarea'

const MAX_SUGGESTIONS = 6

type Props = {
  value: string
  onChange: (value: string) => void
  members: Mentionable[]
  /** Ctrl/Cmd+Enter quando o menu de @menção esta fechado. */
  onSubmit?: () => void
  placeholder?: string
  rows?: number
  className?: string
}

type Menu = { start: number; caret: number; items: Mentionable[] }

/**
 * Textarea com autocomplete de @menção. Ao digitar "@" + texto, mostra os membros
 * filtrados; escolher insere "@Nome " no ponto do cursor. Nao existe combobox no
 * projeto, entao o menu e um popover proprio (estilo do dropdown-menu). A extracao
 * dos ids mencionados no envio fica no pai, via extractMentionIds(value, members).
 */
export function MentionTextarea({
  value,
  onChange,
  members,
  onSubmit,
  placeholder,
  rows = 2,
  className,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const [menu, setMenu] = useState<Menu | null>(null)
  const [highlight, setHighlight] = useState(0)
  // Reposiciona o cursor apos inserir uma menção (precisa acontecer pos-render).
  const pendingCaret = useRef<number | null>(null)

  useEffect(() => {
    if (pendingCaret.current != null && ref.current) {
      const pos = pendingCaret.current
      pendingCaret.current = null
      ref.current.focus()
      ref.current.setSelectionRange(pos, pos)
    }
  })

  function recompute(nextValue: string, caret: number) {
    const token = mentionQueryAt(nextValue, caret)
    if (!token) {
      setMenu(null)
      return
    }
    const q = token.query.toLowerCase()
    const items = members
      .filter((m) => m.label.toLowerCase().includes(q))
      .slice(0, MAX_SUGGESTIONS)
    if (!items.length) {
      setMenu(null)
      return
    }
    setMenu({ start: token.start, caret, items })
    setHighlight(0)
  }

  function accept(member: Mentionable) {
    if (!menu) return
    const before = value.slice(0, menu.start)
    const after = value.slice(menu.caret)
    const insert = `@${member.label} `
    const next = before + insert + after
    pendingCaret.current = (before + insert).length
    onChange(next)
    setMenu(null)
  }

  const open = menu != null && menu.items.length > 0

  return (
    <div className={cn('relative flex-1', className)}>
      <Textarea
        ref={ref}
        value={value}
        rows={rows}
        placeholder={placeholder}
        className="min-h-0 resize-none"
        onChange={(e) => {
          onChange(e.target.value)
          recompute(e.target.value, e.target.selectionStart ?? e.target.value.length)
        }}
        onClick={(e) => recompute(value, e.currentTarget.selectionStart ?? value.length)}
        onKeyUp={(e) => {
          // Recomputa ao mover o cursor (setas/Home/End) — mas nao quando o menu
          // esta aberto e a seta e usada para navegar as sugestoes.
          if (open && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) return
          if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End') {
            recompute(value, e.currentTarget.selectionStart ?? value.length)
          }
        }}
        onKeyDown={(e) => {
          if (open) {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setHighlight((h) => (h + 1) % menu!.items.length)
              return
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault()
              setHighlight((h) => (h - 1 + menu!.items.length) % menu!.items.length)
              return
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault()
              accept(menu!.items[highlight])
              return
            }
            if (e.key === 'Escape') {
              e.preventDefault()
              setMenu(null)
              return
            }
          }
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault()
            onSubmit?.()
          }
        }}
      />

      {open && (
        <div className="absolute bottom-full left-0 z-50 mb-1 max-h-56 w-64 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
          {menu!.items.map((m, idx) => (
            <button
              key={m.id}
              type="button"
              // onMouseDown (nao onClick) p/ nao tirar o foco do textarea antes do accept.
              onMouseDown={(e) => {
                e.preventDefault()
                accept(m)
              }}
              onMouseEnter={() => setHighlight(idx)}
              className={cn(
                'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors',
                idx === highlight ? 'bg-accent text-accent-foreground' : 'hover:bg-accent',
              )}
            >
              <Avatar className="size-5 shrink-0">
                <AvatarFallback className="text-[9px]">{initials(m.label)}</AvatarFallback>
              </Avatar>
              <span className="truncate">{m.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
