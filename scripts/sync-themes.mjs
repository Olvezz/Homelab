// Descarga los temas de https://github.com/IT-BAER/proxmorph y guarda sus paletas en
// src/shared/themes.json. Se ejecuta con `npm run themes` cuando ProxMorph publique temas nuevos.
import { writeFileSync } from 'node:fs'
import { extractTheme } from '../src/shared/proxmorph.ts'

const API = 'https://api.github.com/repos/IT-BAER/proxmorph/contents/themes'
const RAW = 'https://raw.githubusercontent.com/IT-BAER/proxmorph/main/themes/'

const list = await (await fetch(API, { headers: { 'User-Agent': 'homelab-desktop' } })).json()
const files = list
  .map((f) => f.name)
  .filter((n) => /^theme-.+\.css$/.test(n) || n === 'original-proxmox-dark.css')

const themes = []
for (const file of files) {
  const css = await (await fetch(RAW + file)).text()
  // `original-proxmox-dark.css` es el oscuro de fábrica de Proxmox (clave `proxmox-dark` en la cookie)
  const id = file === 'original-proxmox-dark.css' ? 'proxmox-dark' : file.replace(/^theme-/, '').replace(/\.css$/, '')
  const theme = extractTheme(id, css)
  if (!theme) {
    console.warn('sin paleta:', file)
    continue
  }
  if (id === 'proxmox-dark') theme.name = 'Proxmox Dark'
  themes.push(theme)
}
themes.sort((a, b) => a.name.localeCompare(b.name))
writeFileSync(new URL('../src/shared/themes.json', import.meta.url), JSON.stringify(themes, null, 2) + '\n')
console.log(`${themes.length} temas →`, themes.map((t) => t.id).join(', '))
