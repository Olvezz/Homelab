// Lectura del HTML de un sitio para encontrar su icono. Sin Electron: se puede probar aparte.

export const MAX_ICON_BYTES = 80_000

const ALLOWED_MIME = /^image\/(png|x-icon|vnd\.microsoft\.icon|svg\+xml|jpeg|gif|webp)$/

// Etiqueta <link …>: los valores entre comillas pueden contener `>` (p. ej. un SVG dentro de un data: URI) y ocupar varias líneas
const LINK_TAG = /<link\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi

export interface IconCandidate {
  url: string // http(s) o data:
  score: number
}

function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag)
  return m ? (m[1] ?? m[2] ?? m[3]) : undefined
}

// Candidatos declarados en el HTML, del mejor al peor: apple-touch-icon y SVG primero, luego por tamaño;
// a igualdad gana el último declarado (así elige el navegador).
export function iconCandidates(html: string, base: string): string[] {
  const found: (IconCandidate & { i: number })[] = []
  let i = 0
  for (const tag of html.match(LINK_TAG) ?? []) {
    const rel = attr(tag, 'rel')?.toLowerCase() ?? ''
    if (!rel.includes('icon')) continue
    const href = attr(tag, 'href')?.trim()
    if (!href) continue
    let url: string
    if (/^data:/i.test(href)) url = href
    else {
      try {
        url = new URL(href, base).href
      } catch {
        continue
      }
      if (!/^https?:/.test(url)) continue
    }
    const size = Number(/^(\d+)x/i.exec(attr(tag, 'sizes') ?? '')?.[1] ?? 0)
    const isSvg = /^data:image\/svg/i.test(url) || /\.svg(\?|$)/i.test(url)
    found.push({ url, i: i++, score: (rel.includes('apple-touch') ? 1000 : 0) + (isSvg ? 500 : 0) + Math.min(size, 256) })
  }
  return found.sort((a, b) => b.score - a.score || b.i - a.i).map((c) => c.url)
}

// Pasa un data: URI cualquiera (con o sin base64, URL-encoded) a data:<mime>;base64,… dentro del límite de tamaño
export function normalizeDataIcon(href: string): string | null {
  const m = /^data:([^,;]*)((?:;[^,]*)?),(.*)$/is.exec(href)
  if (!m) return null
  const mime = m[1].trim().toLowerCase()
  if (!ALLOWED_MIME.test(mime)) return null
  let bytes: Buffer
  try {
    bytes = /;base64/i.test(m[2]) ? Buffer.from(decodeURIComponent(m[3]), 'base64') : Buffer.from(decodeURIComponent(m[3]), 'utf8')
  } catch {
    return null
  }
  if (bytes.length === 0 || bytes.length > MAX_ICON_BYTES) return null
  const stored = mime === 'image/vnd.microsoft.icon' ? 'image/x-icon' : mime // el esquema de la config solo admite x-icon
  return `data:${stored};base64,${bytes.toString('base64')}`
}
