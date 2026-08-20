'use server'

import { createServerClient } from '@/lib/supabase/server'
import type {
  InvAparelho,
  InvAparelhoInput,
  InvChip,
  InvChipInput,
  InvChipTipo,
  InvInventarioData,
  InvPessoa,
  InvPessoaInput,
  InvStatus,
} from '@/lib/types/database'

// Server actions da Central de Aparelhos (inventário de TI, rota /aparelhos).
// App-native/CRUD no molde das Minutas Processuais: o app lê e escreve com a RLS
// aplicada (createServerClient → auth.uid()), sem service_role em lugar nenhum.
// Quem decide o alcance é o banco — inv_can_read() / inv_can_write(), migration
// 20260820_inventario_aparelhos.sql.
//
// O volume é o parque de celulares de uma empresa (dezenas, não milhares), então
// getInventario lê as três tabelas inteiras e monta a árvore aqui, sem RPC de
// agregação. Degrada pra vazio se a migration ainda não foi aplicada.

const EMPTY: InvInventarioData = {
  referenceAt: new Date().toISOString(),
  pessoas: [],
  aparelhos: [],
  chips: [],
  profiles: [],
}

type PessoaRow = {
  id: string
  nome: string
  departamento: string | null
  profile_id: string | null
  observacoes: string | null
  created_at: string
}

type AparelhoRow = {
  id: string
  modelo: string
  imei: string | null
  pessoa_id: string | null
  status: string
  observacoes: string | null
  created_at: string
}

type ChipRow = {
  id: string
  numero: string
  operadora: string | null
  tipo: string
  aparelho_id: string | null
  slot: number | null
  observacoes: string | null
  created_at: string
}

function toChip(r: ChipRow): InvChip {
  return {
    id: r.id,
    numero: r.numero,
    operadora: r.operadora,
    tipo: (r.tipo === 'pos' ? 'pos' : 'pre') as InvChipTipo,
    aparelhoId: r.aparelho_id,
    slot: r.slot === 1 || r.slot === 2 ? r.slot : null,
    observacoes: r.observacoes,
    createdAt: r.created_at,
  }
}

export async function getInventario(): Promise<InvInventarioData> {
  const supabase = await createServerClient()
  const referenceAt = new Date().toISOString()

  // A lista de perfis é para o vínculo OPCIONAL da pessoa com um usuário do Blue
  // Desk. Vai junto na mesma onda; se a RLS de `profiles` recortar (supervisor só
  // vê o próprio departamento), o select simplesmente oferece menos opções — e
  // supervisor não escreve mesmo.
  const [pessoasRes, aparelhosRes, chipsRes, profilesRes] = await Promise.all([
    supabase.from('inv_pessoas').select('*').order('nome'),
    supabase.from('inv_aparelhos').select('*').order('modelo'),
    supabase.from('inv_chips').select('*').order('numero'),
    supabase.from('profiles').select('id, name').order('name'),
  ])

  // Degrada pra vazio (migration não aplicada, sem acesso, ou sem dado) — a tela
  // mostra o estado "inventário vazio". Loga o motivo real, que não aparece em
  // teste automatizado.
  if (pessoasRes.error || aparelhosRes.error || chipsRes.error) {
    console.error(
      '[inventario] getInventario falhou:',
      pessoasRes.error?.message ?? aparelhosRes.error?.message ?? chipsRes.error?.message,
    )
    return EMPTY
  }

  const profileNomeById = new Map<string, string>()
  for (const p of (profilesRes.data ?? []) as { id: string; name: string }[]) {
    profileNomeById.set(p.id, p.name)
  }

  const pessoas: InvPessoa[] = ((pessoasRes.data ?? []) as PessoaRow[]).map((r) => ({
    id: r.id,
    nome: r.nome,
    departamento: r.departamento,
    profileId: r.profile_id,
    profileNome: r.profile_id ? (profileNomeById.get(r.profile_id) ?? null) : null,
    observacoes: r.observacoes,
    createdAt: r.created_at,
  }))

  const chips: InvChip[] = ((chipsRes.data ?? []) as ChipRow[]).map(toChip)

  // Chips por aparelho, ordenados por slot: é o slot que dá sentido estável às
  // colunas "Chip 1"/"Chip 2" da Visão Geral.
  const chipsByAparelho = new Map<string, InvChip[]>()
  for (const c of chips) {
    if (!c.aparelhoId) continue
    const list = chipsByAparelho.get(c.aparelhoId)
    if (list) list.push(c)
    else chipsByAparelho.set(c.aparelhoId, [c])
  }
  for (const list of chipsByAparelho.values()) {
    list.sort((a, b) => (a.slot ?? 9) - (b.slot ?? 9))
  }

  const aparelhos: InvAparelho[] = ((aparelhosRes.data ?? []) as AparelhoRow[]).map((r) => ({
    id: r.id,
    modelo: r.modelo,
    imei: r.imei,
    pessoaId: r.pessoa_id,
    status: (['em_uso', 'estoque', 'manutencao'].includes(r.status) ? r.status : 'estoque') as InvStatus,
    observacoes: r.observacoes,
    createdAt: r.created_at,
    chips: chipsByAparelho.get(r.id) ?? [],
  }))

  const profiles = ((profilesRes.data ?? []) as { id: string; name: string }[]).map((p) => ({
    id: p.id,
    nome: p.name,
  }))

  return { referenceAt, pessoas, aparelhos, chips, profiles }
}

