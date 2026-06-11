'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSoftphoneStore } from '@/store/softphoneStore'
import { getCurrentProfile } from '@/app/actions/auth'
import type { Role } from '@/lib/types/database'

const NAV_ITEMS: { href: string; label: string; icon: string; roles: Role[] }[] = [
  { href: '/softphone', label: 'Dialer', icon: '☎', roles: ['agent', 'supervisor', 'manager', 'admin'] },
  { href: '/dashboard', label: 'Dashboard', icon: '◈', roles: ['supervisor', 'manager', 'admin'] },
  { href: '/campaigns', label: 'Campanhas', icon: '▤', roles: ['supervisor', 'manager', 'admin'] },
  { href: '/admin', label: 'Admin', icon: '⚙', roles: ['admin'] },
]

const ROLE_LABEL: Record<string, string> = {
  agent: 'Agente',
  supervisor: 'Supervisor',
  manager: 'Gerente',
  admin: 'Admin',
}

export function Sidebar() {
  const pathname = usePathname()
  const { agentId, agentName, extension, role, helperOnline, setProfile } = useSoftphoneStore()

  // Hidrata o perfil da sessão se ainda não estiver no store (páginas que não são
  // o softphone montam a Sidebar sem o perfil carregado)
  useEffect(() => {
    if (agentId) return
    getCurrentProfile().then((p) => {
      if (p) setProfile(p)
    })
  }, [agentId, setProfile])

  // Enquanto o papel não carregou, mostra o mínimo (Dialer) pra não piscar links proibidos
  const navItems = NAV_ITEMS.filter((item) => item.roles.includes(role ?? 'agent'))

  const helperDot = helperOnline ? 'bg-green-400' : 'bg-slate-500'

  return (
    <aside className="w-52 shrink-0 bg-[#111827] border-r border-slate-800 min-h-screen flex flex-col">
      <div className="px-5 py-5 border-b border-slate-800">
        <span className="text-lg text-white">
          <span className="font-medium">Disc</span><span className="font-bold text-blue-500">SiP</span>
        </span>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors ${
                active
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <span className="text-base">{item.icon}</span>
              {item.label}
            </Link>
          )
        })}
      </nav>

      {agentName && (
        <div className="px-5 py-4 border-t border-slate-800">
          <div className="flex items-center gap-2 mb-0.5">
            <span className={`w-2 h-2 rounded-full shrink-0 ${helperDot}`} />
            <span className="text-white text-sm font-medium truncate">{agentName}</span>
          </div>
          <p className="text-slate-500 text-xs pl-4">
            {(role && ROLE_LABEL[role]) ?? ''}
            {extension ? `${role && ROLE_LABEL[role] ? ' · ' : ''}Ramal ${extension}` : ''}
          </p>
        </div>
      )}
    </aside>
  )
}
