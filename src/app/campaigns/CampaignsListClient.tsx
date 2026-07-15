'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2, Archive, ArchiveRestore, Megaphone } from 'lucide-react'
import { AppShell } from '@/components/blueline/AppShell'
import { PageHeader } from '@/components/blueline/PageHeader'
import { StatusBadge, type CallStatus } from '@/components/blueline/StatusBadge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import {
  createCampaign,
  deleteCampaign,
  getCampaigns,
  archiveCampaign,
  unarchiveCampaign,
} from '@/app/actions/campaigns'
import type { Campaign } from '@/lib/types/database'

type View = 'active' | 'archived'

const STATUS_BADGE: Record<string, { status: CallStatus; label: string }> = {
  draft: { status: 'offline', label: 'Rascunho' },
  active: { status: 'available', label: 'Ativa' },
  paused: { status: 'paused', label: 'Pausada' },
  completed: { status: 'in-call', label: 'Concluída' },
}

interface Props {
  initialCampaigns: Campaign[]
}

export function CampaignsListClient({ initialCampaigns }: Props) {
  const router = useRouter()
  const [view, setView] = useState<View>('active')
  const [campaigns, setCampaigns] = useState<Campaign[]>(initialCampaigns)
  const [loadingList, setLoadingList] = useState(false)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  // Campanha aguardando confirmação de exclusão (mostra confirmar/cancelar na linha)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [archivingId, setArchivingId] = useState<string | null>(null)

  const handleSwitchView = async (next: View) => {
    if (next === view) return
    setView(next)
    setLoadingList(true)
    setCampaigns(await getCampaigns(next === 'archived'))
    setLoadingList(false)
  }

  const handleArchive = async (id: string, archive: boolean) => {
    setArchivingId(id)
    setError('')
    const result = archive ? await archiveCampaign(id) : await unarchiveCampaign(id)
    setArchivingId(null)
    if (result.error) {
      setError(result.error)
      return
    }
    // Some da lista atual (arquivar tira da view "Ativas", desarquivar tira de "Arquivadas")
    setCampaigns((prev) => prev.filter((c) => c.id !== id))
  }

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

  const handleDelete = async (id: string) => {
    setDeletingId(id)
    setError('')
    const result = await deleteCampaign(id)
    setDeletingId(null)
    setConfirmingId(null)
    if (result.error) {
      setError(result.error)
      return
    }
    setCampaigns((prev) => prev.filter((c) => c.id !== id))
  }

  return (
    <AppShell>
      <PageHeader
        title="Campanhas"
        description="Crie uma campanha, configure-a, suba as listas e coloque para rodar."
      />

      <div className="mx-auto max-w-3xl space-y-6">
        {/* Criar campanha */}
        <div className="rounded-2xl border border-border bg-gradient-card p-5 shadow-card">
          <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Nova campanha
          </label>
          <div className="mt-2 flex gap-2">
            <Input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              placeholder="Ex: Inadimplentes Junho"
              className="flex-1"
            />
            <Button
              onClick={handleCreate}
              disabled={creating || !newName.trim()}
              className="bg-primary hover:bg-primary/90"
            >
              <Plus className="mr-2 h-4 w-4" />
              {creating ? '...' : 'Criar'}
            </Button>
          </div>
          {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
        </div>

        {/* Toggle Ativas/Arquivadas */}
        <div className="flex gap-1 rounded-xl border border-border bg-card p-1 text-sm">
          {(['active', 'archived'] as View[]).map((v) => (
            <button
              key={v}
              onClick={() => handleSwitchView(v)}
              disabled={loadingList}
              className={cn(
                'flex-1 rounded-lg px-3 py-1.5 font-medium transition-colors disabled:opacity-50',
                view === v
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent/40'
              )}
            >
              {v === 'active' ? 'Ativas' : 'Arquivadas'}
            </button>
          ))}
        </div>

        {/* Lista */}
        {campaigns.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-gradient-card py-14 shadow-card">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <Megaphone className="h-6 w-6" />
            </div>
            <p className="text-sm font-medium text-foreground">
              {view === 'active' ? 'Nenhuma campanha criada' : 'Nenhuma campanha arquivada'}
            </p>
            <p className="max-w-xs text-center text-xs text-muted-foreground">
              {view === 'active'
                ? 'Crie a primeira campanha acima para começar a configurar.'
                : 'Campanhas arquivadas aparecem aqui e podem ser restauradas a qualquer momento.'}
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
            <table className="w-full text-sm">
              <thead className="bg-background/40 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 text-left font-medium">Campanha</th>
                  <th className="px-5 py-3 text-left font-medium">Status</th>
                  <th className="px-5 py-3 text-right font-medium">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {campaigns.map((c) => {
                  const badge = STATUS_BADGE[c.status] ?? { status: 'offline' as CallStatus, label: c.status }
                  return (
                    <tr key={c.id} className="transition-colors hover:bg-accent/40">
                      <td className="px-5 py-4">
                        <button
                          onClick={() => router.push(`/campaigns/${c.id}`)}
                          className="font-medium text-foreground transition-colors hover:text-primary"
                        >
                          {c.name}
                        </button>
                      </td>
                      <td className="px-5 py-4">
                        <StatusBadge status={badge.status} label={badge.label} />
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center justify-end gap-2">
                          {confirmingId === c.id ? (
                            <>
                              <span className="text-xs text-muted-foreground">Excluir tudo?</span>
                              <Button
                                size="sm"
                                onClick={() => handleDelete(c.id)}
                                disabled={deletingId === c.id}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                {deletingId === c.id ? 'Excluindo...' : 'Excluir'}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setConfirmingId(null)}
                                disabled={deletingId === c.id}
                              >
                                Cancelar
                              </Button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={() => handleArchive(c.id, view === 'active')}
                                disabled={archivingId === c.id}
                                title={view === 'active' ? 'Arquivar campanha' : 'Desarquivar campanha'}
                                aria-label={`${view === 'active' ? 'Arquivar' : 'Desarquivar'} campanha ${c.name}`}
                                className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
                              >
                                {view === 'active' ? (
                                  <Archive className="h-4 w-4" />
                                ) : (
                                  <ArchiveRestore className="h-4 w-4" />
                                )}
                              </button>
                              <button
                                onClick={() => setConfirmingId(c.id)}
                                title="Excluir campanha"
                                aria-label={`Excluir campanha ${c.name}`}
                                className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  )
}
