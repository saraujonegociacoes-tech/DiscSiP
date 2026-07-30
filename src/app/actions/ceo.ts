'use server'

// Server actions do Painel do CEO — VAZIO no Sprint 0, de propósito. A rota é só esqueleto
// nesta sprint; nenhuma aba busca dado ainda.
//
// Padrão a seguir quando o conteúdo chegar (mesmo de src/app/actions/cs.ts):
//   createServerClient() de '@/lib/supabase/server' → supabase.rpc('get_ceo_*', {...})
//   → devolver já no shape que o componente consome.
//
// Duas particularidades deste domínio, decididas no doc de sprints
// (docs/projetopainelceo-docs/updates/painel-ceo-sprints.md):
//
//  1. AGREGAR NO POSTGRES, não no Worker. Cada RPC devolve 1 linha jsonb com o painel
//     inteiro pronto, em vez de linhas cruas. Isso evita o teto de 1000 linhas do PostgREST
//     e o estouro de CPU do Cloudflare (Error 1102) — ver
//     docs/discadora-docs/fixes/correcao-cpu-cloudflare-1102.md.
//
//  2. GUARDA NO BANCO, não só na rota. As RPCs nascem SECURITY DEFINER com
//       IF public.ceo_current_role() NOT IN ('ceo','admin') THEN RETURN; END IF;
//     (helper criado em supabase/migrations/20260729_ceo_role.sql). É o que permite ao CEO
//     ler as verticais sem espalhar 'ceo' pelo RLS de cada domínio — o middleware é a
//     primeira barreira, não a única.
//
// Primeira action a nascer aqui: getCeoFinanceiro (Sprint 1, entradas do mês).
export {}
