'use client'

import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'

// Realtime do dashboard de leads (S4) — OPT-IN, desligado por padrão. Assina as gravações do
// Make em public.leads e dispara um refetch (debounced) para a tela se atualizar sem F5.
//
// Fica INERTE até o dono habilitar em DOIS lugares (nenhum é feito automaticamente aqui):
//   1. Ambiente: NEXT_PUBLIC_LEADS_REALTIME=1 (senão o hook nem abre socket — zero custo).
//   2. Banco: incluir a tabela na publicação do Realtime, uma vez, no SQL Editor:
//        ALTER PUBLICATION supabase_realtime ADD TABLE public.leads;
//      (sem isso, o socket conecta mas nunca recebe evento — não quebra nada, só não atualiza).
//
// O RLS vale para o Realtime também: o agente só recebe o próprio lead, supervisor+ recebe
// tudo — não vaza dado. Como é client-side, não passa pelo worker (não gasta egress do SSR).
export const LEADS_REALTIME_ENABLED =
  process.env.NEXT_PUBLIC_LEADS_REALTIME === '1' ||
  process.env.NEXT_PUBLIC_LEADS_REALTIME === 'true'

export function useLeadsRealtime(onChange: () => void, enabled: boolean = LEADS_REALTIME_ENABLED) {
  // Guarda a callback num ref para sempre chamar a versão atual (o período/estado muda entre
  // renders, mas a subscription é criada uma vez).
  const cb = useRef(onChange)
  cb.current = onChange

  useEffect(() => {
    if (!enabled) return
    const supabase = createClient()
    let timer: ReturnType<typeof setTimeout> | null = null

    // Debounce: o Make grava a rajada de cards do Iterator em sequência; junta tudo num
    // único refetch em vez de um por linha.
    const fire = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => cb.current(), 1500)
    }

    const channel = supabase
      .channel('leads-dashboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, fire)
      .subscribe()

    return () => {
      if (timer) clearTimeout(timer)
      supabase.removeChannel(channel)
    }
  }, [enabled])
}
