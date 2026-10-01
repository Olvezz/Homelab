import { isIP } from 'node:net'
import type { AdguardBlockedDomain, AdguardBlockedEntry, AdguardClientStat } from '../../shared/types'

// Lectores defensivos de la API de AdGuard Home. Cualquier campo ausente se ignora.

type Rec = Record<string, unknown>
const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown, max = 200): string => (typeof v === 'string' ? v.slice(0, max) : '')
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

// net.isIP distingue una IPv6 de una MAC (00:11:22:33:44:55) o un CIDR, que no son IP
const looksLikeIp = (s: string): boolean => isIP(s) !== 0

export function parseStatus(raw: unknown): { running: boolean; protection: boolean; version: string } | null {
  if (!isRec(raw)) return null
  return { running: raw.running !== false, protection: raw.protection_enabled !== false, version: str(raw.version, 40) }
}

// Las listas "top" son [{ "clave": n }, { "otra": m }]
export function topList(raw: unknown, limit = 50): { key: string; count: number }[] {
  if (!Array.isArray(raw)) return []
  const out: { key: string; count: number }[] = []
  for (const item of raw) {
    if (!isRec(item)) continue
    for (const [key, count] of Object.entries(item)) {
      if (typeof count === 'number') out.push({ key: key.slice(0, 200), count })
    }
  }
  return out.sort((a, b) => b.count - a.count).slice(0, limit)
}

export interface ParsedStats {
  queries: number
  blocked: number
  blockedPct: number
  avgMs: number
  windowHours: number
  topBlocked: { key: string; count: number }[]
  topClients: { key: string; count: number }[]
  topQueried: { key: string; count: number }[]
}

export function parseStats(raw: unknown): ParsedStats | null {
  if (!isRec(raw)) return null
  const queries = num(raw.num_dns_queries)
  const blocked = num(raw.num_blocked_filtering) + num(raw.num_replaced_safebrowsing) + num(raw.num_replaced_parental)
  const unit = raw.time_units === 'days' ? 24 : 1
  const points = Array.isArray(raw.dns_queries) ? raw.dns_queries.length : 24
  return {
    queries,
    blocked,
    blockedPct: queries > 0 ? blocked / queries : 0,
    avgMs: num(raw.avg_processing_time) * 1000,
    windowHours: Math.max(1, points * unit),
    topBlocked: topList(raw.top_blocked_domains),
    topClients: topList(raw.top_clients),
    topQueried: topList(raw.top_queried_domains)
  }
}

export interface ClientNames {
  persistent: Map<string, string> // nombres que el usuario puso en AdGuard
  auto: Map<string, { name: string; source: string }> // los que AdGuard averigua (rDNS, DHCP, ARP…)
}

export function parseClients(raw: unknown): ClientNames {
  const persistent = new Map<string, string>()
  const auto = new Map<string, { name: string; source: string }>()
  if (!isRec(raw)) return { persistent, auto }
  if (Array.isArray(raw.clients)) {
    for (const c of raw.clients) {
      if (!isRec(c)) continue
      const name = str(c.name, 80)
      if (!name || !Array.isArray(c.ids)) continue
      for (const id of c.ids) if (typeof id === 'string' && looksLikeIp(id)) persistent.set(id, name)
    }
  }
  if (Array.isArray(raw.auto_clients)) {
    for (const c of raw.auto_clients) {
      if (!isRec(c)) continue
      const ip = str(c.ip, 60)
      const name = str(c.name, 80)
      if (ip && name && name !== ip) auto.set(ip, { name, source: str(c.source, 30) })
    }
  }
  return { persistent, auto }
}

export interface LogEntry {
  time: number // epoch ms
  ip: string
  name?: string // nombre que AdGuard ya resolvió para ese cliente
  domain: string
  reason: string
  rule?: string
}

