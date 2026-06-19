export const HELPER_URL = 'http://localhost:3001'

// O Chrome (Local Network Access) bloqueia fetch de site HTTPS → localhost a menos que o
// request declare que o alvo é a rede local. Marcamos targetAddressSpace:'local' para o
// Chrome PEDIR permissão ao usuário em vez de bloquear direto. Sem isso, /ping, /events etc.
// aparecem como "blocked". Navegadores que não suportam a opção simplesmente a ignoram.
// (targetAddressSpace ainda não está nos tipos DOM, daí o cast.)
export function helperFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${HELPER_URL}${path}`, {
    ...init,
    targetAddressSpace: 'local',
  } as RequestInit & { targetAddressSpace: 'local' })
}
