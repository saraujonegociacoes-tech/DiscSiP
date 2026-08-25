const express = require('express')
const http = require('http')
const { exec, spawn } = require('child_process')
const fs = require('fs')
const path = require('path')
const app = express()

const PORT = 3001

// Versão do helper. É o que o Blue Desk compara para saber se está desatualizado e
// oferecer o botão "Atualizar". Suba este número a cada correção no helper.
const HELPER_VERSION = '1.16'

// Código de seleção de operadora (CSP) para discagem interurbana. Sem ele o MicroSIP
// não completa chamadas para outros estados. Resultado: DIAL_PREFIX + DDD + número.
// Configurável por env (default 021); muda só se trocar de operadora de longa distância.
const DIAL_PREFIX = process.env.DIAL_PREFIX || '021'

// Silêncio no toque: o agente não ouve NADA enquanto disca/toca (ringback das N linhas do
// lote, caixa postal que atende antes do corte, toque de chamada recebida) e o som abre no
// instante em que alguém ATENDE. Vale para lote, 1-a-1 e discagem manual.
// AUTO_MUTE_RING=0 desliga e devolve o comportamento antigo (som sempre aberto).
const AUTO_MUTE_RING = process.env.AUTO_MUTE_RING !== '0'

// Entre uma chamada e outra o softphone fica MUDO (é o que faz o toque de uma chamada
// RECEBIDA também não soar — o pedido era "som só quando atender"). Quem precisar ouvir a
// campainha de entrada põe AUTO_MUTE_IDLE=0: aí o silêncio vale só do discar até o atendimento.
const AUTO_MUTE_IDLE = AUTO_MUTE_RING && process.env.AUTO_MUTE_IDLE !== '0'

// Quanto esperamos o worker do mute responder antes de cair no spawn avulso.
const MUTE_WORKER_TIMEOUT_MS = Number(process.env.MUTE_WORKER_TIMEOUT_MS) || 700

// Onde o helper busca a versão nova de si mesmo. Em runtime preferimos a origem que o
// próprio Blue Desk manda no header Origin (persistida em helper-config.json) — assim não
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

