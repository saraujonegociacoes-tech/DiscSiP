'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2, FileText, MessageSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { upsertWarmupTemplate, deleteWarmupTemplate } from '@/app/actions/warmup'
import type { WarmupTemplate, WarmupTemplateKind } from '@/lib/types/database'

interface Props {
  templates: WarmupTemplate[]
}

export function TemplatesSection({ templates }: Props) {
  const router = useRouter()
  const [kind, setKind] = useState<WarmupTemplateKind>('session_snippet')
  const [body, setBody] = useState('')
  const [metaName, setMetaName] = useState('')
  const [metaLang, setMetaLang] = useState('pt_BR')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const openers = templates.filter((t) => t.kind === 'template')
  const snippets = templates.filter((t) => t.kind === 'session_snippet')

  const handleAdd = async () => {
    if (!body.trim()) return
    setSaving(true)
    setError('')
    const result = await upsertWarmupTemplate({
      kind,
      body: body.trim(),
      meta_template_name: kind === 'template' ? metaName.trim() : undefined,
      meta_template_language: kind === 'template' ? metaLang.trim() : undefined,
    })
    setSaving(false)
    if (result.error) {
      setError(result.error)
      return
    }
    setBody('')
    setMetaName('')
    router.refresh()
  }

  const handleToggleActive = async (t: WarmupTemplate) => {
    await upsertWarmupTemplate({ id: t.id, kind: t.kind, body: t.body, active: !t.active, meta_template_name: t.meta_template_name ?? undefined, meta_template_language: t.meta_template_language ?? undefined })
    router.refresh()
  }

  const handleDelete = async (id: string) => {
    await deleteWarmupTemplate(id)
    setConfirmId(null)
    router.refresh()
  }

  const renderList = (list: WarmupTemplate[], emptyLabel: string) =>
    list.length === 0 ? (
      <p className="px-4 py-6 text-center text-xs text-muted-foreground">{emptyLabel}</p>
    ) : (
      <ul className="divide-y divide-border">
        {list.map((t) => (
          <li key={t.id} className="flex items-start justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              {t.kind === 'template' && (
                <div className="mb-0.5 text-xs text-muted-foreground">
                  {t.meta_template_name} · {t.meta_template_language}
                </div>
              )}
              <p className="text-sm text-foreground">{t.body}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {!t.active && <Badge variant="secondary">Inativo</Badge>}
              <Switch checked={t.active} onCheckedChange={() => handleToggleActive(t)} aria-label="Ativo" />
              {confirmId === t.id ? (
                <>
                  <Button
                    size="sm"
                    onClick={() => handleDelete(t.id)}
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
                  onClick={() => setConfirmId(t.id)}
                  title="Remover"
                  className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    )

  return (
    <div className="space-y-4">
      {/* Adicionar template/snippet */}
      <div className="rounded-2xl border border-border bg-gradient-card p-5 shadow-card">
        <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Adicionar mensagem
        </label>

        <div className="mt-2 flex gap-1 rounded-xl border border-border bg-card p-1 text-sm">
          {(['session_snippet', 'template'] as WarmupTemplateKind[]).map((k) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={
                'flex-1 rounded-lg px-3 py-1.5 font-medium transition-colors ' +
                (kind === k ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent/40')
              }
            >
              {k === 'session_snippet' ? 'Frase de sessão (livre)' : 'Template de abertura (Meta)'}
            </button>
          ))}
        </div>

        {kind === 'template' && (
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Input
              value={metaName}
              onChange={(e) => setMetaName(e.target.value)}
              placeholder="Nome do template aprovado na Meta"
            />
            <Input value={metaLang} onChange={(e) => setMetaLang(e.target.value)} placeholder="Idioma (ex: pt_BR)" />
          </div>
        )}

        <div className="mt-2 flex gap-2">
          <Input
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            placeholder={kind === 'template' ? 'Preview do texto do template' : 'Ex: Oi, tudo bem por aí?'}
            className="flex-1"
          />
          <Button onClick={handleAdd} disabled={saving || !body.trim()}>
            <Plus className="mr-2 h-4 w-4" />
            {saving ? '...' : 'Adicionar'}
          </Button>
        </div>
        {kind === 'template' && (
          <p className="mt-2 text-xs text-muted-foreground">
            Só o template abre uma conversa fria (janela de 24h). As respostas seguintes usam as frases de sessão.
          </p>
        )}
        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
          <div className="flex items-center gap-2 border-b border-border bg-background/40 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <FileText className="h-4 w-4" /> Templates de abertura
          </div>
          {renderList(openers, 'Nenhum template cadastrado. Sem template, novas conversas não abrem.')}
        </div>
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
          <div className="flex items-center gap-2 border-b border-border bg-background/40 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <MessageSquare className="h-4 w-4" /> Frases de sessão
          </div>
          {renderList(snippets, 'Nenhuma frase cadastrada. Adicione várias para variar as conversas.')}
        </div>
      </div>
    </div>
  )
}
