'use client'

import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { createPessoa, updatePessoa } from '@/app/actions/inventario'
import type { InvPessoa, InvPessoaInput } from '@/lib/types/database'
import { BotaoNovo, Campo, FormDialog, inputCls } from './FormDialog'
import { BotaoEditar } from './tableKit'

// Cadastro e edição de pessoa (mesmo componente, como nos outros dois formulários).
//
// A lista de PESSOAS é própria do inventário, não é `profiles`: quem tem celular da
// empresa nem sempre é usuário do Blue Desk. O select "Usuário do Blue Desk" é o
// vínculo OPCIONAL para quando for — dá pra chegar no perfil sem duplicar a
// identidade. Perfis já vinculados a outra pessoa aparecem desabilitados (o banco
// tem uma unique em profile_id).

export function PessoaForm({
  pessoa,
  pessoas,
  profiles,
  onSalvo,
}: {
  pessoa?: InvPessoa
  pessoas: InvPessoa[]
  profiles: { id: string; nome: string }[]
  onSalvo: () => void
}) {
  const editando = pessoa != null

  const [open, setOpen] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const [nome, setNome] = useState(pessoa?.nome ?? '')
  const [departamento, setDepartamento] = useState(pessoa?.departamento ?? '')
  const [profileId, setProfileId] = useState(pessoa?.profileId ?? '')
  const [observacoes, setObservacoes] = useState(pessoa?.observacoes ?? '')

  // Perfis já tomados por OUTRA pessoa (o da própria pessoa editada continua livre).
  const tomados = useMemo(() => {
    const s = new Set<string>()
    for (const p of pessoas) {
      if (p.profileId && p.id !== pessoa?.id) s.add(p.profileId)
    }
    return s
  }, [pessoas, pessoa?.id])

  function reset() {
    setNome(pessoa?.nome ?? '')
    setDepartamento(pessoa?.departamento ?? '')
    setProfileId(pessoa?.profileId ?? '')
    setObservacoes(pessoa?.observacoes ?? '')
    setErro(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErro(null)
    if (!nome.trim()) {
      setErro('Informe o nome da pessoa.')
      return
    }

    const input: InvPessoaInput = {
      nome,
      departamento,
      profileId: profileId || null,
      observacoes,
    }

    setSalvando(true)
    const res = editando ? await updatePessoa(pessoa.id, input) : await createPessoa(input)
    setSalvando(false)

    if (!res.ok) {
      setErro(res.error ?? 'Não foi possível salvar. Tente novamente.')
      return
    }
    setOpen(false)
    if (!editando) reset()
    onSalvo()
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        // Reseta na ABERTURA também, não só ao fechar: em modo edição os campos são
        // semeados por props, e sem isto o diálogo reabriria com o estado antigo
        // depois que um refresh trouxe dados novos (classe de bug do commit 6b57aff).
        reset()
      }}
      trigger={
        editando ? (
          <BotaoEditar titulo="Editar pessoa" />
        ) : (
          <BotaoNovo>
            <Plus className="h-4 w-4" />
            Nova pessoa
          </BotaoNovo>
        )
      }
      titulo={editando ? 'Editar pessoa' : 'Nova pessoa'}
      descricao="Quem pode ficar responsável por um aparelho. Não precisa ser usuário do Blue Desk."
      rotuloSalvar={editando ? 'Salvar alterações' : 'Cadastrar pessoa'}
      salvando={salvando}
      erro={erro}
      onSubmit={handleSubmit}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Campo label="Nome">
          <input
            className={inputCls}
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Nome completo"
            autoFocus
          />
        </Campo>
        <Campo label="Departamento">
          <input
            className={inputCls}
            value={departamento}
            onChange={(e) => setDepartamento(e.target.value)}
            placeholder="Ex.: Comercial, Jurídico, TI"
          />
        </Campo>
      </div>

      <Campo label="Usuário do Blue Desk (opcional)">
        <select className={inputCls} value={profileId} onChange={(e) => setProfileId(e.target.value)}>
          <option value="">Não é usuária do sistema</option>
          {profiles.map((p) => {
            const ocupado = tomados.has(p.id)
            return (
              <option key={p.id} value={p.id} disabled={ocupado}>
                {p.nome}
                {ocupado ? ' — já vinculado' : ''}
              </option>
            )
          })}
        </select>
      </Campo>

      <Campo label="Observações">
        <textarea
          className={inputCls}
          rows={2}
          value={observacoes}
          onChange={(e) => setObservacoes(e.target.value)}
          placeholder="Opcional"
        />
      </Campo>
    </FormDialog>
  )
}
