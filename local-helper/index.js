const express = require('express')
const { exec, spawn } = require('child_process')
const fs = require('fs')
const path = require('path')
const app = express()

const PORT = 3001

// Prefixo para linha externa do PABX, se necessário (ex: "0"). Configurável por env.
const DIAL_PREFIX = process.env.DIAL_PREFIX || ''

// DDD local do escritório. Números deste DDD são discados em formato LOCAL (sem o DDD),
// como os agentes fazem manualmente. Números de outros DDDs mantêm o DDD.
const LOCAL_DDD = process.env.LOCAL_DDD || '11'

// Normaliza o número para o formato que o PABX espera:
// - tira tudo que não é dígito e o código de país (+55 / 55)
// - se for do DDD local, remove o DDD (disca local)
// - aplica o prefixo de linha externa, se houver
function formatNumber(raw) {
  let digits = String(raw).replace(/\D/g, '')
  if (digits.length > 11 && digits.startsWith('55')) digits = digits.slice(2)
  if (LOCAL_DDD && (digits.length === 10 || digits.length === 11) && digits.startsWith(LOCAL_DDD)) {
    digits = digits.slice(LOCAL_DDD.length)
  }
  return DIAL_PREFIX + digits
}

app.use(express.json())

// CORS para permitir chamadas do DiscSiP (HTTPS → localhost)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Private-Network', 'true')
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.header('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

// Localiza o microsip.exe no disco. Permite override via MICROSIP_PATH.
function findMicroSIP() {
  if (process.env.MICROSIP_PATH && fs.existsSync(process.env.MICROSIP_PATH)) {
    return process.env.MICROSIP_PATH
  }
  const candidates = [
    'C:\\Program Files (x86)\\MicroSIP\\microsip.exe',
    'C:\\Program Files\\MicroSIP\\microsip.exe',
    path.join(process.env.LOCALAPPDATA || '', 'MicroSIP', 'microsip.exe'),
    path.join(process.env.APPDATA || '', 'MicroSIP', 'microsip.exe'),
    path.join(process.env.USERPROFILE || '', 'MicroSIP', 'microsip.exe'),
  ]
  return candidates.find((p) => p && fs.existsSync(p)) || null
}

const MICROSIP = findMicroSIP()

// Health check — usado pelo DiscSiP para saber se o helper está rodando
app.get('/ping', (req, res) => {
  res.json({ ok: true, microsip: MICROSIP })
})

// Aciona uma chamada no MicroSIP
app.post('/call', (req, res) => {
  const { number } = req.body
  if (!number) return res.status(400).json({ error: 'number obrigatorio' })

  if (!String(number).replace(/\D/g, '')) return res.status(400).json({ error: 'Numero invalido' })

  const dial = formatNumber(number)
  const ts = new Date().toLocaleTimeString()

  // Caminho preferido: chamar o microsip.exe direto com o número (auto-disca).
  if (MICROSIP) {
    try {
      const child = spawn(MICROSIP, [dial], { detached: true, stdio: 'ignore' })
      child.on('error', (err) => {
        console.error(`[${ts}] ERRO ao abrir MicroSIP: ${err.message}`)
      })
      child.unref()
      console.log(`[${ts}] Discando ${dial} via ${MICROSIP}`)
      return res.json({ ok: true, number: dial, method: 'microsip-exe' })
    } catch (err) {
      console.error(`[${ts}] ERRO no spawn do MicroSIP: ${err.message}`)
      // cai para o fallback abaixo
    }
  }

  // Fallback: protocolo tel: do Windows (depende do handler estar registrado)
  exec(`start "" "tel:${dial}"`, (err) => {
    if (err) {
      console.error(`[${ts}] ERRO ao acionar tel: ${err.message}`)
      return res.status(500).json({ error: err.message })
    }
    console.log(`[${ts}] Discando ${dial} via protocolo tel: (microsip.exe nao encontrado no disco)`)
    res.json({ ok: true, number: dial, method: 'tel-protocol' })
  })
})

app.listen(PORT, '127.0.0.1', () => {
  console.log('=================================')
  console.log(` DiscSiP Helper v1.1`)
  console.log(` http://localhost:${PORT}`)
  console.log('=================================')
  if (MICROSIP) {
    console.log(` MicroSIP encontrado: ${MICROSIP}`)
  } else {
    console.log(' MicroSIP NAO encontrado no disco — usando protocolo tel: (fallback)')
    console.log(' Se a discagem nao funcionar, defina MICROSIP_PATH apontando para o microsip.exe')
  }
  if (LOCAL_DDD) console.log(` DDD local (discado sem DDD): ${LOCAL_DDD}`)
  if (DIAL_PREFIX) console.log(` Prefixo de discagem: "${DIAL_PREFIX}"`)
  console.log('Aguardando chamadas do DiscSiP...')
  console.log('')
})
