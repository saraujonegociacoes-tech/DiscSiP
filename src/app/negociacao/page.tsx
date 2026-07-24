import { ComingSoon } from '@/components/bluedesk/ComingSoon'

// Painel de Negociação — terceira vertical (ao lado de Comercial/Leads e CS). Ainda não
// existe nenhuma aplicação para Negociação; esta rota só reserva o espaço no menu lateral
// ("Em breve", sem flag — não há dado nem previsão de sprint ainda).
export default async function NegociacaoPage() {
  return (
    <ComingSoon
      title="Negociação"
      description="Painel de acompanhamento do Departamento de Negociação."
      message="Ainda não existe uma aplicação para Negociação. Este espaço fica reservado para quando o primeiro painel dessa área for construído."
    />
  )
}
