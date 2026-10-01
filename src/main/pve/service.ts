import { safeStorage } from 'electron'
import type {
  Diagnostic,
  Guest,
  GuestRef,
  Panel,
  PowerAction,
  PveConfigView,
  PveConnectionInput,
  PveSnapshot,
  PveStatus,
  ToastMessage
} from '../../shared/types'
import type { ConfigStore, StoredPve } from '../config/store'
import { log } from '../log'
import { CertMismatchError, HttpError, PveClient } from './client'
import { discoverPanels } from './discovery'
import {
  guestConfigSchema,
  ipsFromAgent,
  ipsFromConfig,
  ipsFromLxcInterfaces,
  osIdFromAgent,
  parseResources,
  parseTags,
  type ParsedGuest,
  type ParsedNode
} from './mapping'

const DETAIL_TTL_MS = 60_000
const MAX_BACKOFF_MS = 60_000
const DETAIL_CONCURRENCY = 4
const TASK_POLL_MS = 1000
const TASK_MAX_POLLS = 180

interface Detail {
  description: string
  tags: string[]
  osType?: string
  osId?: string
  ips: string[]
  fetchedAt: number
  status: string // estado del guest cuando se leyó: si cambia, se vuelve a leer (las IPs aparecen al arrancar)
}

const ACTION_VERB: Record<PowerAction, { doing: string; done: string }> = {
  start: { doing: 'Iniciando', done: 'iniciado' },
  shutdown: { doing: 'Apagando', done: 'apagado' },
  stop: { doing: 'Forzando apagado de', done: 'detenido' },
  reboot: { doing: 'Reiniciando', done: 'reiniciado' }
}

const guestKey = (node: string, vmid: number): string => `${node}/${vmid}`

export function describeError(e: unknown): { status: PveStatus; message: string } {
  if (e instanceof CertMismatchError) {
    return { status: 'cert-changed', message: 'El certificado de Proxmox cambió' }
  }
  if (e instanceof HttpError) {
    if (e.status === 401) return { status: 'unauthorized', message: 'Token inválido o revocado (401)' }
    if (e.status === 403) return { status: 'error', message: 'El token no tiene permiso para leer los recursos (403)' }
    return { status: 'error', message: `Proxmox respondió con error ${e.status}` }
  }
  return { status: 'offline', message: 'Sin conexión (¿Tailscale activo?)' }
}

export class PveService {
  private cfg: StoredPve | null = null
  private secret: string | null = null
  private client: PveClient | null = null

  private status: PveStatus = 'unconfigured'
  private message: string | undefined
  private nodes: ParsedNode[] = []
  private guests: ParsedGuest[] = []
  private details = new Map<string, Detail>()
  private busy = new Map<string, PowerAction>()
  private canPower = true
  private updatedAt: number | null = null

  private timer: NodeJS.Timeout | null = null
  private polling = false
  private pollQueued = false
  private forceDetails = false
  private failures = 0
  private blocked = false // 401 / certificado cambiado: no se insiste hasta que el usuario actúe
  private active = true
  private stopped = false

  private snapshot: PveSnapshot

  constructor(
    private store: ConfigStore,
    private onSnapshot: (snapshot: PveSnapshot) => void,
    private onToast: (toast: Omit<ToastMessage, 'id'>) => void
  ) {
    this.snapshot = this.build()
  }

  // ---- Ciclo de vida ----

  start(): void {
    this.stopped = false
    this.cfg = this.store.get().pve
    this.secret = null
    this.client = null
    if (!this.cfg) {
      this.setStatus('unconfigured')
      return
    }
    const enc = this.cfg.tokenSecretEnc
    if (enc && safeStorage.isEncryptionAvailable()) {
      try {
        this.secret = safeStorage.decryptString(Buffer.from(enc, 'base64'))
      } catch (e) {
        log.warn(`No se pudo descifrar el secreto: ${e instanceof Error ? e.message : e}`)
      }
    }
    if (!this.secret) {
      this.setStatus('needs-secret', 'Introduce de nuevo el secreto del token')
      return
    }
    this.client = this.makeClient(this.cfg, this.secret)
    this.setStatus('connecting')
    this.blocked = false
    this.failures = 0
    this.schedule(0)
  }