// Base do Blue Desk para auto-atualização: env > último Origin visto > nada.
function bluedeskBaseUrl() {
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

// Dois números são "o mesmo" se os dígitos batem, ou se um termina com os últimos 8 dígitos do
// outro. O MicroSIP nem sempre devolve o número no formato em que foi discado (pode vir sem o
// CSP, com o domínio SIP junto), e um evento que não casa é um evento perdido.
function sameNumber(a, b) {
  const x = digitsOf(a)
  const y = digitsOf(b)
  if (!x || !y) return false
  if (x === y) return true
  const tail = x.slice(-8)
  return tail.length >= 8 && y.endsWith(tail)
}

// Timestamp curto para os logs do helper.
function ts() {
  return new Date().toLocaleTimeString()
}

// ─── Log em arquivo ──────────────────────────────────────────────────────────────
// O helper roda oculto (start-hidden.vbs), então o stdout ia para lugar nenhum: quando algo
// dava errado em ligação real, não sobrava evidência — só o que estivesse na memória do
// processo. Agora tudo que vai para o console também vai para helper.log, com timestamp em
// MILISSEGUNDOS (o log de tela tem resolução de segundo, que não serve para investigar
// corrida entre chamadas). Rotaciona simples: passou de 2 MB, vira helper.log.old.
const LOG_PATH = path.join(__dirname, 'helper.log')
let logStream = null
function initFileLog() {
  try {
    if (fs.existsSync(LOG_PATH) && fs.statSync(LOG_PATH).size > 2 * 1024 * 1024) {
      fs.renameSync(LOG_PATH, `${LOG_PATH}.old`)
    }
    logStream = fs.createWriteStream(LOG_PATH, { flags: 'a' })
    const write = (nivel, args) => {
      try {
        logStream.write(`${new Date().toISOString()} ${nivel} ${args.join(' ')}\n`)
      } catch {
        // disco cheio/sem permissão não pode derrubar o helper
      }
    }
    for (const nivel of ['log', 'error', 'warn']) {
      const original = console[nivel].bind(console)
      console[nivel] = (...args) => {
        original(...args)
        write(nivel.toUpperCase(), args)
      }
    }
  } catch {
    // sem log em arquivo — o helper continua funcionando normalmente
  }
}

app.use(express.json())

// CORS para permitir chamadas do Blue Desk (HTTPS → localhost). De quebra, todo request
// do navegador traz o header Origin = domínio do Blue Desk: guardamos para a auto-atualização.
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

// ─── microsip.ini: leitura e patch ───────────────────────────────────────────────
// A discagem preditiva SÓ funciona com o MicroSIP em multi-call (`singleMode=0`). Com
// `singleMode=1` (modo de chamada única) ele recusa/derruba a 2ª chamada, então o lote de N
// vira uma ligação só — a preditiva "não funciona" mesmo com todo o resto certo. O instalador
// nunca configurou essa chave, então em máquina nova ela fica no default e o modo paralelo
// nasce quebrado. Aqui o helper lê e (sob demanda) corrige o ini.

// Resolvido a cada uso, não fixado no start: numa máquina onde o MicroSIP ainda não rodou o
// ini nem existe, e passa a existir depois — o helper precisa enxergar sem reiniciar.
function microsipIniPath() {
  if (process.env.MICROSIP_INI && fs.existsSync(process.env.MICROSIP_INI)) {
    return process.env.MICROSIP_INI
  }
  const candidates = [
    path.join(process.env.APPDATA || '', 'MicroSIP', 'microsip.ini'),
    // instalação portátil: o ini fica ao lado do .exe
    MICROSIP ? path.join(path.dirname(MICROSIP), 'microsip.ini') : null,
  ]
  return candidates.find((p) => p && fs.existsSync(p)) || null
}

// O ini do MicroSIP é UTF-16 LE com BOM. Lemos e regravamos na MESMA codificação — gravar em
// UTF-8 faz o MicroSIP ler lixo e perder as configurações (inclusive a conta SIP).
function readIni() {
  const iniPath = microsipIniPath()
  if (!iniPath) return null
  try {
    const buf = fs.readFileSync(iniPath)
    const utf16 = buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe
    let text = buf.toString(utf16 ? 'utf16le' : 'utf8')
    // O BOM vira um caractere no início da string e "gruda" na primeira linha, quebrando
    // qualquer regex ancorada em ^ (era o que impedia achar o [Settings] e fazia o patch
    // acrescentar uma segunda seção no fim do arquivo). Tira aqui, devolve na gravação.
    const bom = text.charCodeAt(0) === 0xfeff
    if (bom) text = text.slice(1)
    return { text, utf16, bom }
  } catch {
    return null
  }
}

function iniValue(text, key) {
  const m = text.match(new RegExp(`^${key}=(.*)$`, 'm'))
  return m ? m[1].trim().replace(/^"|"$/g, '') : null
}

// true = multi-call confirmado; false = single mode (preditiva não funciona);
// null = não deu para ler o ini (não afirmamos nada). Chave ausente conta como NÃO confirmado,
// porque o default varia por versão/instalação — melhor gravar o `0` explícito.
function multiCallEnabled() {
  const ini = readIni()
  if (!ini) return null
  return iniValue(ini.text, 'singleMode') === '0'
}

// Reescreve chaves do [Settings]. Faz backup (.bak) antes. Só deve ser chamado com o MicroSIP
// FECHADO: ele reescreve o ini inteiro ao sair e apagaria a alteração.
function patchIni(map) {
  const iniPath = microsipIniPath()
  const ini = readIni()
  if (!ini || !iniPath) return { ok: false, error: 'microsip.ini nao encontrado ou ilegivel' }
  let text = ini.text
  for (const [k, v] of Object.entries(map)) {
    const line = `${k}=${v}`
    const re = new RegExp(`^${k}=.*$`, 'm')
    // replacement como função: evita que `$` no valor seja interpretado pelo regex
    if (re.test(text)) text = text.replace(re, () => line)
    else if (/^\[Settings\].*$/m.test(text)) text = text.replace(/^\[Settings\].*$/m, (s) => `${s}\r\n${line}`)
    else text = `${text.replace(/\s*$/, '')}\r\n[Settings]\r\n${line}\r\n`
  }
  try {
    fs.copyFileSync(iniPath, `${iniPath}.bak`)
    const out = (ini.bom ? String.fromCharCode(0xfeff) : '') + text
    fs.writeFileSync(iniPath, Buffer.from(out, ini.utf16 ? 'utf16le' : 'utf8'))
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

function isMicrosipRunning() {
  return new Promise((resolve) => {
    // windowsHide (v1.15): sem isso o `exec` roda `cmd.exe /c` COM console e PISCA uma janela
    // preta na cara do agente. Como enableMultiCall chama isto em loop a cada 400ms, viravam
    // várias piscadas seguidas — parte do "o helper não fica escondido".
    exec('tasklist /FI "IMAGENAME eq microsip.exe" /NH', { windowsHide: true }, (err, stdout) => {
      resolve(!err && /microsip\.exe/i.test(stdout || ''))
    })
  })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Liga o multi-call. Se o MicroSIP estiver aberto, fecha (/exit), espera sair, corrige o ini e
// reabre — é a única ordem que sobrevive, porque ao sair ele regrava o ini por cima.
async function enableMultiCall() {
  if (!microsipIniPath()) return { ok: false, error: 'microsip.ini nao encontrado' }
  if (parallelSession && !parallelSession.finished) {
    return { ok: false, error: 'ha um lote de discagem em andamento' }
  }
  const running = await isMicrosipRunning()
  if (running) {
    runMsip('/exit')
    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      await sleep(400)
      if (!(await isMicrosipRunning())) break
    }
    if (await isMicrosipRunning()) {
      return { ok: false, error: 'nao foi possivel fechar o MicroSIP (feche manualmente e tente de novo)' }
    }
  }
  const patched = patchIni({ singleMode: '0' })
  if (!patched.ok) return patched
  if (running && MICROSIP) {
    // Pela fila também (v1.15): reabrir o MicroSIP logo depois de gravar o ini era outra
    // chance de dois processos tocarem no arquivo ao mesmo tempo.
    queueMsip([])
    // MicroSIP reiniciado = processo NOVO = sessao de audio nova, sem mute. Rearma o silencio.
    reapplySpeakerState([1500, 3000])
  }
  console.log(`[${ts()}] MicroSIP: multi-call LIGADO (singleMode=0)${running ? ' + reiniciado' : ''}`)
  return { ok: true, restarted: running }
}

// Último evento de chamada recebido do MicroSIP (via cmdCallStart/cmdCallEnd no microsip.ini).
// O Blue Desk faz polling em /events para reagir (mostrar tabulação, cronômetro real).
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

// ─── Fila única de invocações do microsip.exe ────────────────────────────────────
// TODA vez que falamos com o MicroSIP — discar ou mandar comando — nasce um microsip.exe
// novo, que entrega a mensagem via WM_COPYDATA e sai. O problema: ao subir e sair, esse
// processo TOCA no microsip.ini (histórico de discados), e a instância principal também
// escreve lá. Dois processos escrevendo junto = modal "Failed to open file for writing
// ...microsip.ini", que ainda CONGELA a fila de comandos do MicroSIP.
//
// Isso já era conhecido para a rajada de discagem (havia um stagger de 300ms só nos dials),
// mas o mesmo estouro aparecia no ATENDIMENTO: ali saíam dois comandos no mesmo milissegundo
// (speakunmute + hangupcalling) enquanto a instância principal gravava a chamada atendida.
// Agora existe UMA fila global: nenhum microsip.exe nasce a menos de MSIP_MIN_GAP_MS do
// anterior, valendo para discagens e comandos. Custo no pior caso: ~300ms de atraso no
// /hangupcalling — desprezível perto dos 15-30s de toque.
const MSIP_MIN_GAP_MS = Number(process.env.MSIP_MIN_GAP_MS) || 300
let msipChain = Promise.resolve()
let lastMsipAt = 0

// `onSpawn` roda no instante REAL do disparo (não no enfileiramento) — é o que mantém o
// tempo-até-atender honesto quando a linha esperou a vez na fila.
function queueMsip(args, onSpawn) {
  if (!MICROSIP) return false
  msipChain = msipChain.then(async () => {
    const wait = MSIP_MIN_GAP_MS - (Date.now() - lastMsipAt)
    if (wait > 0) await sleep(wait)
    const gap = lastMsipAt ? Date.now() - lastMsipAt : 0
    lastMsipAt = Date.now()
    // HELPER_DEBUG_MSIP=1 imprime o intervalo real entre lançamentos, em ms. É o que permite
    // conferir que dois microsip.exe não nascem juntos (a causa do modal do .ini) — o log
    // normal tem resolução de segundo, que não serve para isso.
    if (process.env.HELPER_DEBUG_MSIP) {
      console.log(`[msip] +${String(gap).padStart(4)}ms  ${args.join(' ')}`)
    }
    try {
      if (onSpawn) onSpawn()
      const child = spawn(MICROSIP, args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      })
      child.on('error', () => {})
      child.unref()
    } catch {
      // um comando que falha não pode travar a fila dos próximos
    }
  })
  return true
}

// Roda um comando de controle do MicroSIP (ex: "msip:hangupall"). A instância em execução
// recebe via WM_COPYDATA e executa, sem trazer a janela para frente.
function runMsip(arg) {
  return queueMsip([arg])
}

// ─── Mute do ALTO-FALANTE no nível do Windows ────────────────────────────────────
// Por que não usamos msip:speakmute: no fonte do MicroSIP ele só zera o RX dos conf ports
// das CHAMADAS já conectadas (lib/MSIP.cpp msip_audio_conf_set_volume) — NÃO cala o ringback
// do "discando N" (toca num tom separado) nem chamadas que conectam depois. Mutar a SESSÃO de
// áudio do microsip.exe no mixer do Windows silencia TUDO que ele emite, em qualquer estado e
// sem mostrar janela. Usa Core Audio (ISimpleAudioVolume) via PowerShell + Add-Type — mesmo
// padrão do hider, zero dependência. Estado desejado fica em speakerMuted e é reaplicado a cada
// discagem (uma sessão nova pode nascer com a chamada). Awaitado: a UI só vira o botão se aplicou.
// Fonte C# do mute por sessão de áudio. Fica separada do script que a usa porque é compilada
// nos DOIS caminhos: o worker persistente (rápido) e o spawn avulso (fallback).
const MUTE_CS = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] public class MMDevEnum { }
[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] public interface IMMDeviceEnumerator { int EnumAudioEndpoints(int dataFlow,int stateMask,out IMMDeviceCollection col); int GetDefaultAudioEndpoint(int dataFlow,int role,out IMMDevice dev); }
[ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] public interface IMMDeviceCollection { int GetCount(out int c); int Item(int i,out IMMDevice dev); }
[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] public interface IMMDevice { int Activate(ref Guid iid,int ctx,IntPtr p,[MarshalAs(UnmanagedType.IUnknown)] out object o); }
[ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] public interface IAudioSessionManager2 { int f0(IntPtr a,int b,out IntPtr c); int f1(IntPtr a,int b,out IntPtr c); int GetSessionEnumerator(out IAudioSessionEnumerator e); }
[ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] public interface IAudioSessionEnumerator { int GetCount(out int c); int GetSession(int i,out IAudioSessionControl2 s); }
[ComImport, Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] public interface IAudioSessionControl2 {
  int GetState(out int s);
  int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string s);
  int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string s, ref Guid c);
  int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string s);
  int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string s, ref Guid c);
  int GetGroupingParam(out Guid g);
  int SetGroupingParam(ref Guid g, ref Guid c);
  int RegisterAudioSessionNotification(IntPtr n);
  int UnregisterAudioSessionNotification(IntPtr n);
  int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string s);
  int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string s);
  int GetProcessId(out uint pid);
  int IsSystemSoundsSession();
  int SetDuckingPreference(bool b);
}
[ComImport, Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] public interface ISimpleAudioVolume {
  int SetMasterVolume(float l, ref Guid c);
  int GetMasterVolume(out float l);
  int SetMute(bool m, ref Guid c);
  int GetMute(out bool m);
}
public static class AppMute {
  public static int Set(bool mute) {
    int hit = 0;
    var ids = new System.Collections.Generic.HashSet<uint>();
    foreach (var p in System.Diagnostics.Process.GetProcessesByName("microsip")) ids.Add((uint)p.Id);
    if (ids.Count == 0) return 0;
    var en = (IMMDeviceEnumerator)(new MMDevEnum());
    IMMDeviceCollection col;
    if (en.EnumAudioEndpoints(0,1,out col) != 0) return 0;
    int dcount; col.GetCount(out dcount);
    Guid iid = typeof(IAudioSessionManager2).GUID;
    Guid ev = Guid.Empty;
    for (int d=0; d<dcount; d++){
      IMMDevice dev;
      if (col.Item(d,out dev)!=0) continue;
      object o;
      if (dev.Activate(ref iid,1,IntPtr.Zero,out o)!=0) continue;
      var mgr = (IAudioSessionManager2)o;
      IAudioSessionEnumerator se;
      if (mgr.GetSessionEnumerator(out se)!=0) continue;
      int count; se.GetCount(out count);
      for (int i=0;i<count;i++){
        IAudioSessionControl2 ctl;
        if (se.GetSession(i,out ctl)!=0) continue;
        uint pid;
        if (ctl.GetProcessId(out pid)!=0) continue;
        if (ids.Contains(pid)) { ((ISimpleAudioVolume)ctl).SetMute(mute, ref ev); hit++; }
      }
    }
    return hit;
  }
}
"@
`

const psEncode = (s) => Buffer.from(s, 'utf16le').toString('base64')

// Spawn avulso: um powershell.exe por comando. Era o único caminho até a v1.15; segue aqui
// como fallback de quando o worker persistente não sobe (ou morre no meio da operação).
function muteOneShot(muted) {
  return new Promise((resolve) => {
    const script = `
