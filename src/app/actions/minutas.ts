'use server'

import { createServerClient } from '@/lib/supabase/server'
import { brtTodayStartUtcISO } from '@/lib/timezone'
import type {
  CreateMinutaInput,
  ProcAcordo,
  ProcMinutasData,
  ProcParcela,
  ProcParcelaStatus,
  Recorrencia,
} from '@/lib/types/database'

// Server actions da área Jurídico / Minutas Processuais (domínio SEPARADO das "Minutas" do
// CS). App-native/CRUD: diferente dos painéis-espelho (CS/Financeiro), aqui o app LÊ E
// ESCREVE com RLS aplicada (createServerClient → auth.uid()). O acesso é escopado no banco
// pela policy proc_can_access() (juridico + gerência) — migration 20260731b_minutas_processuais.sql.
//
// O volume é pequeno (carteira de um time jurídico), então getMinutas lê as duas tabelas
// direto e monta o painel no servidor, sem RPC de agregação. O status da parcela é derivado
// aqui (o corte do dia é BRT). Degrada pra vazio se a migration ainda não foi aplicada.

const EMPTY: ProcMinutasData = { referenceAt: new Date().toISOString(), acordos: [] }

type AcordoRow = {
  id: string
  cliente: string | null
  numero_processo: string | null
  titulo: string | null
  recorrencia: string
  intervalo_dias: number | null
  parcela_total: number | null
  valor_parcela: number | string | null
  primeiro_vencimento: string | null
  observacoes: string | null
  created_at: string
}

type ParcelaRow = {
  id: string
  acordo_id: string
  num: number
  valor: number | string | null
  vencimento: string | null
  data_pagamento: string | null
  observacoes: string | null
}

const num = (v: number | string | null): number | null =>
  v === null || v === '' ? null : Number(v)

// Diferença em dias entre duas datas 'YYYY-MM-DD' (à meia-noite UTC — a hora não importa,
// só a distância em dias). Positivo = `to` está no futuro em relação a `from`.
function daysBetweenYMD(fromYMD: string, toYMD: string): number {
  const [fy, fm, fd] = fromYMD.split('-').map(Number)
  const [ty, tm, td] = toYMD.split('-').map(Number)
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000)
}

function toParcela(r: ParcelaRow, todayYMD: string): ProcParcela {
  const vencimento = r.vencimento ? r.vencimento.slice(0, 10) : null
  const dataPagamento = r.data_pagamento ? r.data_pagamento.slice(0, 10) : null
  const daysToDue = vencimento ? daysBetweenYMD(todayYMD, vencimento) : null
  const status: ProcParcelaStatus = dataPagamento
    ? 'pago'
    : daysToDue !== null && daysToDue < 0
      ? 'vencida'
      : 'pendente'
  return {
    id: r.id,
    acordoId: r.acordo_id,
    num: Number(r.num),
    valor: num(r.valor),
    vencimento,
    dataPagamento,
    observacoes: r.observacoes,
    status,
    daysToDue,
  }
}

export async function getMinutas(): Promise<ProcMinutasData> {
  const supabase = await createServerClient()
  const referenceAt = new Date().toISOString()
  const todayYMD = brtTodayStartUtcISO().slice(0, 10)

  const [acordosRes, parcelasRes] = await Promise.all([
    supabase.from('proc_acordos').select('*').order('created_at', { ascending: false }),
    supabase.from('proc_parcelas').select('*').order('acordo_id').order('num'),
  ])

  // Degrada pra vazio (migration não aplicada, sem acesso, ou sem dado) — a tela mostra o
  // estado "sem minutas". Loga o motivo real, que não aparece em teste automatizado.
  if (acordosRes.error || parcelasRes.error) {
    console.error(
      '[minutas] getMinutas falhou:',
      acordosRes.error?.message ?? parcelasRes.error?.message,
    )
    return EMPTY
  }

  const parcelasByAcordo = new Map<string, ProcParcela[]>()
  for (const r of (parcelasRes.data ?? []) as ParcelaRow[]) {
    const p = toParcela(r, todayYMD)
    const list = parcelasByAcordo.get(p.acordoId)
    if (list) list.push(p)
    else parcelasByAcordo.set(p.acordoId, [p])
  }

  const acordos: ProcAcordo[] = ((acordosRes.data ?? []) as AcordoRow[]).map((r) => ({
    id: r.id,
    cliente: r.cliente,
    numeroProcesso: r.numero_processo,
    titulo: r.titulo,
    recorrencia: r.recorrencia as Recorrencia,
    intervaloDias: r.intervalo_dias,
    parcelaTotal: Number(r.parcela_total ?? 0),
    valorParcela: num(r.valor_parcela),
    primeiroVencimento: r.primeiro_vencimento ? r.primeiro_vencimento.slice(0, 10) : null,
    observacoes: r.observacoes,
    createdAt: r.created_at,
    parcelas: parcelasByAcordo.get(r.id) ?? [],
  }))

  return { referenceAt, acordos }
}

export type MinutaActionResult = { ok: boolean; error?: string }

// Cria o acordo + gera as parcelas via a RPC proc_create_acordo (SECURITY INVOKER — a RLS
// garante que só juridico/gerência escreve). Retorna {ok} pro cliente re-buscar getMinutas.
export async function createMinuta(input: CreateMinutaInput): Promise<MinutaActionResult> {
  const supabase = await createServerClient()
  const { error } = await supabase.rpc('proc_create_acordo', {
    p_cliente: input.cliente,
    p_numero_processo: input.numeroProcesso,
    p_titulo: input.titulo,
    p_recorrencia: input.recorrencia,
    p_intervalo_dias: input.intervaloDias,
    p_num_parcelas: input.numParcelas,
    p_valor_parcela: input.valorParcela,
    p_primeiro_vencimento: input.primeiroVencimento,
    p_observacoes: input.observacoes,
  })
  if (error) {
    console.error('[minutas] createMinuta falhou:', error.message)
    return { ok: false, error: error.message }
  }
  return { ok: true }
}

// Patch de uma parcela: marcar paga/estornar (data_pagamento), corrigir valor/vencimento ou
// observação. Só os campos presentes são gravados.
export type ParcelaPatch = {
  dataPagamento?: string | null
  valor?: number | null
  vencimento?: string | null
  observacoes?: string | null
}

export async function updateParcela(id: string, patch: ParcelaPatch): Promise<MinutaActionResult> {
  const supabase = await createServerClient()
  const row: Record<string, unknown> = {}
  if ('dataPagamento' in patch) row.data_pagamento = patch.dataPagamento
  if ('valor' in patch) row.valor = patch.valor
  if ('vencimento' in patch) row.vencimento = patch.vencimento
  if ('observacoes' in patch) row.observacoes = patch.observacoes
  if (Object.keys(row).length === 0) return { ok: true }

  const { error } = await supabase.from('proc_parcelas').update(row).eq('id', id)
  if (error) {
    console.error('[minutas] updateParcela falhou:', error.message)
    return { ok: false, error: error.message }
  }
  return { ok: true }
}

// Exclui o acordo inteiro (as parcelas caem por ON DELETE CASCADE).
export async function deleteMinuta(acordoId: string): Promise<MinutaActionResult> {
  const supabase = await createServerClient()
  const { error } = await supabase.from('proc_acordos').delete().eq('id', acordoId)
  if (error) {
    console.error('[minutas] deleteMinuta falhou:', error.message)
    return { ok: false, error: error.message }
  }
  return { ok: true }
}
