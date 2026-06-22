const express = require('express')
const { exec, spawn } = require('child_process')
const fs = require('fs')
const path = require('path')
const app = express()

const PORT = 3001

// Versão do helper. É o que o Blue Line compara para saber se está desatualizado e
// oferecer o botão "Atualizar". Suba este número a cada correção no helper.
const HELPER_VERSION = '1.6'

// Código de seleção de operadora (CSP) para discagem interurbana. Sem ele o MicroSIP
// não completa chamadas para outros estados. Resultado: DIAL_PREFIX + DDD + número.
// Configurável por env (default 021); muda só se trocar de operadora de longa distância.
const DIAL_PREFIX = process.env.DIAL_PREFIX || '021'

// Onde o helper busca a versão nova de si mesmo. Em runtime preferimos a origem que o
// próprio Blue Line manda no header Origin (persistida em helper-config.json) — assim não
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

// Base do Blue Line para auto-atualização: env > último Origin visto > nada.
function bluelineBaseUrl() {
  return process.env.BLUELINE_URL || readConfig().origin || null
}

// Normaliza o número para o formato que o PABX espera:
// - tira tudo que não é dígito e o código de país (+55 / 55)
// - prefixa o CSP, sempre discando 021 + DDD + número (ex: 021 11 95208-5529)
function formatNumber(raw) {
  let digits = String(raw).replace(/\D/g, '')
  if (digits.length > 11 && digits.startsWith('55')) digits = digits.slice(2)
  return DIAL_PREFIX + digits
}

// Só os dígitos de uma string — usado para casar o número que vem no evento do MicroSIP
// com o número que foi discado (formatos podem diferir em pontuação/prefixo).
function digitsOf(s) {
  return String(s || '').replace(/\D/g, '')
}

// Timestamp curto para os logs do helper.
function ts() {
  return new Date().toLocaleTimeString()
}

app.use(express.json())

// CORS para permitir chamadas do Blue Line (HTTPS → localhost). De quebra, todo request
// do navegador traz o header Origin = domínio do Blue Line: guardamos para a auto-atualização.
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
// O Blue Line faz polling em /events para reagir (mostrar tabulação, cronômetro real).
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

// ─── Discagem paralela / preditiva ───────────────────────────────────────────────
// Disca N números ao mesmo tempo, conecta o 1º que ATENDE e derruba os que ainda tocam
// (/hangupcalling, que poupa a chamada já CONFIRMED). Enquanto disca, muta o alto-falante
// (speakmute) para o agente não ouvir os N ringbacks misturados no "Wave mapper"; ao
// atender, desmuta (speakunmute). A janela do MicroSIP — que em multi-call volta a
// aparecer ao discar — é escondida à força via ShowWindow(SW_HIDE).
let parallelSession = null

// Hider PERSISTENTE da janela do MicroSIP. Em multi-call o MicroSIP REEXIBE a janela a cada
// evento (discar / atender / derrubar) e durante a propria conversa, entao esconder em rajada
// deixa brechas (foi o que vimos: o handle voltou a !=0 no meio do toque). Em vez disso, um
// PowerShell OCULTO fica em loop (~250ms) escondendo QUALQUER janela visivel do microsip
// enquanto o helper estiver vivo. Usa ShowWindow(SW_HIDE) via Win32 — sem dependencia nativa,
// so o powershell.exe que existe em todo Windows. O loop embute o PID do helper e termina
// sozinho quando o helper morre (nao deixa processo orfao). HELPER_NO_HIDE=1 desliga (util
// para depurar vendo o MicroSIP). Comando vai como -EncodedCommand (base64 UTF-16LE).
let hiderChild = null
function startMicrosipHider() {
  if (process.env.HELPER_NO_HIDE || !MICROSIP || hiderChild) return
  const script = `
$parentPid = ${process.pid}
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class MsipHide {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  public static void HidePid(uint pid){
    EnumWindows((h,p)=>{ uint wp; GetWindowThreadProcessId(h, out wp); if(wp==pid && IsWindowVisible(h)) ShowWindow(h,0); return true; }, IntPtr.Zero);
  }
}
"@
while($true){
  if(-not (Get-Process -Id $parentPid -ErrorAction SilentlyContinue)){ break }
  foreach($pr in Get-Process microsip -ErrorAction SilentlyContinue){ [MsipHide]::HidePid([uint32]$pr.Id) }
  Start-Sleep -Milliseconds 250
}`
  try {
    const encoded = Buffer.from(script, 'utf16le').toString('base64')
    // IMPORTANTE: NAO usar detached:true aqui. Detached spawna o powershell SEM console
    // (DETACHED_PROCESS), e nesse modo o Add-Type (que compila C# via csc.exe) falha em
    // silencio -> o loop nunca roda e a janela nunca e escondida. windowsHide:true esconde o
    // console mas o aloca, e ai o Add-Type compila. unref() evita que o filho segure o helper.
    hiderChild = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded],
      { stdio: 'ignore', windowsHide: true }
    )
    hiderChild.on('error', () => {})
    hiderChild.unref()
    console.log(`[${ts()}] Hider da janela do MicroSIP iniciado (oculto, ~250ms).`)
  } catch {
    // sem PowerShell disponivel — a janela pode aparecer, mas a discagem segue
  }
}