$ErrorActionPreference = 'Stop'
${MUTE_CS}
$n = [AppMute]::Set(${muted ? '$true' : '$false'})
Write-Output ("HIT:" + $n)
`
    try {
      const child = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', psEncode(script)],
        { windowsHide: true }
      )
      let out = ''
      child.stdout.on('data', (d) => (out += d.toString()))
      child.on('error', () => resolve({ ok: false, applied: 0 }))
      child.on('close', () => {
        const m = out.match(/HIT:(\d+)/)
        resolve({ ok: !!m, applied: m ? Number(m[1]) : 0 })
      })
    } catch {
      resolve({ ok: false, applied: 0 })
    }
  })
}

// ─── Worker persistente do mute ─────────────────────────────────────────────────
// Por que um processo VIVO em vez de um powershell.exe por comando: o `Add-Type` compila C#
// em runtime e custa ~1s por spawn (medido nesta máquina). Isso é irrelevante para o botão do
// painel de áudio, mas FATAL para o desmute no atendimento — o agente perderia o "alô" e o
// primeiro segundo da conversa, justamente o pedaço que decide a ligação. O worker compila o
// tipo UMA vez, na largada do helper, e daí cada mute/desmute é uma linha no stdin dele:
// milissegundos. Se cair, o próximo comando volta sozinho pelo spawn avulso.
let muteWorker = null
let workerReady = false
let muteSeq = 0
const mutePending = new Map()

function startMuteWorker() {
  if (muteWorker) return muteWorker
  const script = `
