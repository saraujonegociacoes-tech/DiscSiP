'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, CheckCircle2, ChevronRight } from 'lucide-react'
import { initials, isProjectDone } from '@/lib/monday/domain'
import type { MondayMemberProfile, MondayProjectWithStats } from '@/lib/monday/types'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Switch } from '@/components/ui/switch'

type OwnerGroup = {
  ownerId: string
  owner: MondayMemberProfile | null
  projects: MondayProjectWithStats[]
}

function ownerLabel(owner: MondayMemberProfile | null): string {
  return owner?.name || owner?.email || 'Sem responsável'
}

/** Agrupa os projetos por dono (pessoa), ordenando as pessoas por nome. */
function groupByOwner(projects: MondayProjectWithStats[]): OwnerGroup[] {
  const groups = new Map<string, OwnerGroup>()
  for (const p of projects) {
    const g = groups.get(p.owner_id)
    if (g) g.projects.push(p)
    else groups.set(p.owner_id, { ownerId: p.owner_id, owner: p.owner ?? null, projects: [p] })
  }
  return [...groups.values()].sort((a, b) =>
    ownerLabel(a.owner).localeCompare(ownerLabel(b.owner), 'pt-BR'),
  )
}

/**
 * Lista de projetos agrupada por dono, com filtro "Ocultar concluidos" (mesmo padrao
 * do "Ocultar concluidas" do calendario de entregas). Filtrar e agrupar sao o mesmo
 * useMemo: so refaz quando os projetos mudam ou o switch vira — o custo por render e zero.
 */
export function ProjectsList({ projects }: { projects: MondayProjectWithStats[] }) {
  const [hideDone, setHideDone] = useState(false)

  const doneCount = useMemo(
    () => projects.reduce((n, p) => n + (isProjectDone(p.overview) ? 1 : 0), 0),
    [projects],
  )

  const groups = useMemo(
    () => groupByOwner(hideDone ? projects.filter((p) => !isProjectDone(p.overview)) : projects),
    [projects, hideDone],
  )

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
          <Switch checked={hideDone} onCheckedChange={setHideDone} />
          Ocultar concluídos
          {doneCount > 0 && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
              {doneCount}
            </span>
          )}
        </label>
      </div>

      {groups.length === 0 ? (
        <p className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
          Todos os projetos estão concluídos.
        </p>
      ) : (
        groups.map((group) => (
          <details key={group.ownerId} open className="group">
            <summary className="flex cursor-pointer list-none items-center gap-2.5 rounded-lg px-1 py-2 [&::-webkit-details-marker]:hidden">
              <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
              <Avatar className="size-7">
                <AvatarFallback className="text-[11px]">
                  {initials(group.owner?.name, group.owner?.email)}
                </AvatarFallback>
              </Avatar>
              <span className="font-medium">{ownerLabel(group.owner)}</span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {group.projects.length}
              </span>
            </summary>

            <div className="mt-3 grid gap-4 pl-1 sm:grid-cols-2 lg:grid-cols-3">
              {group.projects.map((p) => (
                <ProjectCard key={p.id} project={p} />
              ))}
            </div>
          </details>
        ))
      )}
    </div>
  )
}

function ProjectCard({ project: p }: { project: MondayProjectWithStats }) {
  const total = p.overview?.total_tasks ?? 0
  const done = p.overview?.done_tasks ?? 0
  const pct = total ? Math.round((done / total) * 100) : 0
  return (
    <Link href={`/projects/${p.id}`}>
      <Card className="h-full transition-colors hover:border-primary/50">
        <CardHeader className="gap-3">
          <div className="flex items-center gap-3">
            <span
              className="grid size-9 shrink-0 place-items-center rounded-lg text-sm font-bold text-white"
              style={{ backgroundColor: p.color }}
            >
              {p.key.slice(0, 2)}
            </span>
            <div className="min-w-0">
              <p className="truncate font-semibold">{p.name}</p>
              <p className="text-xs text-muted-foreground">{p.key}</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Progresso</span>
            <span className="font-medium">{pct}%</span>
          </div>
          <Progress value={pct} />
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <CheckCircle2 className="size-3.5 text-status-done" />
              {done}/{total}
            </span>
            {(p.overview?.stuck_tasks ?? 0) > 0 && (
              <span className="inline-flex items-center gap-1 text-status-stuck">
                <AlertTriangle className="size-3.5" />
                {p.overview?.stuck_tasks} travada(s)
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}
