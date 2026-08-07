// Roda antes do `npm run dev` (hook "predev") e ABORTA se a porta 3000 já estiver ocupada.
//
// Por que isso existe: quando a 3000 está ocupada, o Next NÃO falha — ele pula sozinho para a
// próxima porta livre, que é a 3001, a porta do helper. O resultado é traiçoeiro: o dev server
// novo não consegue servir `localhost` (o helper ocupa as duas pilhas de loopback), e por
// muito tempo o sintoma aparecia como "helper offline" no Blue Desk, sem erro nenhum.
//
// Falhar aqui, com a mensagem certa, custa 1 segundo e evita meia hora de caça ao fantasma.
import net from 'node:net'

const PORT = 3000
const HELPER_PORT = 3001

function inUse(port, host) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host })
    const done = (v) => {
      socket.destroy()
      resolve(v)
    }
    socket.setTimeout(1000)
    socket.on('connect', () => done(true))
    socket.on('timeout', () => done(false))
    socket.on('error', () => done(false))
  })
}

const busy = (await inUse(PORT, '127.0.0.1')) || (await inUse(PORT, '::1'))

if (busy) {
  console.error('')
  console.error(`  A porta ${PORT} já está em uso — provavelmente o Blue Desk já está rodando.`)
  console.error('')
  console.error(`  Abra:  http://localhost:${PORT}`)
  console.error('')
  console.error('  Se quiser mesmo subir outro, encerre o atual primeiro. Não deixe o Next')
  console.error(`  escolher outra porta sozinho: ele pula para a ${HELPER_PORT}, que é a do helper.`)
  console.error('')
  console.error('  Para ver quem está usando as portas:')
  console.error(
    `    Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in ${PORT},${HELPER_PORT} }`
  )
  console.error('')
  process.exit(1)
}