// Desmuta o alto-falante UMA vez por sessão (evita speakunmute duplicado).
function parallelUnmute() {
  if (parallelSession && parallelSession.muted) {
    parallelSession.muted = false
    runMsip('msip:speakunmute')
  }
}

// Acha, na sessão atual, o número discado que casa com o número do evento (por dígitos).
function matchParallelNumber(evNumber) {
  if (!parallelSession) return null
  const d = digitsOf(evNumber)
  return parallelSession.numbers.find((n) => digitsOf(n) === d) || null
}

// 1º atendimento vence: registra o vencedor, desmuta e derruba as que ainda tocam.
// Dispara no instante do call-start (sub-100ms) — estreita a janela de abandono.
function handleParallelAnswer(evNumber) {
  if (!parallelSession || parallelSession.resolved) return
  const num = matchParallelNumber(evNumber)
  if (!num) return
  parallelSession.resolved = true
  parallelSession.winner = num
  parallelSession.answeredAt = new Date().toISOString()
  parallelSession.calls[num] = 'answered'
  parallelUnmute()
  runMsip('/hangupcalling')
  console.log(`[${ts()}] PARALELO #${parallelSession.id}: ${num} ATENDEU -> speakunmute + /hangupcalling`)
}

// Marca o término de uma das linhas. Se ninguém atendeu e todas terminaram, desmuta —
// senão o alto-falante ficaria mudo para o agente após a rajada.
function handleParallelEnd(evNumber, state) {
  if (!parallelSession) return
  const num = matchParallelNumber(evNumber)
  if (!num) return
  // Atualiza o estado da linha INCLUSIVE o vencedor: quando o vencedor (que estava 'answered')
  // recebe seu call-end, vira 'ended' — é assim que a UI sabe que a conversa acabou e mostra a
  // disposição. O call-end dos derrubados afeta só a entrada deles (match por número).
  parallelSession.calls[num] = state
  const aindaTocando = Object.values(parallelSession.calls).some((s) => s === 'calling')
  if (!parallelSession.resolved && !aindaTocando) {
    parallelUnmute()
    parallelSession.endedNoAnswer = true
    console.log(`[${ts()}] PARALELO #${parallelSession.id}: ninguem atendeu -> speakunmute`)
  }
}

// ─── Auto-atualização ──────────────────────────────────────────────────────────
// Baixa o código novo do Blue Line, valida, faz backup e sobrescreve este próprio arquivo.
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

// Health check — usado pelo Blue Line para saber se o helper está rodando e qual a versão
app.get('/ping', (req, res) => {
  res.json({ ok: true, version: HELPER_VERSION, microsip: MICROSIP })
})

