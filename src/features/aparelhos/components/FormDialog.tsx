'use client'

import * as React from 'react'
import type { ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

// Casca dos três formulários da Central de Aparelhos (aparelho, chip, pessoa). O
// que muda entre eles são os CAMPOS; o resto — diálogo, cabeçalho, área de erro,
// botões, estado "salvando" — é idêntico nos três, e no MinutaForm que serviu de
// molde. O estado (open/saving/error) fica com o formulário, que é quem sabe
// validar e quando fechar.

export const inputCls =
  'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground shadow-card outline-none focus:border-primary disabled:opacity-50'
export const labelCls = 'mb-1 block text-xs font-medium text-muted-foreground'

/** Rótulo + campo, o par que se repete em todo o formulário. */
export function Campo({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      {children}
    </div>
  )
}

/**
 * Botão primário "Novo …" das barras de controle.
 *
 * ⚠️ PRECISA repassar props e ref. Ele é usado dentro de `<DialogTrigger asChild>`,
 * e o `asChild` do Radix clona ESTE elemento injetando `onClick`, `ref` e os
 * atributos de acessibilidade. Um componente que só aceite `children` engole tudo
 * isso em silêncio: o botão aparece, é clicável, e não acontece nada — o diálogo
 * nunca abre porque o handler não chegou no `<button>` de verdade. Mesmo motivo do
 * `forwardRef` em components/ui/button.tsx.
 */
export const BotaoNovo = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ children, className, ...props }, ref) => (
    <button
      type="button"
      ref={ref}
      {...props}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg bg-gradient-primary px-3.5 py-2 text-sm font-medium text-primary-foreground shadow-glow transition-opacity hover:opacity-90',
        className,
      )}
    >
      {children}
    </button>
  ),
)
BotaoNovo.displayName = 'BotaoNovo'

export function FormDialog({
  open,
  onOpenChange,
  trigger,
  titulo,
  descricao,
  rotuloSalvar,
  salvando,
  erro,
  onSubmit,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  trigger: ReactNode
  titulo: string
  descricao: string
  rotuloSalvar: string
  salvando: boolean
  erro: string | null
  onSubmit: (e: React.FormEvent) => void
  children: ReactNode
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>

      <DialogContent className="max-h-[90vh] overflow-y-auto rounded-2xl border-border bg-gradient-card sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>{descricao}</DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          {children}

          {erro && <p className="text-sm text-destructive">{erro}</p>}

          <DialogFooter className="mt-1 gap-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-lg border border-border bg-background px-3.5 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={salvando}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-primary px-3.5 py-2 text-sm font-medium text-primary-foreground shadow-glow transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {salvando && <Loader2 className="h-4 w-4 animate-spin" />}
              {rotuloSalvar}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
