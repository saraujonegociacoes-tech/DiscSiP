'use client'

import { useState } from 'react'
import { Plus } from 'lucide-react'
import { createAparelho, updateAparelho } from '@/app/actions/inventario'
import type { InvAparelho, InvAparelhoInput, InvPessoa, InvStatus } from '@/lib/types/database'
import { STATUS_META, STATUS_OPCOES } from '../shared'
import { BotaoNovo, Campo, FormDialog, inputCls } from './FormDialog'
import { BotaoEditar } from './tableKit'

// Cadastro e edição de aparelho no mesmo componente: os campos são exatamente os
// mesmos e só muda a action chamada no fim. Duas telas separadas divergiriam na
// primeira vez que um campo fosse adicionado em uma e esquecido na outra.
//
// `aparelho` ausente = criação (gatilho "Novo aparelho"); presente = edição
// (gatilho lápis na linha).

export function AparelhoForm({
  aparelho,
  pessoas,
  onSalvo,
}: {
  aparelho?: InvAparelho
  pessoas: InvPessoa[]
  onSalvo: () => void
}) {
  const editando = aparelho != null

  const [open, setOpen] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const [modelo, setModelo] = useState(aparelho?.modelo ?? '')
  const [imei, setImei] = useState(aparelho?.imei ?? '')
  const [pessoaId, setPessoaId] = useState(aparelho?.pessoaId ?? '')
  const [status, setStatus] = useState<InvStatus>(aparelho?.status ?? 'estoque')
  const [observacoes, setObservacoes] = useState(aparelho?.observacoes ?? '')

  // Semeia os campos com os dados do aparelho (na criação, vazios). Chamado na
  // abertura E no fechamento do diálogo — ver o comentário do onOpenChange.
  function reset() {
    setModelo(aparelho?.modelo ?? '')
    setImei(aparelho?.imei ?? '')
    setPessoaId(aparelho?.pessoaId ?? '')
    setStatus(aparelho?.status ?? 'estoque')
    setObservacoes(aparelho?.observacoes ?? '')
    setErro(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErro(null)
    if (!modelo.trim()) {
      setErro('Informe o modelo do aparelho.')
      return
    }

    const input: InvAparelhoInput = {
      modelo,
      imei,
      pessoaId: pessoaId || null,
      status,
      observacoes,
    }

    setSalvando(true)
    const res = editando ? await updateAparelho(aparelho.id, input) : await createAparelho(input)
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
          <BotaoEditar titulo="Editar aparelho" />
        ) : (
          <BotaoNovo>
            <Plus className="h-4 w-4" />
            Novo aparelho
          </BotaoNovo>
        )
      }
      titulo={editando ? 'Editar aparelho' : 'Novo aparelho'}
      descricao="Modelo e IMEI identificam o aparelho; o responsável e o status dizem onde ele está."
      rotuloSalvar={editando ? 'Salvar alterações' : 'Cadastrar aparelho'}
      salvando={salvando}
      erro={erro}
      onSubmit={handleSubmit}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Campo label="Modelo">
          <input
            className={inputCls}
            value={modelo}
            onChange={(e) => setModelo(e.target.value)}
            placeholder="Ex.: iPhone 13"
            autoFocus
          />
        </Campo>
        <Campo label="IMEI (opcional)">
          <input
            className={`${inputCls} font-mono`}
            value={imei}
            onChange={(e) => setImei(e.target.value)}
            placeholder="Ex.: 35 274011 234567 8"
            inputMode="numeric"
          />
        </Campo>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Campo label="Responsável">
          <select className={inputCls} value={pessoaId} onChange={(e) => setPessoaId(e.target.value)}>
            <option value="">Sem responsável (estoque)</option>
            {pessoas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
                {p.departamento ? ` · ${p.departamento}` : ''}
              </option>
            ))}
          </select>
        </Campo>
        <Campo label="Status">
          <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value as InvStatus)}>
            {STATUS_OPCOES.map((s) => (
              <option key={s} value={s}>
                {STATUS_META[s].label}
              </option>
            ))}
          </select>
        </Campo>
      </div>

      <Campo label="Observações">
        <textarea
          className={inputCls}
          rows={2}
          value={observacoes}
          onChange={(e) => setObservacoes(e.target.value)}
          placeholder="Opcional — capa, carregador, avarias…"
        />
      </Campo>

      <p className="rounded-lg border border-border bg-background/50 p-3 text-xs text-muted-foreground">
        Os chips são cadastrados na aba <span className="text-foreground">Chips</span> e vinculados a
        um aparelho de lá. Cada aparelho aceita até <span className="text-foreground">2 chips</span>.
      </p>
    </FormDialog>
  )
}
