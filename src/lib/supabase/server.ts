import { createServerClient as createSSRClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// Cliente Supabase para uso server-side (Server Actions / Server Components).
// Usa @supabase/ssr com cookies para que a sessão de auth (auth.uid()) seja
// visível ao Postgres/RLS. É async porque cookies() é assíncrono no Next 15.
export async function createServerClient() {
  const cookieStore = await cookies()

  return createSSRClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          // Em Server Components a escrita de cookie não é permitida e lança;
          // o refresh real da sessão acontece no middleware, então ignoramos.
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // no-op fora de Server Action / Route Handler
          }
        },
      },
    }
  )
}