  stop(): void {
    this.stopped = true
    this.clearTimer()
  }

  setActive(active: boolean): void {
    this.active = active
    if (!active) return this.clearTimer()
    if (this.client && !this.blocked && !this.timer && !this.polling) this.schedule(0)
  }

  getConfigView(): PveConfigView | null {
    if (!this.cfg) return null
    const { host, port, tokenId, fingerprint, pollIntervalSec } = this.cfg
    return { host, port, tokenId, fingerprint, pollIntervalSec, secretStored: !!this.cfg.tokenSecretEnc }
  }

  getSnapshot(): PveSnapshot {
    return this.snapshot
  }

  // Paneles descubiertos y aprobados de todos los guests
  discoveredPanels(): Panel[] {
    const seen = new Set<string>()
    const out: Panel[] = []
    for (const g of this.snapshot.guests) {
      for (const p of g.panels) {
        if (seen.has(p.id)) continue
        seen.add(p.id)
        out.push(p)
      }
    }
    return out
  }

  // ---- Configuración ----

  async test(input: PveConnectionInput): Promise<string> {
    const client = this.makeClient(
      { ...input, tokenSecretEnc: null },
      input.secret
    )
    const v = await client.version()
    return v.version
  }

  save(input: PveConnectionInput): void {
    const enc = safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(input.secret).toString('base64')
      : null // sin cifrado disponible no se guarda en claro: se pedirá en cada arranque
    const cfg: StoredPve = {
      host: input.host,
      port: input.port,
      tokenId: input.tokenId,
      tokenSecretEnc: enc,
      fingerprint: input.fingerprint,
      pollIntervalSec: input.pollIntervalSec
    }
    this.store.update((c) => {
      c.pve = cfg
      // El usuario confirmó esta huella en el asistente: las vistas web del mismo host la reutilizan
      c.trustedCerts[input.host] = input.fingerprint
    })
    this.clearTimer()
    this.guests = []
    this.nodes = []
    this.details.clear()
    this.canPower = true
    this.cfg = cfg
    this.secret = input.secret
    this.client = this.makeClient(cfg, input.secret)
    this.blocked = false
    this.failures = 0
    this.setStatus('connecting')
    this.schedule(0)
  }

  forget(): void {
    this.clearTimer()
    this.store.update((c) => {
      c.pve = null
    })
    this.cfg = null
    this.secret = null
    this.client = null
    this.guests = []
    this.nodes = []
    this.details.clear()
    this.setStatus('unconfigured')
  }

  approveExternal(url: string): void {
    const origin = new URL(url).origin
    this.store.update((c) => {
      if (!c.approvedExternal.includes(origin)) c.approvedExternal.push(origin)
    })
    this.emit()
  }

  // ---- Refresco ----

  refresh(): void {
    if (!this.client) return
    this.forceDetails = true
    this.canPower = true
    this.blocked = false
    this.failures = 0
    this.clearTimer()
    void this.poll()
  }

