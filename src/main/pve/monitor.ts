import type { MonitorSnapshot, Timeframe } from '../../shared/types'
import { CertMismatchError, HttpError, type PveClient } from './client'
import {
  parseApt,
  parseClusterLog,
  parseDisks,
  parseNodeStatus,
  parseProcesses,
  parseRrd,
  parseServices,
  parseStorage,
  parseSyslog,
  parseTasks,
  PROCESS_COMMAND
} from './monitorParse'

// Datos del panel de inicio. Cada sección se pide por separado y con su propio tiempo de caché: si una
// falla (p. ej. el token no tiene permiso para el syslog) las demás siguen funcionando.

interface Entry {
  at: number
  value?: unknown
  error?: string
}

const TTL = { status: 8_000, history: 45_000, storage: 30_000, tasks: 20_000, clusterLog: 30_000, syslog: 30_000, updates: 300_000, services: 120_000, disks: 600_000, processes: 12_000 }

export const NO_SSH = 'no-configurado'
const ERROR_RETRY_MS = 10_000
// Listar las actualizaciones exige Sys.Modify (es de escritura): PVEAuditor no lo incluye, es opcional
export const UPDATES_FORBIDDEN =
  'Ver las actualizaciones pendientes exige el permiso Sys.Modify, que es de escritura y el rol de solo lectura no incluye. Es opcional: el resto del panel funciona sin él.'
export const SYSLOG_FORBIDDEN =
  'Sin permiso para ver el syslog: hace falta el permiso Sys.Syslog, que el rol PVEAuditor no incluye (se lo da PVEAdmin o un rol propio). El resto del panel no lo necesita.'

function describe(e: unknown, what: string, forbidden?: string): string {
  if (e instanceof CertMismatchError) return 'El certificado de Proxmox cambió'
  if (e instanceof HttpError) {
    if (e.status === 403) return forbidden ?? `Sin permiso para ver ${what}: da al token el rol PVEAuditor además de PVEVMUser`
    if (e.status === 404 || e.status === 501) return `${what} no está disponible en esta versión de Proxmox`
    if (e.status === 401) return 'Token inválido (401)'
    return `Proxmox respondió con error ${e.status}`
  }
  return e instanceof Error ? e.message : 'No se pudo leer'
}

export class MonitorService {
  private cache = new Map<string, Entry>()

  constructor(
    private getClient: () => PveClient | null,
    private sshExec: (connId: string, command: string) => Promise<{ exitCode: number | null; output: string; truncated: boolean }>,
    private monitorSshId: () => string | undefined
  ) {}

  private async section<T>(key: string, ttl: number, what: string, fn: () => Promise<T>, forbidden?: string): Promise<{ value?: T; error?: string }> {
    const hit = this.cache.get(key)
    const effective = hit?.error ? Math.min(ttl, ERROR_RETRY_MS) : ttl
    if (hit && Date.now() - hit.at < effective) return { value: hit.value as T | undefined, error: hit.error }
    try {
      const value = await fn()
      this.cache.set(key, { at: Date.now(), value })
      return { value }
    } catch (e) {
      const error = e instanceof Error && e.message.startsWith('SSH:') ? e.message.slice(4).trim() : describe(e, what, forbidden)
      // Se conserva el último dato bueno si lo hay, para que un fallo puntual no vacíe la pantalla
      this.cache.set(key, { at: Date.now(), value: hit?.value, error })
      return { value: hit?.value as T | undefined, error }
    }
  }

  async get(node: string, timeframe: Timeframe): Promise<MonitorSnapshot> {
    const client = this.getClient()
    const base: MonitorSnapshot = {
      node,
      timeframe,
      updatedAt: Date.now(),
      status: null,
      history: [],
      storage: [],
      tasks: [],
      clusterLog: [],
      syslog: [],
      services: [],
      updates: null,
      disks: [],
      processes: [],
      errors: {}
    }
    if (!client) {
      base.errors = Object.fromEntries(['status', 'history', 'storage', 'tasks', 'clusterLog', 'syslog', 'services', 'updates', 'disks', 'processes'].map((k) => [k, 'Sin conexión con Proxmox']))
      return base
    }
    const n = `/nodes/${node}`
    const k = (s: string): string => `${node}|${s}`
    const sshId = this.monitorSshId()

    const [status, history, storage, tasks, clusterLog, syslog, services, updates, disks, processes] = await Promise.all([
      this.section(k('status'), TTL.status, 'el estado del nodo', async () => parseNodeStatus(await client.getMonitor(`${n}/status`))),
      this.section(k(`history-${timeframe}`), TTL.history, 'el historial', async () => parseRrd(await client.getMonitor(`${n}/rrddata?timeframe=${timeframe}&cf=AVERAGE`))),
      this.section(k('storage'), TTL.storage, 'el almacenamiento', async () => parseStorage(await client.getMonitor(`${n}/storage`))),
      this.section(k('tasks'), TTL.tasks, 'las tareas', async () => parseTasks(await client.getMonitor(`${n}/tasks?limit=60`))),
      this.section(k('clusterLog'), TTL.clusterLog, 'el registro del clúster', async () => parseClusterLog(await client.getMonitor('/cluster/log?max=80'))),
      this.section(k('syslog'), TTL.syslog, 'el syslog', async () => parseSyslog(await client.getMonitor(`${n}/syslog?limit=120`)), SYSLOG_FORBIDDEN),
      this.section(k('services'), TTL.services, 'los servicios', async () => parseServices(await client.getMonitor(`${n}/services`))),
      this.section(k('updates'), TTL.updates, 'las actualizaciones', async () => parseApt(await client.getMonitor(`${n}/apt/update`)), UPDATES_FORBIDDEN),
      this.section(k('disks'), TTL.disks, 'los discos', async () => parseDisks(await client.getMonitor(`${n}/disks/list`))),
      sshId
        ? this.section(k(`processes-${sshId}`), TTL.processes, 'los procesos', async () => {
            try {
              const r = await this.sshExec(sshId, PROCESS_COMMAND)
              return parseProcesses(r.output)
            } catch (e) {
              throw new Error(`SSH: ${e instanceof Error ? e.message : 'no se pudo ejecutar'}`)
            }
          })
        : Promise.resolve({ value: [] as never, error: NO_SSH })
    ])

    base.status = status.value ?? null
    base.history = history.value ?? []
    base.storage = storage.value ?? []
    base.tasks = tasks.value ?? []
    base.clusterLog = clusterLog.value ?? []
    base.syslog = syslog.value ?? []
    base.services = services.value ?? []
    base.updates = updates.value ?? null
    base.disks = disks.value ?? []
    base.processes = processes.value ?? []
    const errs: [string, string | undefined][] = [
      ['status', status.error], ['history', history.error], ['storage', storage.error], ['tasks', tasks.error], ['clusterLog', clusterLog.error],
      ['syslog', syslog.error], ['services', services.error], ['updates', updates.error], ['disks', disks.error], ['processes', processes.error]
    ]
    for (const [key, error] of errs) if (error) base.errors[key] = error
    return base
  }
}
