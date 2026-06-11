import { createBrowserClient } from '@supabase/ssr'

// Cliente Supabase para uso no browser ('use client'). Compartilha a sessão via
// cookies com o lado servidor (@supabase/ssr).
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