$ErrorActionPreference = 'Stop'
${MUTE_CS}
[Console]::Out.WriteLine("READY")
[Console]::Out.Flush()
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  if ($line -eq 'quit') { break }
  # protocolo: "<id> <0|1>" -> "HIT:<id>:<n>". O id existe para a resposta casar com o pedido
  # CERTO: pareando por ORDEM, um unico timeout desalinhava a fila para sempre.
  $parts = $line.Split(' ')
  try { $n = [AppMute]::Set($parts[1] -eq '1') } catch { $n = -1 }
  [Console]::Out.WriteLine("HIT:" + $parts[0] + ":" + $n)
  [Console]::Out.Flush()
}
`
  try {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', psEncode(script)],
      { windowsHide: true }
    )
    let buf = ''
    child.stdout.on('data', (d) => {
      buf += d.toString()
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim()
        buf = buf.slice(i + 1)
        if (line === 'READY') {
          // Só a partir daqui o worker serve: antes, o `Add-Type` ainda está compilando e o
          // comando ficaria parado no buffer do stdin — que era como o PRIMEIRO mute (o do
          // boot) estourava o timeout e desalinhava a fila.
          workerReady = true
          continue
        }
        const m = line.match(/^HIT:(\d+):(-?\d+)$/)
        if (!m) continue
        const done = mutePending.get(m[1])
        if (!done) continue
        mutePending.delete(m[1])
        const n = Number(m[2])
        done({ ok: n >= 0, applied: Math.max(0, n) })
      }
    })
    const die = () => {
      if (muteWorker === child) muteWorker = null
      workerReady = false
      for (const [id, done] of mutePending) {
        mutePending.delete(id)
        done(null)
      }
    }
    child.on('error', die)
    child.on('close', die)
    child.stdin.on('error', () => {})
    child.stderr.on('data', () => {})
    child.unref()
    muteWorker = child
    return child
  } catch {
    return null
  }
}

// Resolve com null quando o worker não está disponível ou demorou — aí quem chama usa o avulso.
function muteViaWorker(muted) {
  return new Promise((resolve) => {
    const w = startMuteWorker()
    // Worker ainda compilando (ou caído): não vale esperar — resolve null e quem chama vai de
    // spawn avulso, que é lento mas responde. O worker segue esquentando para os próximos.
    if (!w || !workerReady || !w.stdin || !w.stdin.writable) return resolve(null)
    const id = String(++muteSeq)
    let settled = false
    const finish = (r) => {
      if (settled) return
      settled = true
      mutePending.delete(id)
      resolve(r)
    }
    mutePending.set(id, finish)
    setTimeout(() => finish(null), MUTE_WORKER_TIMEOUT_MS)
    try {
      w.stdin.write(`${id} ${muted ? '1' : '0'}\n`)
    } catch {
      finish(null)
    }
  })
}

// Estado do alto-falante = mute MANUAL (botão do painel) OU mute AUTOMÁTICO (silêncio de
// toque). São flags separadas de propósito: o automático não pode desfazer a escolha do
// agente, e o botão do painel continua refletindo só essa escolha.
let speakerMuted = false
let autoMuted = false

async function setMicrosipSpeakerMuted(muted) {
  const viaWorker = await muteViaWorker(muted)
  return viaWorker || muteOneShot(muted)
}

// Aplica o estado efetivo na(s) sessão(ões) de áudio do microsip.exe.
function applySpeakerState() {
  return setMicrosipSpeakerMuted(speakerMuted || autoMuted)
}

// Sessão de áudio NOVA nasce sem mute, e ela só aparece quando a chamada já está saindo — por
// isso o estado é reaplicado algumas vezes depois de discar, em vez de uma só. Cada reaplicação
// lê as flags do momento: se alguém já atendeu no meio do caminho, ela ABRE o som em vez de
// mutar. É o que deixa a ordem "disca / atende / reaplica" segura.
function reapplySpeakerState(delays) {
  delays.forEach((ms) => setTimeout(() => applySpeakerState(), ms))
}

// ─── Guarda do silêncio enquanto TOCA ───────────────────────────────────────────
// O mute vale por SESSÃO de áudio do Windows, e a sessão do MicroSIP só nasce quando ele abre
// o áudio de verdade — o que pode ser segundos depois do disparo, e de novo a cada chamada.
// Sessão nova nasce SEM mute. Apostar em instantes fixos ("reaplica em 250ms e 1700ms") acerta
// no lote de hoje e erra no de amanhã; então, em vez de apostar, reaplicamos ENQUANTO toca.
// Custa uma linha no worker (~45ms) por passada e para sozinho: no atendimento (autoMuted vira
// false), quando nada mais está tocando, ou no teto do corte de toque.
// Sem worker pronto a guarda não roda — ali cada passada seria um powershell.exe novo.
let ringGuard = null
function startRingGuard() {
  if (!AUTO_MUTE_RING || ringGuard) return
  const started = Date.now()
  // Quantas sessoes a ultima passada mutou. Serve para o log so falar quando MUDA — que e
  // exatamente o instante interessante: a sessao da chamada nasceu e o silencio pegou nela.
  let ultimoAplicado = -1
  ringGuard = setInterval(() => {
    const tocando =
      (parallelSession &&
        !parallelSession.finished &&
        Object.values(parallelSession.calls).some((s) => s === 'calling')) ||
      (lastSingleCall && !lastSingleCall.answered && !lastSingleCall.ended)
    if (!autoMuted || !tocando || Date.now() - started > RING_CUTOFF_MS + 10000) {
      clearInterval(ringGuard)
      ringGuard = null
      return
    }
    if (!workerReady) return
    applySpeakerState().then((r) => {
      if (r.applied === ultimoAplicado && !process.env.RING_GUARD_DEBUG) return
      ultimoAplicado = r.applied
      console.log(`[${ts()}] Guarda de toque: silencio reaplicado em ${r.applied} sessao/oes`)
    })
  }, 700)
}

// Liga/desliga o silêncio de toque. No-op quando já está no estado pedido — a rajada de N
// linhas chama isto N vezes e não custa nada.
function setRingSilence(on, motivo) {
  if (!AUTO_MUTE_RING || autoMuted === on) return Promise.resolve({ ok: true, applied: 0 })
  autoMuted = on
  return applySpeakerState().then((r) => {
    // `applied` = quantas sessões de áudio do microsip.exe foram tocadas. ZERO quer dizer que o
    // MicroSIP não tinha áudio aberto naquele instante: o mute não pegou em nada, e quem cobre
    // esse buraco é a guarda de toque. Fica no log porque é o número que diz se o silêncio
    // realmente aconteceu — sem ele, "não funcionou" vira adivinhação.
    console.log(
      `[${ts()}] Som ${on ? 'MUDO' : 'ABERTO'} (${motivo}) — ${r.applied} sessao/oes` +
        `${r.applied === 0 ? ' [nenhuma sessao de audio do MicroSIP no momento]' : ''}` +
        `${speakerMuted ? ' [mute manual do agente segue ligado]' : ''}`
    )
    return r
  })
}

// Há conversa em curso? Serve para NÃO remutar no meio dela quando as outras linhas do lote
// terminam de cair (elas caem logo depois de o vencedor atender).
function anyLiveCall() {
  if (parallelSession && Object.values(parallelSession.calls).some((s) => s === 'answered')) return true
  if (lastSingleCall && lastSingleCall.answered && !lastSingleCall.ended) return true
  return false
}

// ─── Discagem paralela / preditiva ───────────────────────────────────────────────
// Disca N números ao mesmo tempo, conecta o 1º que ATENDE e derruba os que ainda tocam
// (/hangupcalling, que poupa a chamada já CONFIRMED). Todo disparo passa pela fila única
// (queueMsip) para dois microsip.exe nunca nascerem juntos e brigarem pelo .ini.
// A janela do MicroSIP volta a aparecer ao discar em multi-call; esconder isso é opcional e
// está DESLIGADO por padrão (ver startMicrosipHider).
let parallelSession = null

// Teto de vida de um lote paralelo. Um toque real dura ~15-30s antes do "nao atende"; passado
// isso com linha ainda 'calling', o evento se perdeu — ver o watchdog em /dial-parallel.
// Configurável por env só para teste (o default é o que roda em produção).
const PARALLEL_TIMEOUT_MS = Number(process.env.PARALLEL_TIMEOUT_MS) || 90000

// ─── Corte de toque (anti caixa postal) ──────────────────────────────────────────
// A caixa postal da operadora atende com 200 OK igual a um humano — para o SIP são
// indistinguíveis, e sem AMD no PABX não há como saber. O que dá para fazer sem o PABX é
// NÃO DEIXAR a chamada chegar até ela: a caixa entra tipicamente entre 25 e 30s de toque,
// então derrubamos a linha antes disso.
//
// ATENÇÃO à diferença que justifica isto existir: NÃO é o `autoHangUpTime` do MicroSIP (aquele
// é cego e mata conversa já atendida). Aqui só morre linha que ainda está TOCANDO — o comando
// é `/hangupcalling`, que por definição poupa a chamada CONFIRMED. Nenhuma conversa em curso
// pode cair por causa deste timer.
//
// O custo é perder quem demora mais que isto para atender; por isso esses contatos são
// tabulados como 'abandoned' (derrubados por nós, não recusaram) e voltam pela reciclagem.
const RING_CUTOFF_MS = Number(process.env.RING_CUTOFF_MS) || 20000

// ─── Piso de atendimento (anti caixa postal INSTANTÂNEA) ─────────────────────────
// O corte de toque cobre a caixa postal que entra DEPOIS do toque (~25-30s). Existe o caso
// oposto, visto em teste real: número com bloqueio de spam, aparelho desligado ou fora de área
// cai na caixa/anúncio da operadora em 1-3s, ANTES de o telefone tocar de verdade. Para o SIP
// é um `200 OK` normal, então ele VENCE a corrida do lote e derruba as outras linhas — que
// podiam ser gente. É o pior desfecho possível: queima o lote e entrega uma gravação ao agente.
//
// ⚠️ DESLIGADO POR PADRÃO (0). Nasceu da hipótese de que bloqueio de spam atende em 1-3s —
// e a MEDIÇÃO em ligação real DESMENTIU isso: o caso observado atendeu em **8,9s**, tempo em
// que um humano atende normalmente. Ou seja, tempo NÃO separa esse caso, e deixar o piso
// armado só cria risco de descartar pessoa de verdade sem resolver o problema que motivou.
//
// O mecanismo continua aqui porque existe o caso genuinamente instantâneo (anúncio de "número
// inexistente", por exemplo). Só que não deve ficar ligado por palpite: primeiro medir. Se o
// `abaixoDoPiso` do /answer-times mostrar atendimentos instantâneos de verdade na operação,
// ligue com MIN_ANSWER_MS=3000 (ou o valor que o dado indicar).
const MIN_ANSWER_MS = Number(process.env.MIN_ANSWER_MS) || 0

// Amostras de tempo-até-atender (ms), para calibrar o RING_CUTOFF_MS com dado real em vez de
// chute: humano se espalha pela faixa toda, caixa postal se concentra num valor fixo. Só na
// memória (nada de banco) e limitado — é material de ajuste, não histórico.
const answerTimes = []
const ANSWER_TIMES_MAX = 500

function recordAnswerTime(ms) {
  answerTimes.push(ms)
  if (answerTimes.length > ANSWER_TIMES_MAX) answerTimes.shift()
}

// Última discagem AVULSA (/call: discagem manual e power dialer 1-a-1). Sem isto, só o modo
// paralelo alimentava o /answer-times — e é justamente discando um número por vez que se
// coleta a amostra mais limpa para calibrar o corte de toque.
let lastSingleCall = null

function handleSingleAnswer(evNumber) {
  if (!lastSingleCall || lastSingleCall.answered) return
  if (!sameNumber(evNumber, lastSingleCall.dial)) return
  lastSingleCall.answered = true
  setRingSilence(false, `${lastSingleCall.dial} atendeu`)
  const ms = Date.now() - lastSingleCall.at
  recordAnswerTime(ms)
  console.log(
    `[${ts()}] ${lastSingleCall.dial} atendeu em ${(ms / 1000).toFixed(1)}s` +
      `${ms >= RING_CUTOFF_MS ? ' (acima do corte de toque — provavel caixa postal)' : ''}`
  )
}

// Fecha a chamada avulsa. Existe para o `anyLiveCall` saber que não há mais conversa em curso
// — é o que autoriza o silêncio a voltar quando a ligação termina.
function handleSingleEnd(evNumber) {
  if (!lastSingleCall || lastSingleCall.ended) return
  if (!sameNumber(evNumber, lastSingleCall.dial)) return
  lastSingleCall.ended = true
}

// Hider PERSISTENTE da janela do MicroSIP. Em multi-call o MicroSIP REEXIBE a janela a cada
// evento (discar / atender / derrubar) e durante a propria conversa, entao esconder em rajada
// deixa brechas (foi o que vimos: o handle voltou a !=0 no meio do toque). Em vez disso, um
// PowerShell OCULTO fica em loop (~250ms) escondendo QUALQUER janela visivel do microsip
// enquanto o helper estiver vivo. Usa ShowWindow(SW_HIDE) via Win32 — sem dependencia nativa,
// so o powershell.exe que existe em todo Windows. O loop embute o PID do helper e termina
// sozinho quando o helper morre (nao deixa processo orfao). Comando vai como -EncodedCommand
// (base64 UTF-16LE).
// ⚠️ LIGADO POR PADRÃO de novo (v1.15). Histórico: nasceu ligado, virou opt-in na v1.9 (durante
// a configuração do MicroSIP, esconder a janela impedia o próprio administrador de abrir o
// softphone). Essa fase acabou e o efeito colateral apareceu em produção: a janela do MicroSIP
// aparecendo na frente do agente no meio da operação. Volta a ser opt-OUT — desligue com
// HELPER_NO_HIDE=1 quando precisar mexer no softphone.
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

// NOTA: o `msip:speakmute`/`speakunmute` foi REMOVIDO do fluxo paralelo (v1.12).
// Ele nunca cumpriu o papel que se esperava: no fonte do MicroSIP (lib/MSIP.cpp) só zera o RX
// dos conf ports de chamadas JÁ CONECTADAS, ou seja, não cala o ringback do "discando N" —
// exatamente o que se queria silenciar (achado registrado em
// ../../docs/discadora-docs/fixes/correcoes-producao-2026-06.md, item #4).
// Era, portanto, um comando inócuo que custava DOIS microsip.exe por lote, um deles disparado
// no instante do atendimento — bem no meio da janela em que a instância principal grava o ini.
// Foi essa colisão que produziu o modal "Failed to open file for writing microsip.ini".
// Quem silencia o alto-falante de verdade é o mute no nível do Windows (setMicrosipSpeakerMuted,
// endpoint /mute), acionado pelo agente no painel de áudio.

// Acha, na sessão atual, o número discado que casa com o número do evento (por dígitos).
// Igualdade exata primeiro; se falhar, casa pelo SUFIXO (últimos 8 dígitos). O MicroSIP nem
// sempre devolve o número no mesmo formato em que foi discado (pode vir sem o CSP, com o
// domínio SIP junto etc.) — e um evento que não casa deixaria a linha eternamente em
// 'calling', travando o lote inteiro ("Discando 3…" para sempre).
function matchParallelNumber(evNumber) {
  if (!parallelSession) return null
  return parallelSession.numbers.find((n) => sameNumber(evNumber, n)) || null
}

// 1º atendimento vence: registra o vencedor e derruba as que ainda tocam.
// Dispara no instante do call-start (sub-100ms) — estreita a janela de abandono.
function handleParallelAnswer(evNumber) {
  if (!parallelSession || parallelSession.resolved) return
  const num = matchParallelNumber(evNumber)
  if (!num) return

  // Tempo do disparo DESTA linha até o atendimento (as linhas saem escalonadas, então não dá
  // para medir a partir do início do lote). Alimenta o /answer-times.
  const dialedAt = parallelSession.dialedAt[num]
  const ms = dialedAt ? Date.now() - dialedAt : null
  if (ms !== null) recordAnswerTime(ms)

  // Atendimento instantâneo demais para ser gente: bloqueio de spam / aparelho desligado /
  // caixa direta. Se deixarmos virar vencedor, ele derruba as outras linhas — que podiam ser
  // pessoas — e entrega uma gravação ao agente. Em vez disso, descarta o lote INTEIRO e deixa
  // a fila puxar um lote novo: o agente nem chega a ver.
  // Aqui é `msip:hangupall` de propósito (e não `/hangupcalling`): a linha suspeita JÁ está
  // atendida, então o hangupcalling não a derrubaria — e o lote todo está sendo descartado.
  if (ms !== null && ms < MIN_ANSWER_MS) {
    parallelSession.resolved = true
    parallelSession.calls[num] = 'machine'
    for (const k of Object.keys(parallelSession.calls)) {
      if (parallelSession.calls[k] === 'calling') parallelSession.calls[k] = 'cut'
    }
    parallelSession.finished = true
    parallelSession.instantAnswer = true
    runMsip('msip:hangupall')
    console.log(
      `[${ts()}] PARALELO #${parallelSession.id}: ${num} atendeu em ${(ms / 1000).toFixed(1)}s ` +
        `(abaixo do piso de ${MIN_ANSWER_MS / 1000}s = maquina) -> lote descartado`
    )
    return
  }

  parallelSession.resolved = true
  parallelSession.winner = num
  parallelSession.answeredAt = new Date().toISOString()
  parallelSession.calls[num] = 'answered'
  // Som ANTES do hangup: o desmute é uma linha no worker (ms), enquanto o /hangupcalling ainda
  // espera a vez na fila do microsip.exe. Nesta ordem o agente ouve o "alô" inteiro.
  setRingSilence(false, `${num} atendeu`)
  runMsip('/hangupcalling')
  console.log(
    `[${ts()}] PARALELO #${parallelSession.id}: ${num} ATENDEU` +
      `${ms !== null ? ` em ${(ms / 1000).toFixed(1)}s` : ''} -> /hangupcalling`
  )
}

