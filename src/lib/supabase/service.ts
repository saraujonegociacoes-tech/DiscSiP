import { createClient } from '@supabase/supabase-js'

// Cliente Supabase com a service_role key — IGNORA RLS. Uso restrito a contextos
// de servidor SEM sessão de usuário: o tick do aquecimento e o callback do Make,
// ambos chamados por integrações externas autenticadas por segredo próprio
// (WARMUP_CRON_SECRET / MAKE_CALLBACK_SECRET), não por um usuário logado.
//
// Regra geral: NÃO importe isto em código que responde a uma requisição de
// usuário autenticado — ali use createServerClient() (@/lib/supabase/server),
// que respeita o RLS da sessão.
//
// EXCEÇÃO consciente: a exclusão de usuário em app/actions/admin.ts. Ela precisa
// da Admin API (auth.users não é alcançável pela sessão) e das contagens reais do
// impacto (sob RLS, dado de outra pessoa não apareceria e o aviso mentiria). Ali o
// RLS deixa de ser a trava, então a Server Action verifica o papel do chamador
// (requireAdmin) ANTES de tocar neste cliente. Se for abrir outra exceção, siga
// o mesmo par: checar a permissão explicitamente, e documentar aqui.
export function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}