// `ok` responde "a operação principal foi gravada?". `aviso` existe para o único
// caso em que a resposta é sim mas algo ficou pela metade: o chip foi cadastrado e
// o vínculo com o aparelho não passou (ver createChip). Sem esse campo a tela teria
// que escolher entre mentir ("salvo!") e travar num erro sobre um chip que JÁ existe.
export type InvActionResult = { ok: boolean; error?: string; aviso?: string }

// Traduz o erro cru do Postgres para o que o usuário precisa fazer a respeito. As
// constraints desta área são todas regras de negócio (IMEI único, número único,
// 2 chips por aparelho) — devolver "duplicate key value violates unique
// constraint ux_inv_chips_numero" seria jogar o problema de volta pra quem só
// queria cadastrar um chip.
function traduzErro(msg: string): string {
  if (msg.includes('ux_inv_aparelhos_imei')) return 'Já existe um aparelho cadastrado com este IMEI.'
  if (msg.includes('ux_inv_chips_numero')) return 'Já existe um chip cadastrado com este número.'
  if (msg.includes('ux_inv_pessoas_profile')) return 'Este usuário do Blue Desk já está vinculado a outra pessoa.'
  if (msg.includes('inv_chips_slot_unico') || msg.includes('2 chips')) {
    return 'Este aparelho já tem 2 chips vinculados. Desvincule um antes.'
  }
  if (msg.includes('row-level security')) {
    return 'Seu perfil não tem permissão para alterar o inventário.'
  }
  return msg
}

function falha(escopo: string, msg: string): InvActionResult {
  console.error(`[inventario] ${escopo} falhou:`, msg)
  return { ok: false, error: traduzErro(msg) }
}

const limpo = (s: string): string | null => {
  const t = s.trim()
  return t === '' ? null : t
}

// ── Pessoas ──────────────────────────────────────────────────────────────────

export async function createPessoa(input: InvPessoaInput): Promise<InvActionResult> {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { error } = await supabase.from('inv_pessoas').insert({
    nome: input.nome.trim(),
    departamento: limpo(input.departamento),
    profile_id: input.profileId,
    observacoes: limpo(input.observacoes),
    created_by: user?.id ?? null,
  })
  if (error) return falha('createPessoa', error.message)
  return { ok: true }
}

export async function updatePessoa(id: string, input: InvPessoaInput): Promise<InvActionResult> {
  const supabase = await createServerClient()
  const { error } = await supabase
    .from('inv_pessoas')
    .update({
      nome: input.nome.trim(),
      departamento: limpo(input.departamento),
      profile_id: input.profileId,
      observacoes: limpo(input.observacoes),
    })
    .eq('id', id)
  if (error) return falha('updatePessoa', error.message)
  return { ok: true }
}

// Os aparelhos da pessoa NÃO são apagados junto: a FK é `on delete set null`, então
// eles voltam a ficar sem responsável (que é a verdade — o aparelho continua
// existindo). Quem sai da empresa some da lista, o celular não.
export async function deletePessoa(id: string): Promise<InvActionResult> {
  const supabase = await createServerClient()
  const { error } = await supabase.from('inv_pessoas').delete().eq('id', id)
  if (error) return falha('deletePessoa', error.message)
  return { ok: true }
}

// ── Aparelhos ────────────────────────────────────────────────────────────────

export async function createAparelho(input: InvAparelhoInput): Promise<InvActionResult> {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { error } = await supabase.from('inv_aparelhos').insert({
    modelo: input.modelo.trim(),
    imei: limpo(input.imei),
    pessoa_id: input.pessoaId,
    status: input.status,
    observacoes: limpo(input.observacoes),
    created_by: user?.id ?? null,
  })
  if (error) return falha('createAparelho', error.message)
  return { ok: true }
}