// Marca o término de uma das linhas e fecha o lote quando ninguém mais está tocando.
function handleParallelEnd(evNumber, state) {
  if (!parallelSession) return
  const num = matchParallelNumber(evNumber)
  if (!num) return
  // Atualiza o estado da linha INCLUSIVE o vencedor: quando o vencedor (que estava 'answered')
  // recebe seu call-end, vira 'ended' — é assim que a UI sabe que a conversa acabou e mostra a
  // disposição. O call-end dos derrubados afeta só a entrada deles (match por número).
  // Linha já marcada como 'cut' (derrubada por NÓS no corte de toque) mantém a marca: o
  // call-end que chega logo depois é consequência do nosso hangup, não do destino ter
  // desistido. É o que diferencia 'abandoned' (nossa) de 'no_answer' (dele) na tabulação.
  const previous = parallelSession.calls[num]
  if (!(previous === 'cut' && state === 'ended')) parallelSession.calls[num] = state
  const aindaTocando = Object.values(parallelSession.calls).some((s) => s === 'calling')
  // `finished` = lote encerrado de verdade: nenhuma linha tocando E nenhuma conversa em curso.
  // É o que impede o "Preparar MicroSIP" de reiniciar o softphone no meio de um atendimento.
  parallelSession.finished = !Object.values(parallelSession.calls).some(
    (s) => s === 'calling' || s === 'answered'
  )
  if (!parallelSession.resolved && !aindaTocando) {
    parallelSession.endedNoAnswer = true
    // `resolved` = "esta sessão já foi decidida". Sem marcar aqui, a sessão morta continuava
    // aceitando um call-start posterior (de uma ligação 1-a-1 ou manual) e disparava
    // /hangupcalling fora de hora — a "sessão fantasma" que derrubava chamadas alheias.
    parallelSession.resolved = true
    console.log(`[${ts()}] PARALELO #${parallelSession.id}: ninguem atendeu`)
  }
}

// ─── Auto-atualização ──────────────────────────────────────────────────────────
// Baixa o código novo do Blue Desk, valida, faz backup e sobrescreve este próprio arquivo.
// Quem reinicia no código novo é o PRÓPRIO helper (restartSelf): ele spawna uma cópia sua
// desacoplada e sai. O código 42 continua existindo só como plano B para os agentes que ainda
// estão com o `start.bat` antigo (o loop dele reagia a esse código).
const UPDATE_EXIT_CODE = 42

// Reabre o helper num processo novo, desacoplado deste (que vai morrer em seguida).
// `detached` no Windows = DETACHED_PROCESS: nasce sem console, então não pisca janela preta.
function restartSelf() {
  try {
    const child = spawn(process.execPath, [__filename], {
      cwd: __dirname,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    })
    child.on('error', () => {})
    child.unref()
    return true
  } catch {
    return false
  }
}

// Encerra para subir no código novo. Se o self-restart funcionou, sai com 0 — importante para
// quem ainda usa o `start.bat`: com 42 o loop dele abriria um SEGUNDO helper. Se o self-restart
// falhou, aí sim sai com 42 e deixa o launcher antigo (se existir) fazer o trabalho.
function exitForUpdate() {
  const respawned = restartSelf()
  console.log(respawned ? 'Reiniciando no codigo novo...' : 'AVISO: nao consegui reiniciar sozinho.')
  process.exit(respawned ? 0 : UPDATE_EXIT_CODE)
}

// Compara versoes "X.Y.Z" numericamente: true so se `remote` for ESTRITAMENTE maior. A UI ja
// fazia isso (isVersionNewer no SoftphoneClient); o helper NAO fazia, e essa era a diferenca
// que mordeu: com `!==`, uma copia velha em public/helper (1.7) DERRUBOU um helper 1.16 para
// 1.7 no boot — sobrescrevendo o proprio index.js e levando junto tudo da 1.8 a 1.15.
// Atualizacao so anda para FRENTE.
function isVersionNewer(remote, current) {
  const a = String(remote).split('.').map((n) => parseInt(n, 10) || 0)
  const b = String(current).split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0
    const y = b[i] || 0
    if (x !== y) return x > y
  }
  return false
}

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