  private schedule(delayMs?: number): void {
    this.clearTimer()
    if (this.stopped || !this.client || this.blocked || !this.active) return
    const interval = (this.cfg?.pollIntervalSec ?? 10) * 1000
    const delay =
      delayMs ?? (this.failures > 0 ? Math.min(interval * 2 ** this.failures, MAX_BACKOFF_MS) : interval)
    this.timer = setTimeout(() => void this.poll(), delay)
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private async poll(): Promise<void> {
    if (!this.client) return
    if (this.polling) {
      this.pollQueued = true
      return
    }
    this.polling = true
    try {
      const raw = await this.client.resources()
      const parsed = parseResources(raw)
      this.guests = parsed.guests
      this.nodes = parsed.nodes
      await this.refreshDetails(this.client)
      this.failures = 0
      this.updatedAt = Date.now()
      this.setStatus('connected')
    } catch (e) {
      this.handleError(e)
    } finally {
      this.polling = false
      if (this.pollQueued) {
        this.pollQueued = false
        void this.poll()
      } else {
        this.schedule()
      }
    }
  }

  private handleError(e: unknown): void {
    const { status, message } = describeError(e)
    if (status === 'cert-changed' || status === 'unauthorized') this.blocked = true
    else this.failures++
    if (status !== this.status) log.warn(`Proxmox: ${status} — ${message}`)
    this.setStatus(status, message)
  }

  // Notas, tags e IPs cambian poco: se leen al ver un guest nuevo, al cambiar su estado y cada ~60 s
  private async refreshDetails(client: PveClient): Promise<void> {
    const now = Date.now()
    const force = this.forceDetails
    this.forceDetails = false

    const keys = new Set(this.guests.map((g) => guestKey(g.node, g.vmid)))
    for (const k of this.details.keys()) if (!keys.has(k)) this.details.delete(k)

    const stale = this.guests.filter((g) => {
      const d = this.details.get(guestKey(g.node, g.vmid))
      return force || !d || d.status !== g.status || now - d.fetchedAt > DETAIL_TTL_MS
    })

    let next = 0
    const worker = async (): Promise<void> => {
      while (next < stale.length) {
        const g = stale[next++]
        const detail = await this.fetchDetail(client, g)
        if (detail) this.details.set(guestKey(g.node, g.vmid), detail)
      }
    }
    await Promise.all(Array.from({ length: Math.min(DETAIL_CONCURRENCY, stale.length) }, worker))
  }

  private async fetchDetail(client: PveClient, g: ParsedGuest): Promise<Detail | null> {
    const previous = this.details.get(guestKey(g.node, g.vmid))
    let description = previous?.description ?? ''
    let tags = previous?.tags ?? g.tags
    let configIps: string[] = previous?.ips ?? []
    let osType = previous?.osType
    let osId = previous?.osId
    try {
      const cfg = guestConfigSchema.parse(await client.guestConfig(g.node, g.type, g.vmid))
      description = cfg.description ?? ''
      tags = cfg.tags ? parseTags(cfg.tags) : []
      configIps = ipsFromConfig(cfg)
      osType = typeof cfg.ostype === 'string' && /^[a-z0-9_-]{1,20}$/i.test(cfg.ostype) ? cfg.ostype.toLowerCase() : undefined
    } catch (e) {
      // Un 401/certificado cambiado debe cortar el ciclo; el resto (403 en un guest, etc.) solo afecta a ese guest
      if (e instanceof CertMismatchError || (e instanceof HttpError && e.status === 401)) throw e
      if (!previous) return null
    }

    let ips: string[] = []
    if (g.status === 'running') {
      try {
        ips =
          g.type === 'lxc'
            ? ipsFromLxcInterfaces(await client.lxcInterfaces(g.node, g.vmid))
            : ipsFromAgent(await client.agentInterfaces(g.node, g.vmid))
      } catch (e) {
        if (e instanceof CertMismatchError || (e instanceof HttpError && e.status === 401)) throw e
        // sin qemu-guest-agent o sin permiso: se usa la config como respaldo
      }
      if (g.type === 'qemu') {
        try {
          osId = osIdFromAgent(await client.agentOsInfo(g.node, g.vmid)) ?? osId
        } catch (e) {
          if (e instanceof CertMismatchError || (e instanceof HttpError && e.status === 401)) throw e
          // sin agente: se conserva lo último conocido
        }
      }
    }
    return {
      description,
      tags,
      osType,
      osId,
      ips: ips.length > 0 ? ips : configIps,
      fetchedAt: Date.now(),
      status: g.status
    }
  }

  // ---- Acciones de energía ----

  async action(ref: GuestRef, action: PowerAction): Promise<{ ok: boolean; message: string }> {
    const client = this.client
    const g = this.guests.find((x) => x.node === ref.node && x.vmid === ref.vmid && x.type === ref.type)
    if (!client || !g || g.template) return { ok: false, message: 'Guest no disponible o es una plantilla' }
    const key = guestKey(g.node, g.vmid)
    if (this.busy.has(key)) return { ok: false, message: 'Ya hay una acción en curso sobre este guest' }

    const label = `${g.vmid} ${g.name}`
    this.busy.set(key, action)
    this.emit()
    this.onToast({ kind: 'info', text: `${ACTION_VERB[action].doing} ${label}…` })
    log.info(`Acción ${action} sobre ${g.type}/${g.vmid}`)
    try {
      const upid = await client.power(g.node, g.type, g.vmid, action)
      await this.waitTask(client, g.node, upid)
      this.onToast({ kind: 'ok', text: `${label} ${ACTION_VERB[action].done}` })
      return { ok: true, message: `${label} ${ACTION_VERB[action].done}` }
    } catch (e) {
      let message: string
      if (e instanceof HttpError && e.status === 403) {
        this.canPower = false
        message = 'El token no tiene permiso de energía (403)'
      } else if (e instanceof HttpError || e instanceof CertMismatchError) {
        message = `No se pudo completar la acción: ${describeError(e).message}`
      } else {
        message = `Falló la acción sobre ${label}: ${e instanceof Error ? e.message : 'error desconocido'}`
      }
      this.onToast({ kind: 'error', text: message })
      log.warn(`Acción ${action} sobre ${g.type}/${g.vmid} falló: ${e instanceof Error ? e.message : e}`)
      return { ok: false, message }
    } finally {
      this.busy.delete(key)
      this.forceDetails = true
      this.emit()
      void this.poll()
    }
  }

  private async waitTask(client: PveClient, node: string, upid: string): Promise<void> {
    for (let i = 0; i < TASK_MAX_POLLS; i++) {
      await new Promise((r) => setTimeout(r, TASK_POLL_MS))
      if (this.stopped) return
      const t = await client.taskStatus(node, upid)
      if (t.status === 'stopped') {
        if (t.exitstatus && t.exitstatus !== 'OK') throw new Error(t.exitstatus)
        return
      }
    }
    throw new Error('la tarea sigue en curso tras 3 minutos')
  }

  // ---- Snapshot ----

  private setStatus(status: PveStatus, message?: string): void {
    this.status = status
    this.message = message
    this.emit()
  }

  private emit(): void {
    this.snapshot = this.build()
    this.onSnapshot(this.snapshot)
  }

  private build(): PveSnapshot {
    const approved = new Set(this.store.get().approvedExternal)
    const diagnostics: Diagnostic[] = []
    const guests: Guest[] = this.guests.map((g) => {
      const key = guestKey(g.node, g.vmid)
      const d = this.details.get(key)
      const tags = d?.tags ?? g.tags
      const ips = d?.ips ?? []
      const description = d?.description ?? ''
      const found = discoverPanels({ vmid: g.vmid, name: g.name, description, tags, ips }, approved)
      diagnostics.push(...found.diagnostics)
      if (g.status === 'running' && !g.template && d && ips.length === 0 && g.type === 'qemu') {
        diagnostics.push({
          kind: 'no-ip',
          vmid: g.vmid,
          guest: g.name,
          text: 'No se detectó su IP (¿qemu-guest-agent instalado y activado?)'
        })
      }
      return {
        key,
        vmid: g.vmid,
        name: g.name,
        node: g.node,
        type: g.type,
        status: g.status,
        template: g.template,
        cpu: g.cpu,
        maxcpu: g.maxcpu,
        mem: g.mem,
        maxmem: g.maxmem,
        uptime: g.uptime,
        tags,
        description,
        osType: d?.osType,
        osId: d?.osId,
        ips,
        panels: found.panels,
        busy: this.busy.get(key)
      }
    })
    if (!this.canPower) {
      diagnostics.push({
        kind: 'permission',
        text: 'El token no tiene permiso de energía (403): las acciones están deshabilitadas. Usa el rol PVEVMUser para poder iniciar/apagar.'
      })
    }
    return {
      status: this.status,
      message: this.message,
      nodes: this.nodes,
      guests,
      diagnostics,
      canPower: this.canPower,
      updatedAt: this.updatedAt
    }
  }

  private makeClient(cfg: StoredPve, secret: string): PveClient {
    return new PveClient({
      host: cfg.host,
      port: cfg.port,
      tokenId: cfg.tokenId,
      tokenSecret: secret,
      fingerprint: cfg.fingerprint
    })
  }
}
