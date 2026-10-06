// Abre la app compilada con un perfil aparte (%APPDATA%\homelab-desktop-beta) para probar sin tocar tus datos.
// La primera vez copia tu configuración y la clave que cifra los secretos (token de Proxmox, contraseñas SSH),
// así ves tus paneles y tus máquinas reales. `npm run beta -- --fresh` vuelve a copiarlas.
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const appData = process.env.APPDATA
if (!appData) throw new Error('No se encontró la carpeta APPDATA (esta app es solo para Windows)')
const src = join(appData, 'homelab-desktop')
const dst = join(appData, 'homelab-desktop-beta')
const fresh = process.argv.includes('--fresh')

if (existsSync(join(src, 'config.json')) && (fresh || !existsSync(join(dst, 'config.json')))) {
  mkdirSync(dst, { recursive: true })
  copyFileSync(join(src, 'config.json'), join(dst, 'config.json'))
  // Electron cifra los secretos con una clave guardada en «Local State» de cada perfil: sin ella no se descifrarían
  if (existsSync(join(src, 'Local State'))) copyFileSync(join(src, 'Local State'), join(dst, 'Local State'))
  console.log('Configuración copiada al perfil beta.')
}

const run = (args) => spawnSync('npx', args, { stdio: 'inherit', shell: true }).status ?? 1
if (run(['electron-vite', 'build']) !== 0) process.exit(1)
process.exit(run(['electron', '.', `--user-data-dir="${dst}"`]))
