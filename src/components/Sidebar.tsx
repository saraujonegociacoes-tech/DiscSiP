'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSoftphoneStore } from '@/store/softphoneStore'

const NAV_ITEMS = [
  { href: '/softphone', label: 'Dialer', icon: '☎' },
  { href: '/dashboard', label: 'Dashboard', icon: '◈' },
  { href: '/campaigns', label: 'Campanhas', icon: '▤' },
]

export function Sidebar() {
  const pathname = usePathname()
  const { agentName, extension, helperOnline } = useSoftphoneStore()

  const helperDot = helperOnline ? 'bg-green-400' : 'bg-slate-500'

  return (
    <aside className="w-52 shrink-0 bg-[#111827] border-r border-slate-800 min-h-screen flex flex-col">
      <div className="px-5 py-5 border-b border-slate-800">
        <span className="text-lg text-white">
          <span className="font-medium">Disc</span><span className="font-bold text-blue-500">SiP</span>
        </span>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV_ITEMS.map((item) => {
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
          <p className="text-slate-500 text-xs pl-4">Ramal {extension}</p>
        </div>
      )}
    </aside>
  )
}