// Health check — usado pelo Blue Desk para saber se o helper está rodando e qual a versão.
// `multiCall` diz se o MicroSIP está em modo multi-chamada: sem isso a discagem preditiva
// não sai do papel, e a UI avisa o agente em vez de discar 1 número achando que discou N.
app.get('/ping', (req, res) => {
  res.json({
    ok: true,
    version: HELPER_VERSION,
    microsip: MICROSIP,
    ini: microsipIniPath(),
    multiCall: multiCallEnabled(),
    // Silêncio de toque ligado? (AUTO_MUTE_RING=0 desliga.) `speakerMuted` aqui é o estado
    // EFETIVO — manual do agente ou automático.
    ringSilence: AUTO_MUTE_RING,
    ringSilenceIdle: AUTO_MUTE_IDLE,
    speakerMuted: speakerMuted || autoMuted,
    // De QUAL pasta este helper está rodando. Com várias cópias do repo (worktrees), cada uma
    // com seu local-helper, "o helper está no ar" não diz nada — o que importa é qual subiu.
    dir: __dirname,
    pid: process.pid,
  })
})

// Liga o multi-call no MicroSIP (singleMode=0) — botão "Preparar MicroSIP" do Blue Desk.
// Fecha e reabre o MicroSIP quando ele está rodando, então só deve ser chamado fora de ligação.
app.post('/microsip-multicall', async (req, res) => {
  if (multiCallEnabled() === true) return res.json({ ok: true, alreadyEnabled: true })
  const r = await enableMultiCall()
  if (!r.ok) {
    console.error(`[${ts()}] ERRO ao ligar multi-call: ${r.error}`)
    return res.status(500).json(r)
  }
  res.json({ ...r, multiCall: multiCallEnabled() })
})

// Atualiza o helper sob demanda (botão "Atualizar helper" no Blue Desk).
// O navegador manda { source } = sua própria origem; usamos ela para baixar o código.
app.post('/update', async (req, res) => {
  const ts = new Date().toLocaleTimeString()
  const base = (req.body && req.body.source) || bluedeskBaseUrl()
  if (!base) {
    return res.status(400).json({ error: 'origem do Blue Desk desconhecida' })
  }
  try {
    const { code, version } = await fetchLatest(base)
    if (!isVersionNewer(version, HELPER_VERSION)) {
      // Cobre os dois casos: ja atualizado E origem servindo codigo mais VELHO (public/helper
      // desatualizado, deploy antigo, cache). Downgrade nunca — ele apaga o index.js atual.
      return res.json({
        ok: true,
        updated: false,
        version: HELPER_VERSION,
        remote: version,
        reason: version === HELPER_VERSION ? 'ja-atualizado' : 'origem-mais-velha',
      })
    }
    applyUpdate(code)
    console.log(`[${ts}] Atualizando ${HELPER_VERSION} -> ${version}. Reiniciando...`)
    res.json({ ok: true, updated: true, from: HELPER_VERSION, to: version })
    // dá tempo da resposta sair antes de reiniciar
    setTimeout(exitForUpdate, 400)
  } catch (err) {
    console.error(`[${ts}] ERRO ao atualizar: ${err.message}`)
    res.status(500).json({ error: err.message })
  }
})

// Encerra a chamada ativa no MicroSIP — usado pelo botão "Encerrar" do Blue Desk
app.post('/hangup', (req, res) => {
  const ts = new Date().toLocaleTimeString()
  if (runMsip('msip:hangupall')) {
    console.log(`[${ts}] Encerrando chamada (msip:hangupall)`)
    return res.json({ ok: true })
  }
  console.error(`[${ts}] ERRO ao encerrar: MicroSIP nao encontrado`)
  res.status(500).json({ error: 'MicroSIP nao encontrado' })
})

// Derruba SÓ as chamadas que ainda estão tocando, preservando uma que já foi atendida.
// É o que o Blue Desk usa ao pausar um lote paralelo: se alguém atendeu no exato instante da
// pausa, a conversa continua — com msip:hangupall ela cairia sem o agente entender o motivo.
app.post('/hangup-calling', (req, res) => {
  if (runMsip('/hangupcalling')) {
    console.log(`[${ts()}] Derrubando chamadas que ainda tocam (/hangupcalling)`)
    return res.json({ ok: true })
  }
  res.status(500).json({ error: 'MicroSIP nao encontrado' })
})

// Mute/desmute do agente (painel de áudio do Blue Desk). device: 'mic' (o cliente nao ouve o
// agente — msip:micmute, que zera a porta de entrada global) ou 'speaker' (o agente nao ouve —
// mute da sessao do microsip.exe no Windows; ver setMicrosipSpeakerMuted). Sao operacoes sem
// confirmacao de estado do MicroSIP, entao a UI so vira o botao apos o ok daqui.
app.post('/mute', async (req, res) => {
  const ts = new Date().toLocaleTimeString()
  const { device, muted } = req.body || {}
  if (device === 'mic') {
    const cmd = muted ? 'msip:micmute' : 'msip:micunmute'
    if (runMsip(cmd)) {
      console.log(`[${ts}] Microfone ${muted ? 'MUDO' : 'aberto'} (${cmd})`)
      return res.json({ ok: true, device, muted: !!muted })
    }
    return res.status(500).json({ error: 'MicroSIP nao encontrado' })
  }
  if (device === 'speaker') {
    speakerMuted = !!muted
    // Desmutar no botao vale AGORA, mesmo sob silencio de toque: sem isto o botao nao faria
    // som nenhum entre chamadas (o automatico mantem o softphone mudo enquanto ninguem
    // atende). A proxima discagem rearma o silencio sozinha.
    if (!speakerMuted) autoMuted = false
    const r = await setMicrosipSpeakerMuted(speakerMuted)
    console.log(`[${ts}] Alto-falante ${speakerMuted ? 'MUDO' : 'aberto'} (Windows, ${r.applied} sessao/oes)`)
    // ok=false significa que o PowerShell nao rodou (Core Audio falhou) — a UI nao deve mentir
    return res.status(r.ok ? 200 : 500).json({ ok: r.ok, device, muted: speakerMuted, applied: r.applied })
  }
  res.status(400).json({ error: "device invalido (use 'mic' ou 'speaker')" })
})

// Eventos vindos do MicroSIP (configurados no microsip.ini: cmdCallStart / cmdCallEnd).
// São GET porque o curl do MicroSIP usa GET por padrão.
app.get('/event/call-start', (req, res) => {
  const number = req.query.number
  recordEvent('call-start', number)
  // Casou com o lote ou com a discagem avulsa? Nesses casos quem abre o som são os próprios
  // handlers — inclusive para NÃO abrir no lote descartado por atendimento instantâneo
  // (máquina), que segue mudo de propósito.
  const doLote = !!(parallelSession && !parallelSession.resolved && matchParallelNumber(number))
  const daAvulsa = !!(lastSingleCall && !lastSingleCall.answered && sameNumber(number, lastSingleCall.dial))
  handleParallelAnswer(number)
  handleSingleAnswer(number)
  // Rede de seguranca para a chamada RECEBIDA (e para qualquer conexao que nao casou): sem
  // isto o agente atenderia no MicroSIP e nao ouviria nada, porque o silencio de toque mantem
  // o softphone mudo enquanto ninguem atende.
  if (!doLote && !daAvulsa) setRingSilence(false, 'chamada conectada')
  res.json({ ok: true })
})
app.get('/event/call-end', (req, res) => {
  recordEvent('call-end', req.query.number)
  handleParallelEnd(req.query.number, 'ended')
  handleSingleEnd(req.query.number)
  // Conversa acabou -> volta ao silêncio, para o próximo toque já nascer mudo. Só quando não
  // há mais NENHUMA linha atendida: num lote as perdedoras caem logo depois de o vencedor
  // atender, e remutar ali mataria o áudio da conversa que acabou de começar.
  if (!anyLiveCall()) setRingSilence(AUTO_MUTE_IDLE, AUTO_MUTE_IDLE ? 'sem chamada em curso' : 'chamada encerrada')
  res.json({ ok: true })
})
// Ligacao deu ocupado (486/600/603). O MicroSIP roteia esses casos para cmdCallBusy,
// nao para cmdCallEnd — por isso o evento proprio, para o Blue Desk tambem tabular.
app.get('/event/call-busy', (req, res) => {
  recordEvent('call-busy', req.query.number)
  handleParallelEnd(req.query.number, 'busy')
  handleSingleEnd(req.query.number)
  if (!anyLiveCall()) setRingSilence(AUTO_MUTE_IDLE, AUTO_MUTE_IDLE ? 'sem chamada em curso' : 'chamada encerrada')
  res.json({ ok: true })
})

