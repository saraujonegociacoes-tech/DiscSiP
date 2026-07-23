import { createClient } from '@supabase/supabase-js'

// Cliente Supabase com a service_role key — IGNORA RLS. Uso restrito a contextos
// de servidor SEM sessão de usuário: o tick do aquecimento e o callback do Make,
// ambos chamados por integrações externas autenticadas por segredo próprio
// (WARMUP_CRON_SECRET / MAKE_CALLBACK_SECRET), não por um usuário logado.
//
// NUNCA importe isto em código que responde a uma requisição de usuário
// autenticado — ali use createServerClient() (@/lib/supabase/server), que
// respeita o RLS da sessão.
export function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}
