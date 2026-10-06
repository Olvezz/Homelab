// Genera THIRD_PARTY_NOTICES.md: las licencias de los componentes de terceros que viajan dentro de la aplicación
// (dependencias de producción y las librerías que Vite empaqueta en la interfaz). Se ejecuta con `npm run licenses`.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

// Librerías de desarrollo que acaban dentro del paquete de la interfaz
const BUNDLED = ['react', 'react-dom', 'lucide-react', '@xterm/xterm', '@xterm/addon-fit', 'simple-icons']
// Se distribuye entero (su LICENSE y los créditos de Chromium van en la propia aplicación); no se recorren sus dependencias
const FRAMEWORKS = ['electron']

function locate(name, from) {
  for (let dir = from; ; dir = dirname(dir)) {
    const p = join(dir, 'node_modules', name)
    if (existsSync(join(p, 'package.json'))) return p
    if (dirname(dir) === dir) return null
  }
}

const found = new Map() // nombre -> { dir, json }
function visit(name, from, deep = true) {
  const dir = locate(name, from)
  if (!dir) return
  const json = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  if (found.has(json.name)) return
  found.set(json.name, { dir, json })
  if (!deep) return
  for (const dep of Object.keys(json.dependencies ?? {})) visit(dep, dir)
}

for (const name of Object.keys(pkg.dependencies ?? {})) visit(name, root)
for (const name of BUNDLED) visit(name, root)
for (const name of FRAMEWORKS) visit(name, root, false)

const licenseOf = (j) => (typeof j.license === 'string' ? j.license : j.license?.type ?? (j.licenses ?? []).map((l) => l.type).join(' OR ') ?? 'desconocida') || 'desconocida'

function textsOf(dir) {
  const files = readdirSync(dir).filter((f) => /^(licen[sc]e|copying|notice)(\.|$)/i.test(f))
  return files.map((f) => ({ file: f, text: readFileSync(join(dir, f), 'utf8').trim() }))
}

const list = [...found.values()].sort((a, b) => a.json.name.localeCompare(b.json.name))
const out = []
out.push('# Licencias de componentes de terceros', '')
out.push('HomeLab Desktop incluye los componentes de código abierto que se listan a continuación. Cada uno se rige por su propia licencia, cuyo texto se reproduce más abajo. Esta lista se genera automáticamente con `npm run licenses`.', '')
out.push('Electron incluye además Chromium y sus componentes; sus avisos de licencia (`LICENSES.chromium.html`) se distribuyen con la aplicación.', '')
out.push('**Marcas y logotipos.** Los logotipos de servicios que la aplicación muestra para identificar tus paneles proceden de Simple Icons (licencia CC0) y pertenecen a sus respectivos titulares; se usan solo con fines de identificación y no implican afiliación ni respaldo.', '')
out.push('## Resumen', '', '| Componente | Versión | Licencia |', '|---|---|---|')
for (const { json } of list) out.push(`| ${json.name} | ${json.version} | ${licenseOf(json)} |`)
out.push('')
out.push('## Textos de las licencias', '')
for (const { dir, json } of list) {
  out.push(`### ${json.name} ${json.version} — ${licenseOf(json)}`, '')
  const texts = textsOf(dir)
  if (texts.length === 0) out.push(`El paquete no incluye un archivo de licencia; se distribuye bajo ${licenseOf(json)}.`, '')
  for (const t of texts) out.push('```', t.text, '```', '')
}

writeFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), out.join('\n'), 'utf8')
console.log(`THIRD_PARTY_NOTICES.md: ${list.length} componentes`)
