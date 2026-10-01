import { createHash } from 'node:crypto'
import { isIP } from 'node:net'
import type { Diagnostic, Panel } from '../../shared/types'

// Las notas y tags de Proxmox son datos NO confiables: se parsean con lista blanca,
// nunca se evalúan ni se inyectan como HTML.

export interface ParsedPanel {
  name: string
  url: string
  icon?: string
}

export interface ParsedNotes {
  panels: ParsedPanel[]
  issues: string[] // líneas `panel:` mal formadas
}

const NAME_MAX = 60
// El icono es opcional: una clave de icono (`ubuntu`, `ui:server`…). Un emoji u otro texto se ignora
// y el icono se asigna solo (ver src/shared/icons.ts)
const ICON_KEY = /^[a-z0-9:-]{1,30}$/i

// Devuelve la URL normalizada si es http(s); cualquier otro esquema (file:, javascript:…) se rechaza
export function safeHttpUrl(raw: string): string | null {
  if (raw.length > 2048) return null
  try {
    const u = new URL(raw)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    if (u.username || u.password) return null
    return u.toString()
  } catch {
    return null
  }
}

// Formato: `panel: <nombre> | <url> [| <icono>]`, una línea por panel
export function parseNotes(description: string): ParsedNotes {
  const panels: ParsedPanel[] = []
  const issues: string[] = []
  for (const line of description.split(/\r?\n/)) {
    const m = /^\s*panel\s*:(.*)$/i.exec(line)
    if (!m) continue
    const parts = m[1].split('|').map((s) => s.trim())
    const [name, rawUrl, icon, ...extra] = parts
    const url = rawUrl ? safeHttpUrl(rawUrl) : null
    if (
      !name ||
      name.length > NAME_MAX ||
      !url ||
      extra.length > 0
    ) {
      issues.push(line.trim().slice(0, 120))
      continue
    }
    panels.push({ name, url, icon: icon && ICON_KEY.test(icon) ? icon.toLowerCase() : undefined })
  }
  return { panels, issues }
}

// Tags `web-<puerto>` o `web-<puerto>-https` (los tags no admiten ':' ni '/')
export function parseWebTags(tags: string[]): { port: number; https: boolean }[] {
  const out: { port: number; https: boolean }[] = []
  for (const tag of tags) {
    const m = /^web-(\d{1,5})(-https)?$/i.exec(tag)
    if (!m) continue
    const port = Number(m[1])
    if (port < 1 || port > 65535) continue
    out.push({ port, https: !!m[2] })
  }
  return out
}

// Rangos privados: 10/8, 172.16/12, 192.168/16, 100.64/10 (Tailscale), loopback y link-local
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  const kind = isIP(host)
  if (kind === 4) {
    const [a, b] = host.split('.').map(Number)
    return (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254)
    )
  }
  if (kind === 6) return host === '::1' || /^f[cd]/.test(host) || /^fe[89ab]/.test(host)
  // Nombres: locales o sin dominio (resolución por DNS interno / mDNS)
  return (
    !host.includes('.') ||
    host.endsWith('.local') ||
    host.endsWith('.lan') ||
    host.endsWith('.home.arpa') ||
    host.endsWith('.internal') ||
    host.endsWith('.ts.net')
  )
}

function shortHash(text: string): string {
  return createHash('sha1').update(text).digest('hex').slice(0, 6)
}

export interface GuestInfo {
  vmid: number
  name: string
  description: string
  tags: string[]
  ips: string[]
}

export interface DiscoveryResult {
  panels: Panel[]
  pending: Panel[] // externos sin aprobar: no se cargan hasta que el usuario los apruebe
  diagnostics: Diagnostic[]
}

export function discoverPanels(guest: GuestInfo, approvedOrigins: ReadonlySet<string>): DiscoveryResult {
  const diagnostics: Diagnostic[] = []
  const candidates: Panel[] = []

  const add = (p: ParsedPanel, source: Panel['source']): void => {
    const hostname = new URL(p.url).hostname
    candidates.push({
      id: `pve-${guest.vmid}-${shortHash(p.url)}`,
      name: p.name,
      url: p.url,
      icon: p.icon,
      source,
      vmid: guest.vmid,
      ...(isPrivateHost(hostname) ? {} : { external: true })
    })
  }

  const notes = parseNotes(guest.description)
  for (const line of notes.issues) {
    diagnostics.push({
      kind: 'note-line',
      vmid: guest.vmid,
      guest: guest.name,
      text: `Línea de notas no válida: ${line}`
    })
  }
  for (const p of notes.panels) add(p, 'proxmox-notes')

  const webTags = parseWebTags(guest.tags)
  if (webTags.length > 0 && guest.ips.length === 0) {
    diagnostics.push({
      kind: 'no-ip',
      vmid: guest.vmid,
      guest: guest.name,
      text: 'Tiene un tag web-<puerto> pero no se detectó su IP (¿falta qemu-guest-agent?)'
    })
  } else {
    for (const { port, https } of webTags) {
      const url = safeHttpUrl(`${https ? 'https' : 'http'}://${guest.ips[0]}:${port}`)
      if (url) add({ name: guest.name, url }, 'proxmox-tag')
    }
  }

  const seen = new Set<string>()
  const panels: Panel[] = []
  const pending: Panel[] = []
  for (const p of candidates) {
    if (seen.has(p.id)) continue
    seen.add(p.id)
    if (p.external && !approvedOrigins.has(new URL(p.url).origin)) {
      pending.push(p)
      diagnostics.push({
        kind: 'external-pending',
        vmid: guest.vmid,
        guest: guest.name,
        url: p.url,
        text: `Panel con host fuera de rangos privados, pendiente de aprobar: ${p.url}`
      })
    } else {
      panels.push(p)
    }
  }
  return { panels, pending, diagnostics }
}
