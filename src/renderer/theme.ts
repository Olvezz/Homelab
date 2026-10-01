import themesJson from '../shared/themes.json'
import { themeTokens, type ProxmorphTheme } from '../shared/proxmorph'

export const THEMES = themesJson as ProxmorphTheme[]

// Tema por defecto cuando Proxmox no ha guardado ninguno todavía
const FALLBACK_ID = 'github-dark'

const byId = (id: string | null | undefined): ProxmorphTheme | undefined =>
  id ? THEMES.find((t) => t.id === id) : undefined

export interface Resolved {
  mode: 'dark' | 'light'
  theme: ProxmorphTheme | null // null = paleta clara integrada (hoja de estilos base)
  label: string
}

// `setting` es ui.theme: 'proxmox' (seguir a Proxmox), 'light', 'system' o el id de un tema ProxMorph.
// `cookie` es el valor de PVEThemeCookie en la sesión web de Proxmox (lo que se elige en "Color Theme").
export function resolveTheme(setting: string, cookie: string | null, prefersDark: boolean): Resolved {
  const builtinLight: Resolved = { mode: 'light', theme: null, label: 'Claro' }
  const pick = (t: ProxmorphTheme): Resolved => ({ mode: t.dark ? 'dark' : 'light', theme: t, label: t.name })

  if (setting === 'light') return builtinLight
  if (setting === 'system') return prefersDark ? pick(byId(FALLBACK_ID)!) : builtinLight
  if (setting === 'proxmox') {
    if (cookie === 'crisp') return builtinLight // el claro de fábrica de Proxmox
    const followed = byId(cookie)
    if (followed) return pick(followed)
    // Sin cookie, Proxmox usa su oscuro de fábrica si el sistema es oscuro; aquí se prefiere el tema de ProxMorph
    return pick(byId(FALLBACK_ID)!)
  }
  return pick(byId(setting) ?? byId(FALLBACK_ID)!)
}

const TOKEN_NAMES = Object.keys(themeTokens(THEMES[0]))

export function applyTheme(resolved: Resolved): void {
  const root = document.documentElement
  root.dataset.theme = resolved.mode
  for (const name of TOKEN_NAMES) root.style.removeProperty(name)
  if (resolved.theme) {
    for (const [name, value] of Object.entries(themeTokens(resolved.theme))) root.style.setProperty(name, value)
  }
  // Los terminales SSH recalculan sus colores
  window.dispatchEvent(new Event('app-theme'))
}
