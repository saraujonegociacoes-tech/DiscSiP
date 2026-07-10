// URL do card no Pipefy a partir do id do card. O link "open-cards" resolve com só o id do
// card (o Pipefy redireciona para o pipe/fase certos), sem precisar do id do pipe.
export function pipefyCardUrl(cardId: string): string {
  return `https://app.pipefy.com/open-cards/${encodeURIComponent(cardId)}`
}
