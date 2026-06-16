// Copia o helper local para public/ para que o DiscSiP sirva a versão mais nova em
// /helper/index.js (código que o helper baixa) e /helper/version.json (só a versão,
// usada pela UI para saber se está desatualizado). Fonte única: local-helper/index.js.
// Roda automaticamente no build (script "prebuild") e pode ser rodado à mão.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'local-helper', 'index.js')
const outDir = join(root, 'public', 'helper')

const code = readFileSync(src, 'utf8')
const m = code.match(/HELPER_VERSION\s*=\s*['"]([^'"]+)['"]/)
if (!m) {
  console.error('sync-helper: HELPER_VERSION não encontrado em local-helper/index.js')
  process.exit(1)
}
const version = m[1]

mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'index.js'), code)
writeFileSync(join(outDir, 'version.json'), JSON.stringify({ version }) + '\n')

console.log(`sync-helper: helper v${version} copiado para public/helper/`)
