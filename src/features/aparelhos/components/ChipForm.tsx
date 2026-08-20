'use client'

import { useState } from 'react'
import { Plus } from 'lucide-react'
import { createChip, updateChip } from '@/app/actions/inventario'
import type { InvAparelho, InvChip, InvChipInput, InvChipTipo } from '@/lib/types/database'
import { TIPO_META, TIPO_OPCOES, rotuloAparelho, slotsLivres } from '../shared'
import { BotaoNovo, Campo, FormDialog, inputCls } from './FormDialog'
import { BotaoEditar } from './tableKit'

// Cadastro e edição de chip (mesmo raciocínio do AparelhoForm: um componente só).
//
// O select de aparelho MOSTRA os que já estão cheios, mas desabilitados e com o
// motivo escrito — esconder a opção faria o usuário procurar um aparelho que ele
// sabe que existe. A regra de verdade continua no banco (slot + unique): se dois
// vincularem ao mesmo tempo, o segundo recebe a mensagem do limite, não uma linha
// errada.

export function ChipForm({
  chip,
  aparelhos,
  onSalvo,
}: {
  chip?: InvChip
  aparelhos: InvAparelho[]
  onSalvo: () => void
}) {
  const editando = chip != null

  const [open, setOpen] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const [numero, setNumero] = useState(chip?.numero ?? '')
  const [operadora, setOperadora] = useState(chip?.operadora ?? '')
  const [tipo, setTipo] = useState<InvChipTipo>(chip?.tipo ?? 'pre')
  const [aparelhoId, setAparelhoId] = useState(chip?.aparelhoId ?? '')
  const [observacoes, setObservacoes] = useState(chip?.observacoes ?? '')

  function reset() {
    setNumero(chip?.numero ?? '')
    setOperadora(chip?.operadora ?? '')
    setTipo(chip?.tipo ?? 'pre')
    setAparelhoId(chip?.aparelhoId ?? '')
    setObservacoes(chip?.observacoes ?? '')
    setErro(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErro(null)
    if (!numero.trim()) {
      setErro('Informe o número da linha.')
      return
    }

    const input: InvChipInput = {
      numero,
      operadora,
      tipo,
      aparelhoId: aparelhoId || null,
      observacoes,
    }

    setSalvando(true)
    const res = editando ? await updateChip(chip.id, input) : await createChip(input)
    setSalvando(false)

    if (!res.ok) {
      setErro(res.error ?? 'Não foi possível salvar. Tente novamente.')
      return
    }
    setOpen(false)
    if (!editando) reset()
    onSalvo()
    // O chip foi gravado, mas o vínculo com o aparelho não passou (ver createChip).
    // Vai depois do onSalvo pra tabela já mostrar o chip como avulso quando o
    // usuário fechar o alerta — senão a mensagem falaria de algo que não está na tela.
    if (res.aviso) window.alert(res.aviso)
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
          <BotaoEditar titulo="Editar chip" />
        ) : (
          <BotaoNovo>
            <Plus className="h-4 w-4" />
            Novo chip
          </BotaoNovo>
        )
      }
      titulo={editando ? 'Editar chip' : 'Novo chip'}
      descricao="Um chip pode ficar sem aparelho (avulso, em estoque) e ser vinculado depois."
      rotuloSalvar={editando ? 'Salvar alterações' : 'Cadastrar chip'}
      salvando={salvando}
      erro={erro}
      onSubmit={handleSubmit}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Campo label="Número">
          <input
            className={`${inputCls} font-mono`}
            value={numero}
            onChange={(e) => setNumero(e.target.value)}
            placeholder="(11) 91234-5678"
            inputMode="tel"
            autoFocus
          />
        </Campo>
        <Campo label="Operadora">
          <input
            className={inputCls}
            value={operadora}
            onChange={(e) => setOperadora(e.target.value)}
            placeholder="Ex.: Vivo, Claro, Tim"
          />
        </Campo>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Campo label="Plano">
          <select className={inputCls} value={tipo} onChange={(e) => setTipo(e.target.value as InvChipTipo)}>
            {TIPO_OPCOES.map((t) => (
              <option key={t} value={t}>
                {TIPO_META[t].label}
              </option>
            ))}
          </select>
        </Campo>
        <Campo label="Aparelho">
          <select className={inputCls} value={aparelhoId} onChange={(e) => setAparelhoId(e.target.value)}>
            <option value="">Sem aparelho vinculado</option>
            {aparelhos.map((a) => {
              // O aparelho onde este chip JÁ está nunca é bloqueado — senão editar
              // a operadora de um chip vinculado exigiria desvinculá-lo antes.
              const atual = chip?.aparelhoId === a.id
              const cheio = !atual && slotsLivres(a) === 0
              return (
                <option key={a.id} value={a.id} disabled={cheio}>
                  {rotuloAparelho(a)}
                  {cheio ? ' — já tem 2 chips' : ''}
                </option>
              )
            })}
          </select>
        </Campo>
      </div>

      <Campo label="Observações">
        <textarea
          className={inputCls}
          rows={2}
          value={observacoes}
          onChange={(e) => setObservacoes(e.target.value)}
          placeholder="Opcional — plano contratado, franquia de dados…"
        />
      </Campo>
    </FormDialog>
  )
}
