const express = require('express')
const { exec, spawn } = require('child_process')
const fs = require('fs')
const path = require('path')
const app = express()

const PORT = 3001

// Código de seleção de operadora (CSP) para discagem interurbana. Sem ele o MicroSIP
// não completa chamadas para outros estados. Resultado: DIAL_PREFIX + DDD + número.
// Configurável por env (default 021); muda só se trocar de operadora de longa distância.
const DIAL_PREFIX = process.env.DIAL_PREFIX || '021'

// Normaliza o número para o formato que o PABX espera:
// - tira tudo que não é dígito e o código de país (+55 / 55)
// - prefixa o CSP, sempre discando 021 + DDD + número (ex: 021 11 95208-5529)
function formatNumber(raw) {
  let digits = String(raw).replace(/\D/g, '')
  if (digits.length > 11 && digits.startsWith('55')) digits = digits.slice(2)
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

// Último evento de chamada recebido do MicroSIP (via cmdCallStart/cmdCallEnd no microsip.ini).
// O DiscSiP faz polling em /events para reagir (mostrar tabulação, cronômetro real).
let lastEvent = { id: 0, type: 'idle', number: null, at: null }
function recordEvent(type, number) {
  lastEvent = {
    id: lastEvent.id + 1,
    type,
    number: number || null,
    at: new Date().toISOString(),
  }
  console.log(`[${new Date().toLocaleTimeString()}] Evento: ${type}${number ? ' ' + number : ''}`)
}

// Roda um comando de controle do MicroSIP (ex: "msip:hangupall"). A instância em execução
// recebe via WM_COPYDATA e executa, sem trazer a janela para frente.
function runMsip(arg) {
  if (!MICROSIP) return false
  try {
    const child = spawn(MICROSIP, [arg], { detached: true, stdio: 'ignore' })
    child.on('error', () => {})
    child.unref()
    return true
  } catch {
    return false
  }
}

// Health check — usado pelo DiscSiP para saber se o helper está rodando
app.get('/ping', (req, res) => {
  res.json({ ok: true, microsip: MICROSIP })
})

// Encerra a chamada ativa no MicroSIP — usado pelo botão "Encerrar" do DiscSiP
app.post('/hangup', (req, res) => {
  const ts = new Date().toLocaleTimeString()
  if (runMsip('msip:hangupall')) {
    console.log(`[${ts}] Encerrando chamada (msip:hangupall)`)
    return res.json({ ok: true })
  }
  console.error(`[${ts}] ERRO ao encerrar: MicroSIP nao encontrado`)
  res.status(500).json({ error: 'MicroSIP nao encontrado' })
})

// Eventos vindos do MicroSIP (configurados no microsip.ini: cmdCallStart / cmdCallEnd).
// São GET porque o curl do MicroSIP usa GET por padrão.
app.get('/event/call-start', (req, res) => {
  recordEvent('call-start', req.query.number)
  res.json({ ok: true })
})
app.get('/event/call-end', (req, res) => {
  recordEvent('call-end', req.query.number)
  res.json({ ok: true })
})
// Ligacao deu ocupado (486/600/603). O MicroSIP roteia esses casos para cmdCallBusy,
// nao para cmdCallEnd — por isso o evento proprio, para o DiscSiP tambem tabular.
app.get('/event/call-busy', (req, res) => {
  recordEvent('call-busy', req.query.number)
  res.json({ ok: true })
})

// O DiscSiP faz polling aqui para saber o último evento de chamada
app.get('/events', (req, res) => res.json(lastEvent))

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
  console.log(` DiscSiP Helper v1.3`)
  console.log(` http://localhost:${PORT}`)
  console.log('=================================')
  if (MICROSIP) {
    console.log(` MicroSIP encontrado: ${MICROSIP}`)
  } else {
    console.log(' MicroSIP NAO encontrado no disco — usando protocolo tel: (fallback)')
    console.log(' Se a discagem nao funcionar, defina MICROSIP_PATH apontando para o microsip.exe')
  }
  if (DIAL_PREFIX) console.log(` Prefixo de discagem (CSP): "${DIAL_PREFIX}" — disca ${DIAL_PREFIX} + DDD + numero`)
  console.log('Aguardando chamadas do DiscSiP...')
  console.log('')
})