export async function updateAparelho(id: string, input: InvAparelhoInput): Promise<InvActionResult> {
  const supabase = await createServerClient()
  const { error } = await supabase
    .from('inv_aparelhos')
    .update({
      modelo: input.modelo.trim(),
      imei: limpo(input.imei),
      pessoa_id: input.pessoaId,
      status: input.status,
      observacoes: limpo(input.observacoes),
    })
    .eq('id', id)
  if (error) return falha('updateAparelho', error.message)
  return { ok: true }
}

// Patch de uma coluna só, para os selects em linha da tabela (trocar responsável
// ou status sem abrir o formulário). Só o campo presente é gravado.
export type AparelhoPatch = { pessoaId?: string | null; status?: InvStatus }

export async function patchAparelho(id: string, patch: AparelhoPatch): Promise<InvActionResult> {
  const supabase = await createServerClient()
  const row: Record<string, unknown> = {}
  if ('pessoaId' in patch) row.pessoa_id = patch.pessoaId
  if ('status' in patch) row.status = patch.status
  if (Object.keys(row).length === 0) return { ok: true }

  const { error } = await supabase.from('inv_aparelhos').update(row).eq('id', id)
  if (error) return falha('patchAparelho', error.message)
  return { ok: true }
}

// O trigger trg_inv_aparelhos_soltar_chips solta os chips antes de excluir — eles
// continuam cadastrados, apenas sem aparelho.
export async function deleteAparelho(id: string): Promise<InvActionResult> {
  const supabase = await createServerClient()
  const { error } = await supabase.from('inv_aparelhos').delete().eq('id', id)
  if (error) return falha('deleteAparelho', error.message)
  return { ok: true }
}

// ── Chips ────────────────────────────────────────────────────────────────────

// O vínculo com o aparelho NÃO entra no insert: quem escolhe o slot livre (1 ou 2)
// é a RPC inv_assign_chip, e ela é a única que sabe recusar o terceiro chip. Então
// são dois passos — cria solto, vincula em seguida.
//
// Se o 2º passo falhar (alguém encheu o aparelho no meio do caminho), o chip JÁ
// existe: apagá-lo pra "desfazer" jogaria fora um cadastro correto por causa de um
// vínculo, e devolver ok:false faria a tela pedir pra salvar de novo um chip que já
// está lá — e a segunda tentativa esbarraria no número duplicado. Por isso volta
// ok:true com `aviso`: o chip ficou avulso e a tela diz exatamente isso.
export async function createChip(input: InvChipInput): Promise<InvActionResult> {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data, error } = await supabase
    .from('inv_chips')
    .insert({
      numero: input.numero.trim(),
      operadora: limpo(input.operadora),
      tipo: input.tipo,
      observacoes: limpo(input.observacoes),
      created_by: user?.id ?? null,
    })
    .select('id')
    .single()

  if (error) return falha('createChip', error.message)

  if (input.aparelhoId && data?.id) {
    const vinculo = await assignChip(data.id, input.aparelhoId)
    if (!vinculo.ok) {
      return {
        ok: true,
        aviso: `O chip foi cadastrado, mas não pôde ser vinculado ao aparelho: ${vinculo.error} Ele está na lista como avulso.`,
      }
    }
  }
  return { ok: true }
}

export async function updateChip(id: string, input: InvChipInput): Promise<InvActionResult> {
  const supabase = await createServerClient()
  const { error } = await supabase
    .from('inv_chips')
    .update({
      numero: input.numero.trim(),
      operadora: limpo(input.operadora),
      tipo: input.tipo,
      observacoes: limpo(input.observacoes),
    })
    .eq('id', id)
  if (error) return falha('updateChip', error.message)

  // O vínculo é sempre pela RPC, mesmo na edição — ver o comentário em createChip.
  return assignChip(id, input.aparelhoId)
}

// Vincula (ou desvincula, com aparelhoId null). Passa pela RPC porque o slot livre
// tem que ser escolhido dentro da transação: dois usuários vinculando ao mesmo
// aparelho ao mesmo tempo escolheriam o slot 1 os dois se a conta fosse aqui.
export async function assignChip(chipId: string, aparelhoId: string | null): Promise<InvActionResult> {
  const supabase = await createServerClient()
  const { error } = await supabase.rpc('inv_assign_chip', {
    p_chip_id: chipId,
    p_aparelho_id: aparelhoId,
  })
  if (error) return falha('assignChip', error.message)
  return { ok: true }
}

export async function deleteChip(id: string): Promise<InvActionResult> {
  const supabase = await createServerClient()
  const { error } = await supabase.from('inv_chips').delete().eq('id', id)
  if (error) return falha('deleteChip', error.message)
  return { ok: true }
}
