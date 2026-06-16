const express = require('express')
const { exec, spawn } = require('child_process')
const fs = require('fs')
const path = require('path')
const app = express()

const PORT = 3001

// Versão do helper. É o que o DiscSiP compara para saber se está desatualizado e
// oferecer o botão "Atualizar". Suba este número a cada correção no helper.
const HELPER_VERSION = '1.4'

// Código de seleção de operadora (CSP) para discagem interurbana. Sem ele o MicroSIP
// não completa chamadas para outros estados. Resultado: DIAL_PREFIX + DDD + número.
// Configurável por env (default 021); muda só se trocar de operadora de longa distância.
const DIAL_PREFIX = process.env.DIAL_PREFIX || '021'

// Onde o helper busca a versão nova de si mesmo. Em runtime preferimos a origem que o
// próprio DiscSiP manda no header Origin (persistida em helper-config.json) — assim não
// precisa fixar o domínio aqui. Este env é só fallback para a auto-atualização no start.
const CONFIG_PATH = path.join(__dirname, 'helper-config.json')

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
  } catch {
    return {}
  }
}
function writeConfig(patch) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({ ...readConfig(), ...patch }, null, 2))
  } catch {
    // disco somente-leitura / sem permissão — segue sem persistir
  }
}

// Base do DiscSiP para auto-atualização: env > último Origin visto > nada.
function discsipBaseUrl() {
  return process.env.DISCSIP_URL || readConfig().origin || null
}

// Normaliza o número para o formato que o PABX espera:
// - tira tudo que não é dígito e o código de país (+55 / 55)
// - prefixa o CSP, sempre discando 021 + DDD + número (ex: 021 11 95208-5529)
function formatNumber(raw) {
  let digits = String(raw).replace(/\D/g, '')
  if (digits.length > 11 && digits.startsWith('55')) digits = digits.slice(2)
  return DIAL_PREFIX + digits
}

app.use(express.json())

// CORS para permitir chamadas do DiscSiP (HTTPS → localhost). De quebra, todo request
// do navegador traz o header Origin = domínio do DiscSiP: guardamos para a auto-atualização.
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Private-Network', 'true')
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.header('Access-Control-Allow-Headers', 'Content-Type')
  const origin = req.headers.origin
  if (origin && /^https?:\/\//.test(origin) && origin !== readConfig().origin) {
    writeConfig({ origin })
  }
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

// ─── Auto-atualização ──────────────────────────────────────────────────────────
// Baixa o código novo do DiscSiP, valida, faz backup e sobrescreve este próprio arquivo.
// Quem reinicia no código novo é o start.bat: ao sairmos com código 42, ele reabre o node.
const UPDATE_EXIT_CODE = 42

async function fetchLatest(base) {
  const url = `${base.replace(/\/$/, '')}/helper/index.js`
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`HTTP ${res.status} ao buscar ${url}`)
  const code = await res.text()
  // Sanidade: garante que veio JS do helper e não uma página de erro/HTML.
  const m = code.match(/HELPER_VERSION\s*=\s*['"]([^'"]+)['"]/)
  if (!m || !code.includes('app.listen') || code.length < 1000) {
    throw new Error('conteúdo baixado não parece o helper (abortado)')
  }
  return { code, version: m[1] }
}

function applyUpdate(code) {
  // backup do atual antes de sobrescrever, para conseguir voltar manualmente se preciso
  try { fs.copyFileSync(__filename, path.join(__dirname, 'index.bak')) } catch {}
  fs.writeFileSync(__filename, code)
}

// Health check — usado pelo DiscSiP para saber se o helper está rodando e qual a versão
app.get('/ping', (req, res) => {
  res.json({ ok: true, version: HELPER_VERSION, microsip: MICROSIP })
})

// Atualiza o helper sob demanda (botão "Atualizar helper" no DiscSiP).
// O navegador manda { source } = sua própria origem; usamos ela para baixar o código.
app.post('/update', async (req, res) => {
  const ts = new Date().toLocaleTimeString()
  const base = (req.body && req.body.source) || discsipBaseUrl()
  if (!base) {
    return res.status(400).json({ error: 'origem do DiscSiP desconhecida' })
  }
  try {
    const { code, version } = await fetchLatest(base)
    if (version === HELPER_VERSION) {
      return res.json({ ok: true, updated: false, version: HELPER_VERSION })
    }
    applyUpdate(code)
    console.log(`[${ts}] Atualizando ${HELPER_VERSION} -> ${version}. Reiniciando...`)
    res.json({ ok: true, updated: true, from: HELPER_VERSION, to: version })
    // dá tempo da resposta sair antes de reiniciar
    setTimeout(() => process.exit(UPDATE_EXIT_CODE), 400)
  } catch (err) {
    console.error(`[${ts}] ERRO ao atualizar: ${err.message}`)
    res.status(500).json({ error: err.message })
  }
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

// No start, antes de subir o servidor, tenta se atualizar sozinho contra o DiscSiP.
// Se houver versão nova, sobrescreve e sai com 42 — o start.bat reabre no código novo.
// Como após o restart HELPER_VERSION passa a bater com o remoto, não há loop.
async function maybeAutoUpdate() {
  const base = discsipBaseUrl()
  if (!base) return
  try {
    const { code, version } = await fetchLatest(base)
    if (version !== HELPER_VERSION) {
      console.log(`Versao nova encontrada (${HELPER_VERSION} -> ${version}). Atualizando...`)
      applyUpdate(code)
      process.exit(UPDATE_EXIT_CODE)
    }
  } catch {
    // sem rede / DiscSiP fora do ar / origem ainda não conhecida — segue com a versão atual
  }
}

async function main() {
  await maybeAutoUpdate()

  const server = app.listen(PORT, '127.0.0.1', () => {
    console.log('=================================')
    console.log(` DiscSiP Helper v${HELPER_VERSION}`)
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

  // Porta ocupada = quase sempre OUTRA instância do helper já rodando. Em vez do
  // crash feio do Node, explica o que houve e sai com 1 (o start.bat NÃO reinicia).
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error('=================================')
      console.error(` ERRO: a porta ${PORT} ja esta em uso.`)
      console.error(' O helper provavelmente JA esta aberto em outra janela.')
      console.error(' Feche a outra janela do helper — ou rode no terminal:')
      console.error('     taskkill /IM node.exe /F')
      console.error(' e abra este novamente.')
      console.error('=================================')
    } else {
      console.error('Erro ao iniciar o helper:', err.message)
    }
    process.exit(1)
  })
}

main()
