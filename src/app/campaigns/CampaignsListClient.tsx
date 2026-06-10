'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sidebar } from '@/components/Sidebar'
import { createCampaign } from '@/app/actions/campaigns'
import type { Campaign } from '@/lib/types/database'

const STATUS_LABEL: Record<string, string> = {
  draft: 'Rascunho',
  active: 'Ativa',
  paused: 'Pausada',
  completed: 'Concluída',
}

const STATUS_COLOR: Record<string, string> = {
  draft: 'text-slate-400 bg-slate-700/50',
  active: 'text-green-400 bg-green-900/40',
  paused: 'text-yellow-400 bg-yellow-900/40',
  completed: 'text-blue-400 bg-blue-900/40',
}

interface Props {
  initialCampaigns: Campaign[]
}

export function CampaignsListClient({ initialCampaigns }: Props) {
  const router = useRouter()
  const [campaigns, setCampaigns] = useState<Campaign[]>(initialCampaigns)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  const handleCreate = async () => {
    if (!newName.trim()) return
    setCreating(true)
    setError('')
    const result = await createCampaign(newName.trim())
    setCreating(false)
    if ('error' in result) {
      setError(result.error)
      return
    }
    setCampaigns((prev) => [result, ...prev])
    // Leva direto para a configuração da campanha recém-criada
    router.push(`/campaigns/${result.id}`)
  }

  return (
    <div className="min-h-screen bg-[#0f172a] flex">
      <Sidebar />
      <div className="flex-1 p-6 overflow-y-auto">
        <div className="max-w-2xl mx-auto space-y-5">
          <div>
            <h1 className="text-white text-xl font-semibold">Campanhas</h1>
            <p className="text-slate-500 text-sm mt-1">
              Crie uma campanha, configure-a, suba as listas e coloque para rodar.
            </p>
          </div>

          {/* Criar campanha */}
          <div className="bg-[#1e293b] border border-slate-700/60 rounded-2xl p-4">
            <label className="block text-xs text-slate-400 mb-2 uppercase tracking-wider">
              Nova campanha
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                placeholder="Ex: Inadimplentes Junho"
                className="flex-1 bg-[#111827] border border-slate-600 rounded-xl px-3 py-2.5 text-white placeholder:text-slate-600 focus:outline-none focus:border-blue-500 transition-colors text-sm"
              />
              <button
                onClick={handleCreate}
                disabled={creating || !newName.trim()}
                className="bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 text-white px-5 rounded-xl text-sm font-medium transition-colors"
              >
                {creating ? '...' : 'Criar'}
              </button>
            </div>
            {error && <p className="text-red-400 text-xs mt-2">{error}</p>}
          </div>

          {/* Lista */}
          {campaigns.length === 0 ? (
            <div className="flex flex-col items-center py-12 gap-3">
              <span className="text-4xl opacity-20">▤</span>
              <p className="text-slate-400 text-sm font-medium">Nenhuma campanha criada</p>
              <p className="text-slate-600 text-xs text-center max-w-xs">
                Crie a primeira campanha acima para começar a configurar.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {campaigns.map((c) => (
                <button
                  key={c.id}
                  onClick={() => router.push(`/campaigns/${c.id}`)}
                  className="w-full flex items-center justify-between bg-[#1e293b] border border-slate-800 hover:border-slate-600 rounded-xl px-4 py-3.5 transition-colors text-left group"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-white text-sm font-medium">{c.name}</span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[c.status] ?? ''}`}
                    >
                      {STATUS_LABEL[c.status] ?? c.status}
                    </span>
                  </div>
                  <span className="text-slate-600 group-hover:text-slate-400 text-sm transition-colors">
                    Configurar ›
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