export function parseQueryLog(raw: unknown): LogEntry[] {
  if (!isRec(raw) || !Array.isArray(raw.data)) return []
  const out: LogEntry[] = []
  for (const r of raw.data) {
    if (!isRec(r)) continue
    const question = isRec(r.question) ? r.question : {}
    const domain = str(question.name, 253).replace(/\.$/, '').toLowerCase()
    const ip = str(r.client, 60)
    if (!domain || !ip) continue
    const info = isRec(r.client_info) ? r.client_info : {}
    const rules = Array.isArray(r.rules) ? r.rules : []
    const rule = isRec(rules[0]) ? str(rules[0].text, 120) : undefined
    const name = str(info.name, 80)
    out.push({
      time: Date.parse(str(r.time, 40)) || 0,
      ip,
      name: name && name !== ip ? name : undefined,
      domain,
      reason: str(r.reason, 40),
      rule: rule || undefined
    })
  }
  return out
}

// Bloqueada = filtrada por una lista, servicio bloqueado, navegación segura o control parental.
// SafeSearch reescribe, no bloquea.
export function isBlockedReason(reason: string): boolean {
  return /^Filtered/.test(reason) && reason !== 'FilteredSafeSearch'
}

export interface NameSources {
  persistent: Map<string, string>
  guests: Map<string, string> // IP -> nombre del guest de Proxmox (o conexión SSH)
  auto: Map<string, { name: string; source: string }>
}

// Prioridad: nombre que tú pusiste en AdGuard > guest de tu Proxmox > lo que AdGuard averigua > lo que dice el registro
export function resolveName(ip: string, sources: NameSources, logName?: string): { name?: string; source?: string } {
  const p = sources.persistent.get(ip)
  if (p) return { name: p, source: 'AdGuard' }
  const g = sources.guests.get(ip)
  if (g) return { name: g, source: 'Proxmox' }
  const a = sources.auto.get(ip)
  if (a) return { name: a.name, source: a.source || 'AdGuard' }
  if (logName) return { name: logName, source: 'AdGuard' }
  return {}
}

export function buildClients(
  topClients: { key: string; count: number }[],
  blocked: LogEntry[],
  sources: NameSources,
  limit = 15
): AdguardClientStat[] {
  const blockedBy = new Map<string, number>()
  const logNames = new Map<string, string>()
  for (const e of blocked) {
    blockedBy.set(e.ip, (blockedBy.get(e.ip) ?? 0) + 1)
    if (e.name) logNames.set(e.ip, e.name)
  }
  return topClients.slice(0, limit).map((c) => {
    const n = resolveName(c.key, sources, logNames.get(c.key))
    return { ip: c.key, name: n.name, nameSource: n.source, queries: c.count, blocked: blockedBy.get(c.key) ?? 0 }
  })
}

export function buildBlockedDomains(
  topBlocked: { key: string; count: number }[],
  blocked: LogEntry[],
  sources: NameSources,
  limit = 10
): AdguardBlockedDomain[] {
  const byDomain = new Map<string, Map<string, { count: number; logName?: string }>>()
  for (const e of blocked) {
    const m = byDomain.get(e.domain) ?? new Map()
    const cur = m.get(e.ip) ?? { count: 0, logName: e.name }
    cur.count++
    m.set(e.ip, cur)
    byDomain.set(e.domain, m)
  }
  return topBlocked.slice(0, limit).map((d) => {
    const clients = [...(byDomain.get(d.key) ?? new Map<string, { count: number; logName?: string }>()).entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 4)
      .map(([ip, v]) => ({ ip, name: resolveName(ip, sources, v.logName).name, count: v.count }))
    return { domain: d.key, count: d.count, clients }
  })
}

export function buildRecent(blocked: LogEntry[], sources: NameSources, limit = 25): AdguardBlockedEntry[] {
  return blocked.slice(0, limit).map((e) => ({
    time: e.time,
    ip: e.ip,
    name: resolveName(e.ip, sources, e.name).name,
    domain: e.domain,
    rule: e.rule
  }))
}
