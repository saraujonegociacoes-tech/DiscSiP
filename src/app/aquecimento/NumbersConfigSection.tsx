'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2, Flame } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { upsertWarmupNumber, deleteWarmupNumber } from '@/app/actions/warmup'
import type { WarmupNumber, WarmupNumberStats, WarmupNumberStatus } from '@/lib/types/database'

const STATUS_LABEL: Record<WarmupNumberStatus, string> = {
  active: 'Ativo',
  paused: 'Pausado',
  blocked: 'Bloqueado',
  cooling: 'Descansando',
}

const STATUS_VARIANT: Record<WarmupNumberStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  active: 'default',
  paused: 'secondary',
  blocked: 'destructive',
  cooling: 'outline',
}

const QUALITY_COLOR: Record<string, string> = {
  GREEN: 'text-success',
  YELLOW: 'text-warning',
  RED: 'text-destructive',
}

interface Props {
  numbers: WarmupNumber[]
  stats: Record<string, WarmupNumberStats>
  maxCap: number
}

export function NumbersConfigSection({ numbers, stats, maxCap }: Props) {
  const router = useRouter()
  const [senderId, setSenderId] = useState('')
  const [phone, setPhone] = useState('')
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const atCap = numbers.length >= maxCap

  const handleAdd = async () => {
    if (!senderId.trim() || !phone.trim()) return
    setSaving(true)
    setError('')
    const result = await upsertWarmupNumber({
      sender_id: senderId.trim(),
      phone_number: phone.trim(),
      display_name: name.trim() || null,
    })
    setSaving(false)
    if (result.error) {
      setError(result.error)
      return
    }
    setSenderId('')
    setPhone('')
    setName('')
    router.refresh()
  }

  const handleToggleParticipating = async (n: WarmupNumber) => {
    await upsertWarmupNumber({
      id: n.id,
      sender_id: n.sender_id,
      phone_number: n.phone_number,
      participating: !n.participating,
    })
    router.refresh()
  }

  const handleDelete = async (id: string) => {
    await deleteWarmupNumber(id)
    setConfirmId(null)
    router.refresh()
  }

  return (
    <div className="space-y-4">
      {/* Adicionar número */}
      <div className="rounded-2xl border border-border bg-gradient-card p-5 shadow-card">
        <div className="flex items-center justify-between">
          <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Adicionar número ao pool
          </label>
          <span className="text-xs text-muted-foreground">
            {numbers.length}/{maxCap}
          </span>
        </div>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
          <Input
            value={senderId}
            onChange={(e) => setSenderId(e.target.value)}
            placeholder="sender_id (phone_number_id)"
            disabled={atCap}
          />
          <Input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Número (E.164, +55...)"
            disabled={atCap}
          />
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Apelido (opcional)"
            disabled={atCap}
          />
          <Button onClick={handleAdd} disabled={saving || atCap || !senderId.trim() || !phone.trim()}>
            <Plus className="mr-2 h-4 w-4" />
            {saving ? '...' : 'Adicionar'}
          </Button>
        </div>
        {atCap && (
          <p className="mt-2 text-xs text-muted-foreground">
            Limite de {maxCap} números atingido. Remova um número para adicionar outro.
          </p>
        )}
        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      </div>

      {/* Lista de números */}
      {numbers.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-gradient-card py-14 shadow-card">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
            <Flame className="h-6 w-6" />
          </div>
          <p className="text-sm font-medium text-foreground">Nenhum número no pool</p>
          <p className="max-w-xs text-center text-xs text-muted-foreground">
            Adicione os números da BM (mesmo System User no Make) para começar o aquecimento.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-card">
          <table className="w-full text-sm">
            <thead className="bg-background/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Número</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-center font-medium">Dias</th>
                <th className="px-4 py-3 text-center font-medium">Hoje</th>
                <th className="px-4 py-3 text-center font-medium">Total</th>
                <th className="px-4 py-3 text-center font-medium">Qualidade</th>
                <th className="px-4 py-3 text-center font-medium">Participa</th>
                <th className="px-4 py-3 text-right font-medium">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {numbers.map((n) => {
                const s = stats[n.id]
                return (
                  <tr key={n.id} className="transition-colors hover:bg-accent/40">
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">{n.display_name || n.phone_number}</div>
                      <div className="text-xs text-muted-foreground">{n.phone_number} · {n.sender_id}</div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={STATUS_VARIANT[n.status]}>{STATUS_LABEL[n.status]}</Badge>
                    </td>
                    <td className="px-4 py-3 text-center tabular-nums">{s?.daysWarming ?? 0}</td>
                    <td className="px-4 py-3 text-center tabular-nums">
                      {s?.sentToday ?? 0}
                      <span className="text-muted-foreground">/{s?.dailyCap ?? 0}</span>
                    </td>
                    <td className="px-4 py-3 text-center tabular-nums">{s?.sentTotal ?? 0}</td>
                    <td className={`px-4 py-3 text-center font-semibold ${n.quality_rating ? QUALITY_COLOR[n.quality_rating] : 'text-muted-foreground'}`}>
                      {n.quality_rating ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-center">
                        <Switch
                          checked={n.participating}
                          onCheckedChange={() => handleToggleParticipating(n)}
                          aria-label={`Participação de ${n.phone_number}`}
                        />
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        {confirmId === n.id ? (
                          <>
                            <span className="text-xs text-muted-foreground">Remover?</span>
                            <Button
                              size="sm"
                              onClick={() => handleDelete(n.id)}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            >
                              Remover
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => setConfirmId(null)}>
                              Cancelar
                            </Button>
                          </>
                        ) : (
                          <button
                            onClick={() => setConfirmId(n.id)}
                            title="Remover número"
                            aria-label={`Remover ${n.phone_number}`}
                            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
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
  )
}
