// Servidor estático mínimo para abrir o probe WebRTC em `localhost`.
//
// POR QUE EXISTE (e não um `npx serve`): o probe precisa de *secure context* — `getUserMedia`
// não roda em `file://`. E o `npx serve` BAIXA o pacote na primeira execução (10-30s), o que
// faz o navegador bater em "conexão recusada" se aberto antes. Este arquivo não tem dependência
// nenhuma: sobe na hora, sempre.
//
// Uso:  npm run probe:webrtc
// Doc:  docs/discadora-docs/updates/softphone-webrtc-navegador.md §1

import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join, extname, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('.', import.meta.url))
const DEFAULT_FILE = 'probe-webrtc-sip.html'
const START_PORT = Number(process.env.PROBE_PORT) || 5050

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
}

const server = createServer(async (req, res) => {
  // Só o nome do arquivo interessa; `normalize` + remoção de `..` impede sair da pasta scripts/.
  const rawPath = decodeURIComponent((req.url || '/').split('?')[0])
  const rel = normalize(rawPath === '/' ? DEFAULT_FILE : rawPath.replace(/^\/+/, '')).replace(
    /^(\.\.[/\\])+/,
    ''
  )
  try {
    const body = await readFile(join(ROOT, rel))
    res.writeHead(200, {
      'Content-Type': TYPES[extname(rel)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    })
    res.end(body)
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end(`404 — ${rel} não existe em scripts/`)
  }
})

// Se a 5050 estiver ocupada, sobe na próxima livre em vez de morrer com EADDRINUSE.
function listen(port, tentativas = 10) {
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && tentativas > 0) {
      console.log(`porta ${port} ocupada, tentando ${port + 1}…`)
      listen(port + 1, tentativas - 1)
      return
    }
    console.error(`erro ao subir o servidor: ${err.message}`)
    process.exit(1)
  })
  server.listen(port, '127.0.0.1', () => {
    const url = `http://localhost:${port}/${DEFAULT_FILE}`
    console.log('')
    console.log('  Probe WebRTC/SIP — Etapa 0')
    console.log(`  ${url}`)
    console.log('')
    console.log('  Abra a URL acima, preencha ramal + senha SIP e siga os botões numerados.')
    console.log('  Ctrl+C encerra.')
    console.log('')
  })
}

listen(START_PORT)