// O Blue Desk faz polling aqui para saber o último evento de chamada
app.get('/events', (req, res) => res.json(lastEvent))

// Aciona uma chamada no MicroSIP.
// `raw: true` disca os dígitos como vieram, sem o CSP (021) — é o que permite ligar para um
// RAMAL interno (ex.: 5125) pela discagem manual; com o prefixo, "0215125" seria discado como
// interurbano e falharia.
app.post('/call', (req, res) => {
  const { number, raw } = req.body
  if (!number) return res.status(400).json({ error: 'number obrigatorio' })

  const digits = String(number).replace(/\D/g, '')
  if (!digits) return res.status(400).json({ error: 'Numero invalido' })

  const dial = raw ? digits : formatNumber(number)
  const ts = new Date().toLocaleTimeString()

  // Encerra qualquer sessão paralela pendente: uma chamada avulsa (1-a-1 ou manual) não pode
  // ser confundida com o lote anterior, senão o call-start dela dispararia /hangupcalling.
  parallelSession = null
  // Marca o instante da discagem para medir o tempo-até-atender desta chamada avulsa.
  lastSingleCall = { dial, at: Date.now(), answered: false, ended: false }

  // Caminho preferido: chamar o microsip.exe com o número (auto-disca) — SEMPRE pela fila.
  //
  // ⚠️ v1.15: aqui havia um `spawn` DIRETO, fora da fila. Era o furo que causava o modal
  // "Failed to open file for writing ...microsip.ini" em produção: a fila (queueMsip) existe
  // justamente para dois microsip.exe nunca nascerem juntos e brigarem pelo ini, mas o
  // caminho MAIS usado do helper — discagem 1-a-1 e discagem manual — não passava por ela.
  // Só o /dial-parallel usava. Resultado: bastava o agente discar enquanto a instância
  // principal gravava o histórico no ini para o modal aparecer e CONGELAR a fila de comandos
  // do MicroSIP. Ver o comentário do queueMsip.
  if (MICROSIP) {
    // Silencio ANTES de discar: o toque desta chamada nao chega ao agente. Abre no atendimento.
    setRingSilence(true, `discando ${dial}`)
    queueMsip([dial])
    // A sessao de audio desta chamada nasce sem mute (e nasce quando ela comeca a tocar, nao
    // agora) — a guarda cuida disso enquanto durar o toque.
    startRingGuard()
    console.log(`[${ts}] Discando ${dial} via ${MICROSIP}`)
    return res.json({ ok: true, number: dial, method: 'microsip-exe' })
  }

  // Fallback: protocolo tel: do Windows (depende do handler estar registrado)
  exec(`start "" "tel:${dial}"`, { windowsHide: true }, (err) => {
    if (err) {
      console.error(`[${ts}] ERRO ao acionar tel: ${err.message}`)
      return res.status(500).json({ error: err.message })
    }
    console.log(`[${ts}] Discando ${dial} via protocolo tel: (microsip.exe nao encontrado no disco)`)
    res.json({ ok: true, number: dial, method: 'tel-protocol' })
  })
})

// Discagem paralela: recebe { numbers: [...] }, muta o alto-falante, dispara as N em rajada e
// arma os timers do lote (corte de toque, desmute de seguranca, watchdog). O 1o call-start
// (handleParallelAnswer) faz o resto.
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

  // Sem multi-call o MicroSIP recusa a 2ª chamada: sairia UMA ligação e o agente acharia que
  // estava discando N. Melhor falhar alto e mandar o Blue Desk pedir a correção do ini.
  if (multiCallEnabled() === false) {
    console.error(`[${ts()}] PARALELO recusado: MicroSIP em modo de chamada unica (singleMode=1)`)
    return res.status(409).json({
      error: 'multicall-off',
      message:
        'O MicroSIP esta em modo de chamada unica — a discagem preditiva nao funciona assim. Use "Preparar MicroSIP" para ligar o modo multi-chamada.',
    })
  }

  parallelSession = {
    id: (parallelSession ? parallelSession.id : 0) + 1,
    startedAt: new Date().toISOString(),
    numbers: dials,
    calls: Object.fromEntries(dials.map((d) => [d, 'calling'])),
    winner: null,
    answeredAt: null,
    resolved: false,
    finished: false,
    timedOut: false,
    ringCutoff: false,
    // instante em que CADA linha foi discada (elas saem escalonadas) — base do tempo-até-atender
    dialedAt: {},
  }
  const sid = parallelSession.id

  // Silêncio do lote: o ringback das N linhas — e a caixa postal que atender antes do corte —
  // não chega ao agente. O som volta sozinho no call-start do vencedor (handleParallelAnswer).
  setRingSilence(true, `lote #${sid} discando ${dials.length}`)

  // Dispara as N discagens. O espaçamento entre os microsip.exe é responsabilidade da fila
  // única (queueMsip) — a mesma que serializa os comandos de controle. O `onSpawn` grava o
  // instante REAL do disparo desta linha, que é a base do tempo-até-atender.
  dials.forEach((dial) => {
    queueMsip([dial], () => {
      if (parallelSession && parallelSession.id === sid) parallelSession.dialedAt[dial] = Date.now()
    })
  })
  // As N sessoes de audio nascem ao longo dos proximos segundos e cada uma nasce SEM mute —
  // a guarda reaplica o silencio enquanto o lote estiver tocando.
  startRingGuard()
  console.log(`[${ts()}] PARALELO #${sid}: discando ${dials.length} -> ${dials.join(', ')}`)

  // 3) CORTE DE TOQUE (anti caixa postal): passado o tempo de toque, o que ainda estiver
  // TOCANDO é derrubado antes de a caixa postal atender. Um timer só para o lote, contado a
  // partir da última linha disparada, porque /hangupcalling é global (não dá para derrubar
  // uma linha específica) — e é justamente por ser global que ele não erra: chamada já
  // atendida é preservada pelo próprio comando.
  // Não marcamos `resolved` aqui de propósito: se alguém atendeu nos milissegundos anteriores
  // ao hangup, o MicroSIP preserva a chamada e o call-start ainda vai chegar — deixando o
  // caminho normal de vencedor funcionar em vez de descartar uma conversa viva.
  setTimeout(() => {
    if (!parallelSession || parallelSession.id !== sid || parallelSession.resolved) return
    const ringing = Object.keys(parallelSession.calls).filter((k) => parallelSession.calls[k] === 'calling')
    if (ringing.length === 0) return
    runMsip('/hangupcalling')
    ringing.forEach((k) => (parallelSession.calls[k] = 'cut'))
    parallelSession.ringCutoff = true
    parallelSession.finished = !Object.values(parallelSession.calls).some(
      (s) => s === 'calling' || s === 'answered'
    )
    console.log(
      `[${ts()}] PARALELO #${sid}: corte de toque em ${RING_CUTOFF_MS / 1000}s -> ` +
        `${ringing.length} linha(s) derrubada(s) antes da caixa postal (viram 'abandoned')`
    )
    // O corte conta a partir da ÚLTIMA linha disparada: cada uma esperou sua vez na fila, então
    // o teto de toque tem que valer para quem saiu por último também.
  }, (dials.length - 1) * MSIP_MIN_GAP_MS + RING_CUTOFF_MS)

  // 4) watchdog: se um call-start/call-end se perder (curl que nao rodou, numero que nao casou),
  // a linha ficaria 'calling' para sempre e o lote NUNCA resolveria — o agente ve "Discando N…"
  // eternamente e a fila para. Passado o teto de um toque real (~15-30s), encerra as linhas
  // penduradas. Usa /hangupcalling (nao /hangupall) para jamais derrubar uma conversa em curso.
  setTimeout(() => {
    if (!parallelSession || parallelSession.id !== sid) return
    const stuck = Object.keys(parallelSession.calls).filter((k) => parallelSession.calls[k] === 'calling')
    if (stuck.length === 0) return
    // 'cut' e não 'ended': a linha ficou pendurada por evento perdido, ou seja, quem encerrou
    // fomos nós — o contato merece voltar pela reciclagem, não levar um "não atendeu".
    stuck.forEach((k) => (parallelSession.calls[k] = 'cut'))
    parallelSession.timedOut = true
    parallelSession.finished = !Object.values(parallelSession.calls).some((s) => s === 'answered')
    if (!parallelSession.resolved) {
      parallelSession.resolved = true
      runMsip('/hangupcalling')
    }
    console.log(`[${ts()}] PARALELO #${sid}: timeout, ${stuck.length} linha(s) pendurada(s) encerrada(s)`)
  }, PARALLEL_TIMEOUT_MS)

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
    resolved: parallelSession.resolved,
    finished: !!parallelSession.finished,
    timedOut: !!parallelSession.timedOut,
    ringCutoff: !!parallelSession.ringCutoff,
    instantAnswer: !!parallelSession.instantAnswer,
  })
})

