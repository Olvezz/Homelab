// Paletas de los temas de ProxMorph (https://github.com/IT-BAER/proxmorph).
// Todos los temas definen las mismas variables `--pwt-*`; de ahí se sacan 8 colores base y el
// resto de la UI se deriva. Sin dependencias ni sintaxis no borrable: lo usa tanto la app como
// `scripts/sync-themes.mjs` (Node ejecuta este .ts directamente).

export interface ThemeColors {
  bg: string // --pwt-panel-background
  text: string // --pwt-text-color
  accent: string // --pwt-gauge-default
  track: string // --pwt-gauge-back
  warn: string // --pwt-gauge-warn
  crit: string // --pwt-gauge-crit
  primary: string // --pwt-chart-primary
  grid: string // --pwt-chart-grid-stroke
  success: string | null // primer token de color con "success"/"green" en el nombre
}

export interface ProxmorphTheme {
  id: string // `github-dark` (nombre del archivo sin `theme-` ni `.css`; es lo que guarda PVEThemeCookie)
  name: string
  dark: boolean
  colors: ThemeColors
}

const PWT = {
  bg: '--pwt-panel-background',
  text: '--pwt-text-color',
  accent: '--pwt-gauge-default',
  track: '--pwt-gauge-back',
  warn: '--pwt-gauge-warn',
  crit: '--pwt-gauge-crit',
  primary: '--pwt-chart-primary',
  grid: '--pwt-chart-grid-stroke'
}

type RGB = [number, number, number]

export function parseColor(raw: string): RGB | null {
  const v = raw.trim().toLowerCase()
  let m = /^#([0-9a-f]{3,8})$/.exec(v)
  if (m) {
    let h = m[1]
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('')
    if (h.length !== 6 && h.length !== 8) return null
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
  }
  m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(v)
  if (m) return [Math.round(+m[1]), Math.round(+m[2]), Math.round(+m[3])]
  return null
}

export function toHex([r, g, b]: RGB): string {
  return '#' + [r, g, b].map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')).join('')
}

export function mix(a: string, b: string, t: number): string {
  const x = parseColor(a) ?? [0, 0, 0]
  const y = parseColor(b) ?? [0, 0, 0]
  return toHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t])
}

export function luminance(color: string): number {
  const c = parseColor(color) ?? [0, 0, 0]
  const lin = c.map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]
}

// Variables de los bloques `:root { … }` (sin comentarios)
function rootVars(css: string): Map<string, string> {
  const vars = new Map<string, string>()
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const block of clean.matchAll(/:root\s*\{([^}]*)\}/g)) {
    for (const d of block[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);?/g)) {
      if (!vars.has(d[1])) vars.set(d[1], d[2].trim())
    }
  }
  return vars
}

function resolve(vars: Map<string, string>, value: string | undefined, depth = 0): string | null {
  if (!value || depth > 8) return null
  const ref = /^var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\)$/.exec(value.trim())
  if (ref) return resolve(vars, vars.get(ref[1]) ?? ref[2], depth + 1)
  return parseColor(value) ? value.trim() : null
}

export function extractTheme(id: string, css: string): ProxmorphTheme | null {
  const vars = rootVars(css)
  const get = (name: string): string | null => resolve(vars, vars.get(name))
  const colors: Partial<Record<keyof typeof PWT, string>> = {}
  for (const [key, name] of Object.entries(PWT)) {
    const value = get(name)
    if (!value) return null
    colors[key as keyof typeof PWT] = value
  }
  let success: string | null = null
  for (const name of vars.keys()) {
    if (!/(success|green)/i.test(name)) continue
    const v = resolve(vars, vars.get(name))
    if (v) {
      success = v
      break
    }
  }
  const title = /\/\*!\s*([^*]+?)\s*\*\//.exec(css)?.[1]
  const name = title ?? id.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ')
  const full = { ...(colors as Omit<ThemeColors, 'success'>), success }
  return { id, name, dark: luminance(full.bg) < 0.4, colors: full }
}

// Variables CSS de la UI propia derivadas de los colores base del tema
export function themeTokens(theme: ProxmorphTheme): Record<string, string> {
  const c = theme.colors
  const dark = theme.dark
  const dim = mix(c.text, c.bg, 0.35)
  const accentText = luminance(c.accent) > 0.45 ? '#0d1117' : '#ffffff'
  return {
    '--bg': c.bg,
    '--bg-side': dark ? mix(c.bg, '#000000', 0.35) : mix(c.bg, '#000000', 0.05),
    '--bg-raised': mix(c.bg, c.text, dark ? 0.06 : 0.0),
    '--bg-input': c.bg,
    '--border': c.grid,
    '--border-muted': mix(c.grid, c.bg, 0.5),
    '--text': c.text,
    '--text-dim': dim,
    '--text-faint': mix(c.text, c.bg, 0.55),
    '--accent': c.accent,
    '--accent-hover': mix(c.accent, dark ? '#ffffff' : '#000000', 0.15),
    '--accent-text': accentText,
    '--focus': c.primary,
    '--link': c.primary,
    '--danger': c.crit,
    '--success': c.success ?? (dark ? '#3fb950' : '#1a7f37'),
    '--warn': c.warn,
    '--hover': mix(c.bg, c.text, 0.1),
    '--active': mix(c.bg, c.accent, 0.2),
    '--backdrop': dark ? 'rgba(0, 0, 0, 0.65)' : 'rgba(31, 35, 40, 0.4)',
    'color-scheme': dark ? 'dark' : 'light'
  }
}
