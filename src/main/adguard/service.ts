import type { AdguardSnapshot } from '../../shared/types'
import {
  buildBlockedDomains,
  buildClients,
  buildRecent,
  isBlockedReason,
  parseClients,
  parseQueryLog,
  parseStats,
  parseStatus,
  type ClientNames,
  type LogEntry,
  type NameSources,
  type ParsedStats
} from './parse'

export interface AdguardCfg {
  url: string
  username?: string
  password?: string
}

export class AdguardError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AdguardError'
  }
}

const PATH = /^\/control\/[a-z/_-]+(\?[A-Za-z0-9=&._-]*)?$/
const MAX_BYTES = 6_000_000
const TTL = { status: 30_000, stats: 20_000, clients: 60_000, querylog: 20_000 }
const ERROR_RETRY_MS = 10_000

function networkMessage(e: unknown, url: string): string {
  const host = (() => {
    try {
      return new URL(url).host
    } catch {
      return url
    }
  })()
  const err = e as { name?: string; cause?: { code?: string }; message?: string }
  const code = err.cause?.code ?? ''
  if (err.name === 'TimeoutError' || err.name === 'AbortError') return `AdGuard Home no responde en ${host}`
  if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY/.test(code)) {
    return `El certificado de ${host} no es de confianza: usa http:// o un certificado válido`
  }
  if (/redirect/i.test(err.message ?? '')) return 'AdGuard Home redirige a otra dirección: usa la URL final (p. ej. https://…)'
  return `No se pudo conectar con AdGuard Home en ${host}`
}

// Lectura de la API de AdGuard Home (solo GET a /control/…, con autenticación básica si hay usuario)
export async function adguardGet(cfg: AdguardCfg, path: string, timeoutMs = 8000): Promise<unknown> {
  if (!PATH.test(path)) throw new AdguardError('Ruta no permitida')
  const headers: Record<string, string> = { accept: 'application/json' }
  if (cfg.username) headers.authorization = `Basic ${Buffer.from(`${cfg.username}:${cfg.password ?? ''}`).toString('base64')}`
  let res: Response
  try {
    res = await fetch(`${cfg.url.replace(/\/+$/, '')}${path}`, { headers, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) })
  } catch (e) {
    throw new AdguardError(networkMessage(e, cfg.url))
  }
  if (res.status === 401) throw new AdguardError('Usuario o contraseña incorrectos')
  if (res.status === 403) throw new AdguardError('AdGuard Home rechazó el acceso (¿demasiados intentos fallidos? espera unos minutos)')
  if (res.status === 404) throw new AdguardError('Esa dirección no parece AdGuard Home (no existe /control)')
  if (!res.ok) throw new AdguardError(`AdGuard Home respondió con error ${res.status}`)
  const text = await res.text()
  if (text.length > MAX_BYTES) throw new AdguardError('La respuesta de AdGuard Home es demasiado grande')
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new AdguardError('La respuesta no es de AdGuard Home (¿es la dirección del panel web correcta?)')
  }
}

interface Entry {
  at: number
  value?: unknown
  error?: string
}

export class AdguardService {
  private cache = new Map<string, Entry>()

  constructor(
    private getCfg: () => AdguardCfg | null,
    private guestNames: () => Map<string, string>
  ) {}

  private async section<T>(key: string, ttl: number, fn: () => Promise<T>): Promise<{ value?: T; error?: string }> {
    const hit = this.cache.get(key)
    const effective = hit?.error ? Math.min(ttl, ERROR_RETRY_MS) : ttl
    if (hit && Date.now() - hit.at < effective) return { value: hit.value as T | undefined, error: hit.error }
    try {
      const value = await fn()
      this.cache.set(key, { at: Date.now(), value })
      return { value }
    } catch (e) {
      const error = e instanceof Error ? e.message : 'No se pudo leer'
      this.cache.set(key, { at: Date.now(), value: hit?.value, error }) // se conserva el último dato bueno
      return { value: hit?.value as T | undefined, error }
    }
  }

  // Cambiar la configuración invalida lo guardado
  reset(): void {
    this.cache.clear()
  }

  async get(): Promise<AdguardSnapshot | null> {
    const cfg = this.getCfg()
    if (!cfg) return null
    const [status, stats, clients, log] = await Promise.all([
      this.section('status', TTL.status, async () => parseStatus(await adguardGet(cfg, '/control/status'))),
      this.section('stats', TTL.stats, async () => parseStats(await adguardGet(cfg, '/control/stats'))),
      this.section('clients', TTL.clients, async () => parseClients(await adguardGet(cfg, '/control/clients'))),
      this.section('querylog', TTL.querylog, async () => parseQueryLog(await adguardGet(cfg, '/control/querylog?limit=500&response_status=blocked')))
    ])
    const names: ClientNames = (clients.value as ClientNames | undefined) ?? { persistent: new Map(), auto: new Map() }
    const sources: NameSources = { persistent: names.persistent, guests: this.guestNames(), auto: names.auto }
    const s = (stats.value as ParsedStats | null | undefined) ?? null
    // El registro ya viene filtrado por «bloqueadas», pero se revisa el motivo por si la versión ignora el filtro
    const blocked: LogEntry[] = ((log.value as LogEntry[] | undefined) ?? []).filter((e) => !e.reason || isBlockedReason(e.reason))

    const errors: Record<string, string> = {}
    for (const [k, r] of [['status', status], ['stats', stats], ['clients', clients], ['querylog', log]] as const) {
      if (r.error) errors[k] = r.error
    }
    return {
      updatedAt: Date.now(),
      status: (status.value as AdguardSnapshot['status']) ?? null,
      stats: s
        ? { queries: s.queries, blocked: s.blocked, blockedPct: s.blockedPct, avgMs: s.avgMs, windowHours: s.windowHours, clients: s.topClients.length }
        : null,
      topBlocked: s ? buildBlockedDomains(s.topBlocked, blocked, sources) : [],
      clients: s ? buildClients(s.topClients, blocked, sources) : [],
      recent: buildRecent(blocked, sources),
      errors
    }
  }

  async test(cfg: AdguardCfg): Promise<{ ok: boolean; message: string }> {
    try {
      const status = parseStatus(await adguardGet(cfg, '/control/status'))
      if (!status) throw new AdguardError('La respuesta no es de AdGuard Home')
      const stats = parseStats(await adguardGet(cfg, '/control/stats'))
      const detail = stats ? ` · ${stats.queries.toLocaleString('es')} consultas, ${stats.blocked.toLocaleString('es')} bloqueadas` : ''
      return { ok: true, message: `Conexión correcta con AdGuard Home ${status.version}${detail}` }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) }
    }
  }
}