// Atualiza o helper sob demanda (botão "Atualizar helper" no Blue Line).
// O navegador manda { source } = sua própria origem; usamos ela para baixar o código.
app.post('/update', async (req, res) => {
  const ts = new Date().toLocaleTimeString()
  const base = (req.body && req.body.source) || bluelineBaseUrl()
  if (!base) {
    return res.status(400).json({ error: 'origem do Blue Line desconhecida' })
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

// Encerra a chamada ativa no MicroSIP — usado pelo botão "Encerrar" do Blue Line
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
  handleParallelAnswer(req.query.number)
  res.json({ ok: true })
})
app.get('/event/call-end', (req, res) => {
  recordEvent('call-end', req.query.number)
  handleParallelEnd(req.query.number, 'ended')
  res.json({ ok: true })
})
// Ligacao deu ocupado (486/600/603). O MicroSIP roteia esses casos para cmdCallBusy,
// nao para cmdCallEnd — por isso o evento proprio, para o Blue Line tambem tabular.
app.get('/event/call-busy', (req, res) => {
  recordEvent('call-busy', req.query.number)
  handleParallelEnd(req.query.number, 'busy')
  res.json({ ok: true })
})

// O Blue Line faz polling aqui para saber o último evento de chamada
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

// Discagem paralela: recebe { numbers: [...] }, muta o alto-falante, dispara as N em
// rajada, esconde a janela do MicroSIP e arma um timeout de seguranca para desmutar
// caso ninguem atenda. O 1o call-start (handleParallelAnswer) faz o resto.
app.post('/dial-parallel', (req, res) => {
  const { numbers } = req.body || {}
  if (!Array.isArray(numbers) || numbers.length === 0) {
    return res.status(400).json({ error: 'numbers (array) obrigatorio' })
  }
  const dials = numbers
    .map((n) => String(n))
    .filter((n) => digitsOf(n))
    .map(formatNumber)
  if (dials.length === 0) return res.status(400).json({ error: 'nenhum numero valido' })
  if (!MICROSIP) return res.status(500).json({ error: 'MicroSIP nao encontrado' })

  parallelSession = {
    id: (parallelSession ? parallelSession.id : 0) + 1,
    startedAt: new Date().toISOString(),
    numbers: dials,
    calls: Object.fromEntries(dials.map((d) => [d, 'calling'])),
    winner: null,
    answeredAt: null,
    resolved: false,
    muted: true,
  }
  const sid = parallelSession.id

  // 1) silencio durante o "discando N"
  runMsip('msip:speakmute')
  // 2) dispara as N ESCALONADAS (~300ms). Disparar tudo no mesmo instante faz varias
  // instancias do microsip.exe disputarem a escrita do microsip.ini (historico de
  // discados) ao mesmo tempo -> uma trava a outra -> modal "Failed to open file for
  // writing ...ini", que ainda congela a fila de comandos do MicroSIP. O escalonamento
  // serializa esse toque no .ini. 300ms x N e desprezivel perto dos ~15-30s de toque.
  const STAGGER_MS = 300
  dials.forEach((dial, i) => {
    setTimeout(() => {
      try {
        const child = spawn(MICROSIP, [dial], { detached: true, stdio: 'ignore' })
        child.on('error', () => {})
        child.unref()
      } catch {
        // segue para os demais numeros
      }
    }, i * STAGGER_MS)
  })
  console.log(`[${ts()}] PARALELO #${sid}: discando ${dials.length} -> ${dials.join(', ')} (speakmute, escalonado)`)
  // A janela do MicroSIP fica escondida continuamente pelo hider persistente (startMicrosipHider).
  // 4) seguranca: se ninguem atender, desmuta apos 45s para nao deixar o agente no mudo
  setTimeout(() => {
    if (parallelSession && parallelSession.id === sid) parallelUnmute()
  }, 45000)

  res.json({ ok: true, session: sid, dialed: dials })
})

// Estado agregado da sessao paralela atual — a UI consome para mostrar "discando N" e,
// quando alguem atende, "ATENDEU, fale agora" (winner).
app.get('/parallel-status', (req, res) => {
  if (!parallelSession) return res.json({ active: false })
  res.json({
    active: true,
    id: parallelSession.id,
    startedAt: parallelSession.startedAt,
    calls: parallelSession.calls,
    winner: parallelSession.winner,
    answeredAt: parallelSession.answeredAt,
    muted: parallelSession.muted,
  })
})

// No start, antes de subir o servidor, tenta se atualizar sozinho contra o Blue Line.
// Se houver versão nova, sobrescreve e sai com 42 — o start.bat reabre no código novo.
// Como após o restart HELPER_VERSION passa a bater com o remoto, não há loop.
async function maybeAutoUpdate() {
  // Trava de teste: HELPER_NO_UPDATE=1 impede a auto-atualizacao no start, para rodar um
  // helper editado localmente sem o Blue Line remoto (versao antiga) sobrescrever o codigo.
  if (process.env.HELPER_NO_UPDATE) return
  const base = bluelineBaseUrl()
  if (!base) return
  try {
    const { code, version } = await fetchLatest(base)
    if (version !== HELPER_VERSION) {
      console.log(`Versao nova encontrada (${HELPER_VERSION} -> ${version}). Atualizando...`)
      applyUpdate(code)
      process.exit(UPDATE_EXIT_CODE)
    }
  } catch {
    // sem rede / Blue Line fora do ar / origem ainda não conhecida — segue com a versão atual
  }
}

async function main() {
  await maybeAutoUpdate()

  const server = app.listen(PORT, '127.0.0.1', () => {
    console.log('=================================')
    console.log(` Blue Line Helper v${HELPER_VERSION}`)
    console.log(` http://localhost:${PORT}`)
    console.log('=================================')
    if (MICROSIP) {
      console.log(` MicroSIP encontrado: ${MICROSIP}`)
    } else {
      console.log(' MicroSIP NAO encontrado no disco — usando protocolo tel: (fallback)')
      console.log(' Se a discagem nao funcionar, defina MICROSIP_PATH apontando para o microsip.exe')
    }
    if (DIAL_PREFIX) console.log(` Prefixo de discagem (CSP): "${DIAL_PREFIX}" — disca ${DIAL_PREFIX} + DDD + numero`)
    console.log('Aguardando chamadas do Blue Line...')
    console.log('')
    startMicrosipHider()
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
