export const HELPER_URL = 'http://localhost:3001'

// Fetch de site HTTPS → helper em localhost. O Chrome/Edge restringe isso e o nome do
// "espaço de endereço" do alvo MUDOU entre versões, o que fazia algumas máquinas funcionarem
// e outras não:
//   • Local Network Access (navegadores NOVOS): localhost é 'loopback'. Declarar 'local' (=LAN)
//     é bloqueado: "target IP address space of local yet the resource is in address space loopback".
//   • Private Network Access (navegadores ANTIGOS): usava 'local' para loopback.
//   • Versões mais antigas ainda: ignoram a opção (qualquer valor funciona).
// Por isso tentamos em cascata: 'loopback' → 'local' → sem hint, e usamos a 1ª que conectar.
// (fetch só rejeita em falha de rede/bloqueio; um 200/500 retorna na hora, sem cair no fallback.)
// targetAddressSpace ainda não está nos tipos DOM, daí o cast.
export function helperFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = `${HELPER_URL}${path}`
  const tryFetch = (space?: string) =>
    fetch(
      url,
      space
        ? ({ ...init, targetAddressSpace: space } as RequestInit & { targetAddressSpace: string })
        : init
    )
  return tryFetch('loopback')
    .catch(() => tryFetch('local'))
    .catch(() => tryFetch(undefined))
}
