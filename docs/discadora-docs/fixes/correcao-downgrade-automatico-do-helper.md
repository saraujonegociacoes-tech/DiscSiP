# Correção — o helper se rebaixava sozinho e sobrescrevia o próprio código (v1.16)

> 2026-08-21. Um helper 1.16 virou 1.7 sozinho no boot, **apagando `local-helper/index.js`** e
> levando junto tudo que existia da 1.8 à 1.15. Não é um risco teórico: aconteceu na máquina
> do dono, e é o que estava por trás do relato *"funcionou só no primeiro bloco de ligação"*.

---

## Sintoma

Depois de reiniciar o helper, o dialer voltou a se comportar como versão antiga. O `/ping`
respondia `1.7` — com o payload curto da 1.7, sem `ini`/`multiCall`/`dir`. E no `helper.log`:

```
2026-08-21T19:30:32.659Z LOG Versao nova encontrada (1.16 -> 1.7). Atualizando...
```

"Versão nova": **1.7**.

## Causa

O auto-update comparava versões com `!==`:

```js
const { code, version } = await fetchLatest(base)
if (version !== HELPER_VERSION) {   // ← qualquer versão DIFERENTE, inclusive mais velha
  applyUpdate(code)                 // ← sobrescreve local-helper/index.js
  exitForUpdate()
}
```

`fetchLatest` busca em `<origem>/helper/index.js`. A origem gravada em `helper-config.json` era
`http://localhost:3000` — o `next dev` do próprio repo, que serve **`public/helper/`**. E
`public/helper/` é artefato de build (está no `.gitignore`, gerado por `npm run sync:helper`,
que só roda no `prebuild`): estava parado na **1.7**, muito atrás do `local-helper/`.

Resultado: helper sobe → pergunta à origem → recebe 1.7 → "diferente, então atualiza" → grava a
1.7 por cima da fonte e reinicia nela. Os dois caminhos tinham o furo: o `maybeAutoUpdate` do
boot e o `POST /update` (botão "Atualizar" do Blue Desk).

Detalhe que torna isso pior: `local-helper/` **é a fonte do repositório**, não uma cópia
instalada. O updater não estava atualizando um binário — estava sobrescrevendo código-fonte.
(O que salvou foi o git: a 1.15 estava commitada. E o `applyUpdate` guarda um `index.bak`.)

## Correção

A UI **já** tinha o comparador certo (`isVersionNewer` no `SoftphoneClient.tsx`, escrito depois
de um episódio parecido com `version.json` cacheado). O helper não tinha. Agora tem o mesmo:

```js
function isVersionNewer(remote, current) { /* compara X.Y.Z numericamente */ }
```

- `maybeAutoUpdate` (boot): só atualiza se a origem for **estritamente mais nova**. Se for mais
  velha, loga e segue — sugerindo `npm run sync:helper`.
- `POST /update`: devolve `{ updated: false, reason: 'origem-mais-velha' }` em vez de rebaixar.

**Atualização só anda para frente.**

## Verificado

Com um servidor falso fazendo as vezes do Blue Desk, contra um helper 1.16:

| Origem serve | Resultado |
|---|---|
| 1.7 (mais velha) | `{"updated":false,"remote":"1.7","reason":"origem-mais-velha"}` — arquivo intacto |
| 1.99 (mais nova) | `{"updated":true,"from":"1.16","to":"1.99"}` — atualizou e reiniciou |

## O que fazer se acontecer de novo

1. `git status` / `git diff` em `local-helper/index.js` — a versão boa provavelmente está no
   HEAD, e `local-helper/index.bak` guarda o que foi sobrescrito.
2. Rode `npm run sync:helper` antes de reiniciar o helper: é o que alinha `public/helper/` com
   o `local-helper/`. Sem isso, o `next dev` serve um helper velho para a própria máquina.
3. ⚠️ **Não use o botão "Atualizar"** do Blue Desk para subir uma versão que só existe local:
   ele *baixa* da origem. Para rodar código local, feche e reabra o helper.
