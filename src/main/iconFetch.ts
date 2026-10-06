import { net } from 'electron'

const MAX_BYTES = 80_000
const TIMEOUT_MS = 6000

// Tipo real por los primeros bytes: muchos servidores sirven los favicon con un Content-Type erróneo
function sniff(buf: Buffer): string | null {
  if (buf.length < 4) return null
  if (buf.readUInt32BE(0) === 0x89504e47) return 'image/png'
  if (buf.readUInt32BE(0) === 0x00000100) return 'image/x-icon'
  if (buf.subarray(0, 3).toString('latin1') === 'GIF') return 'image/gif'
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg'
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp'
  if (/<svg[\s>]/i.test(buf.subarray(0, 2000).toString('utf8'))) return 'image/svg+xml'
  return null
}

async function get(url: string): Promise<{ body: Buffer; finalUrl: string } | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await net.fetch(url, { signal: ctrl.signal, redirect: 'follow' })
    if (!res.ok) return null
    const chunks: Buffer[] = []
    let total = 0
    const reader = res.body?.getReader()
    if (!reader) return null
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      // El HTML se lee solo hasta donde caben los <link>; las imágenes sobre el límite se descartan
      if (total > 500_000) {
        void reader.cancel()
        break
      }
      chunks.push(Buffer.from(value))
    }
    return { body: Buffer.concat(chunks), finalUrl: res.url || url }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

// Candidatos declarados en el HTML (<link rel="…icon…" href>), los más grandes/nítidos primero
function candidates(html: string, base: string): string[] {
  const out: { url: string; score: number }[] = []
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = /\brel\s*=\s*["']?([^"'>]+)/i.exec(tag)?.[1]?.toLowerCase() ?? ''
    if (!rel.includes('icon')) continue
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]
    if (!href) continue
    let url: string
    try {
      url = new URL(href, base).href
    } catch {
      continue
    }
    if (!/^https?:/.test(url)) continue
    const size = Number(/\bsizes\s*=\s*["']?(\d+)x/i.exec(tag)?.[1] ?? 0)
    out.push({ url, score: (rel.includes('apple-touch') ? 1000 : 0) + (/\.svg(\?|$)/i.test(url) ? 500 : 0) + Math.min(size, 256) })
  }
  return out.sort((a, b) => b.score - a.score).map((c) => c.url)
}

// Busca el icono del sitio oficial y lo devuelve como data URI (nada de terceros: solo el propio sitio)
export async function fetchSiteIcon(siteUrl: string): Promise<string | null> {
  let origin: string
  try {
    const u = new URL(siteUrl)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    origin = u.origin
  } catch {
    return null
  }

  const list: string[] = []
  const page = await get(siteUrl)
  if (page) list.push(...candidates(page.body.toString('utf8'), page.finalUrl))
  list.push(`${new URL(page?.finalUrl ?? origin).origin}/favicon.ico`, `${origin}/favicon.ico`)

  for (const url of [...new Set(list)].slice(0, 6)) {
    const img = await get(url)
    if (!img || img.body.length > MAX_BYTES) continue
    const mime = sniff(img.body)
    if (mime) return `data:${mime};base64,${img.body.toString('base64')}`
  }
  return null
}