// Distribuicao do tempo-ate-atender das ligacoes deste helper (memoria, some ao reiniciar).
// Serve para calibrar o RING_CUTOFF_MS: humano se espalha pela faixa, caixa postal se
// concentra num valor fixo. Abra http://localhost:3001/answer-times no navegador.
app.get('/answer-times', (req, res) => {
  const buckets = {}
  for (const ms of answerTimes) {
    const s = Math.floor(ms / 1000)
    const key = s >= 30 ? '30+' : `${Math.floor(s / 2) * 2}-${Math.floor(s / 2) * 2 + 2}s`
    buckets[key] = (buckets[key] || 0) + 1
  }
  const sorted = [...answerTimes].sort((a, b) => a - b)
  res.json({
    amostras: sorted.length,
    corteAtualS: RING_CUTOFF_MS / 1000,
    pisoAtendimentoS: MIN_ANSWER_MS / 1000,
    // quantas atendidas o corte atual teria descartado (o custo real da regra, medido)
    perdidasPeloCorte: sorted.filter((ms) => ms > RING_CUTOFF_MS).length,
    // Quantos atenderam em até 3s. É a evidência que decide se vale LIGAR o piso
    // (MIN_ANSWER_MS): se for sempre 0, atendimento instantâneo não existe nesta operação e o
    // piso só criaria risco de descartar gente. Medido sempre, mesmo com o piso desligado.
    atendimentosAte3s: sorted.filter((ms) => ms < 3000).length,
    abaixoDoPiso: MIN_ANSWER_MS ? sorted.filter((ms) => ms < MIN_ANSWER_MS).length : null,
    medianaS: sorted.length ? Number((sorted[Math.floor(sorted.length / 2)] / 1000).toFixed(1)) : null,
    p90S: sorted.length ? Number((sorted[Math.floor(sorted.length * 0.9)] / 1000).toFixed(1)) : null,
    maxS: sorted.length ? Number((sorted[sorted.length - 1] / 1000).toFixed(1)) : null,
    buckets,
  })
})

// No start, antes de subir o servidor, tenta se atualizar sozinho contra o Blue Desk.
// Se houver versão nova, sobrescreve e sai com 42 — o start.bat reabre no código novo.
// Como após o restart HELPER_VERSION passa a bater com o remoto, não há loop.
async function maybeAutoUpdate() {
  // Trava de teste: HELPER_NO_UPDATE=1 impede a auto-atualizacao no start, para rodar um
  // helper editado localmente sem o Blue Desk remoto (versao antiga) sobrescrever o codigo.
  if (process.env.HELPER_NO_UPDATE) return
  const base = bluedeskBaseUrl()
  if (!base) return
  try {
    const { code, version } = await fetchLatest(base)
    if (isVersionNewer(version, HELPER_VERSION)) {
      console.log(`Versao nova encontrada (${HELPER_VERSION} -> ${version}). Atualizando...`)
      applyUpdate(code)
      exitForUpdate()
    } else if (version !== HELPER_VERSION) {
      console.log(
        `A origem serve a v${version}, mais VELHA que esta (v${HELPER_VERSION}) — ignorada. ` +
          `Se era para publicar, rode "npm run sync:helper" no Blue Desk.`
      )
    }
  } catch {
    // sem rede / Blue Desk fora do ar / origem ainda não conhecida — segue com a versão atual
  }
}

// Correção silenciosa no boot: se o MicroSIP ainda NÃO está aberto, dá para acertar o ini sem
// incomodar ninguém (o helper sobe com o Windows, normalmente antes do MicroSIP). Se já estiver
// aberto, não mexemos — fechar o MicroSIP do nada seria pior que o problema; nesse caso o
// Blue Desk mostra o aviso e o agente aciona o "Preparar MicroSIP" quando estiver fora de ligação.
async function ensureMultiCallAtStartup() {
  if (process.env.HELPER_NO_INI_FIX) return
  if (multiCallEnabled() !== false) return
  if (await isMicrosipRunning()) {
    console.log(' MicroSIP aberto: use "Preparar MicroSIP" no Blue Desk para ligar o multi-chamada.')
    return
  }
  const r = await enableMultiCall()
  if (!r.ok) console.error(` Nao foi possivel ligar o multi-chamada: ${r.error}`)
}

// O helper escuta em 127.0.0.1 (IPv4) E em ::1 (IPv6) — as duas caras do "localhost".
// Motivo real, visto em produção: um `next dev` que acha a 3000 ocupada PULA para a 3001 e
// faz bind em `::`. Como o helper só ocupava o IPv4 e o Windows resolve `localhost` para IPv6
// PRIMEIRO, o navegador passava a conversar com o Next em vez do helper — sem nenhum erro,
// só "helper offline" e discagem morta. Ocupando as duas pilhas, esse sequestro não acontece.
// Segue sendo só loopback: nada exposto para a rede.
function listenOnIPv6() {
  try {
    const s6 = http.createServer(app)
    s6.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error('')
        console.error(` AVISO: algo JA ocupa [::1]:${PORT} (o "localhost" IPv6).`)
        console.error(' O navegador pode conversar com esse outro processo em vez do helper.')
        console.error(' Causa comum: um "npm run dev" que pulou da porta 3000 para a 3001.')
        console.error('')
      }
      // IPv6 indisponível na máquina não é fatal: o IPv4 já está no ar.
    })
    s6.listen(PORT, '::1')
  } catch {
    // sem IPv6 — segue só com o IPv4
  }
}

async function main() {
  initFileLog()
  await maybeAutoUpdate()

  const server = app.listen(PORT, '127.0.0.1', () => {
    console.log('=================================')
    console.log(` Blue Desk Helper v${HELPER_VERSION}`)
    console.log(` http://localhost:${PORT}`)
    console.log('=================================')
    if (MICROSIP) {
      console.log(` MicroSIP encontrado: ${MICROSIP}`)
    } else {
      console.log(' MicroSIP NAO encontrado no disco — usando protocolo tel: (fallback)')
      console.log(' Se a discagem nao funcionar, defina MICROSIP_PATH apontando para o microsip.exe')
    }
    if (DIAL_PREFIX) console.log(` Prefixo de discagem (CSP): "${DIAL_PREFIX}" — disca ${DIAL_PREFIX} + DDD + numero`)
    const mc = multiCallEnabled()
    if (mc === true) console.log(' MicroSIP em multi-chamada (singleMode=0) — discagem preditiva liberada')
    else if (mc === false) console.log(' AVISO: MicroSIP em modo de chamada UNICA — a discagem preditiva NAO vai funcionar')
    else console.log(' microsip.ini nao encontrado — nao da para conferir o modo multi-chamada')
    console.log(` Corte de toque: ${RING_CUTOFF_MS / 1000}s (linha que so toca e derrubada antes da caixa postal)`)
    console.log(
      AUTO_MUTE_RING
        ? ` Som: MUDO enquanto disca/toca — abre sozinho quando ATENDEM${AUTO_MUTE_IDLE ? ' (e entre chamadas tambem fica mudo; AUTO_MUTE_IDLE=0 libera o toque de entrada)' : ''} — AUTO_MUTE_RING=0 desliga`
        : ' Som: sempre aberto (AUTO_MUTE_RING=0) — o agente ouve o toque/ringback'
    )
    console.log(
      process.env.HELPER_NO_HIDE
        ? ' Janela do MicroSIP: VISIVEL (HELPER_NO_HIDE=1) — para configurar o softphone'
        : ' Janela do MicroSIP: escondida (padrao; HELPER_NO_HIDE=1 mostra)'
    )
    console.log(` Pasta: ${__dirname}`)
    console.log('Aguardando chamadas do Blue Desk...')
    console.log('')
    listenOnIPv6()
    startMicrosipHider()
    ensureMultiCallAtStartup()
    // Sobe o worker do mute JA na largada: e a compilacao do C# (~1s) que ele tira do caminho
    // do atendimento. E deixa o softphone em silencio desde o inicio.
    startMuteWorker()
    setRingSilence(AUTO_MUTE_IDLE, 'helper iniciado')
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
