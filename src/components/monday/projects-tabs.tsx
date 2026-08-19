'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

/**
 * Abas do nivel /projects. Mesmo desenho do ProjectTabs (que vive DENTRO de um
 * projeto); sao componentes separados de proposito — este fica em /projects e
 * /projects/quick, e um layout compartilhado vazaria para /projects/[projectId].
 */
const tabs = [
  { href: '/projects', label: 'Projetos' },
  { href: '/projects/quick', label: 'Tarefas rápidas' },
]

export function ProjectsTabs() {
  const pathname = usePathname()

  return (
    <nav className="flex gap-1 border-b border-border">
      {tabs.map((t) => {
        const active = pathname === t.href
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              'relative rounded-md px-3 py-2 text-sm font-medium transition-colors',
              active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
            {active && (
              <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" />
            )}
          </Link>
        )
      })}
    </nav>
  )
}
