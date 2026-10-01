import type {
  DiskInfo,
  LogLine,
  LogLevel,
  MonitorNodeInfo,
  ProcessInfo,
  RrdPoint,
  ServiceInfo,
  StorageInfo,
  TaskInfo
} from '../../shared/types'

// Lectores defensivos de las respuestas del API de Proxmox para el panel de inicio: cualquier campo
// ausente o raro se ignora en vez de romper la pantalla.

type Rec = Record<string, unknown>

const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v)

export function num(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : undefined
  }
  return undefined
}

const text = (v: unknown, max = 300): string => (typeof v === 'string' ? v.slice(0, max) : '')

export function parseNodeStatus(raw: unknown): MonitorNodeInfo | null {
  if (!isRec(raw)) return null
  const mem = isRec(raw.memory) ? raw.memory : {}
  const swap = isRec(raw.swap) ? raw.swap : {}
  const root = isRec(raw.rootfs) ? raw.rootfs : {}
  const cpuinfo = isRec(raw.cpuinfo) ? raw.cpuinfo : {}
  const load = Array.isArray(raw.loadavg) ? raw.loadavg.map(num) : []
  return {
    uptime: num(raw.uptime) ?? 0,
    cpu: num(raw.cpu) ?? 0,
    ioWait: num(raw.wait) ?? 0,
    load: [load[0] ?? 0, load[1] ?? 0, load[2] ?? 0],
    mem: { used: num(mem.used) ?? 0, total: num(mem.total) ?? 0 },
    swap: { used: num(swap.used) ?? 0, total: num(swap.total) ?? 0 },
    rootfs: { used: num(root.used) ?? 0, total: num(root.total) ?? 0 },
    cpuModel: text(cpuinfo.model, 120) || undefined,
    cores: num(cpuinfo.cpus) ?? num(cpuinfo.cores),
    sockets: num(cpuinfo.sockets),
    kernel: text(raw.kversion, 120) || undefined,
    pveVersion: text(raw.pveversion, 120).replace(/^pve-manager\//, '').split('/')[0] || undefined
  }
}

// rrddata: una fila por intervalo; los últimos puntos pueden venir vacíos
export function parseRrd(raw: unknown): RrdPoint[] {
  if (!Array.isArray(raw)) return []
  const out: RrdPoint[] = []
  for (const r of raw) {
    if (!isRec(r)) continue
    const t = num(r.time)
    if (t === undefined) continue
    const p: RrdPoint = {
      t,
      cpu: num(r.cpu),
      ioWait: num(r.iowait),
      load: num(r.loadavg),
      memUsed: num(r.memused),
      memTotal: num(r.memtotal),
      netIn: num(r.netin),
      netOut: num(r.netout)
    }
    if ([p.cpu, p.memUsed, p.netIn, p.netOut, p.load].some((v) => v !== undefined)) out.push(p)
  }
  return out.sort((a, b) => a.t - b.t)
}

export function parseStorage(raw: unknown): StorageInfo[] {
  if (!Array.isArray(raw)) return []
  const out: StorageInfo[] = []
  for (const r of raw) {
    if (!isRec(r) || typeof r.storage !== 'string') continue
    out.push({
      id: r.storage.slice(0, 60),
      type: text(r.type, 30),
      used: num(r.used) ?? 0,
      total: num(r.total) ?? 0,
      active: r.active === 1 || r.active === true,
      shared: r.shared === 1 || r.shared === true,
      content: text(r.content, 100)
    })
  }
  return out.sort((a, b) => a.id.localeCompare(b.id))
}

export function parseTasks(raw: unknown): TaskInfo[] {
  if (!Array.isArray(raw)) return []
  const out: TaskInfo[] = []
  for (const r of raw) {
    if (!isRec(r) || typeof r.upid !== 'string') continue
    const start = num(r.starttime) ?? 0
    const end = num(r.endtime)
    const status = text(r.status, 200)
    let state: TaskInfo['state'] = 'running'
    if (end !== undefined || status) {
      if (status === 'OK') state = 'ok'
      else if (/^WARNINGS/i.test(status)) state = 'warn'
      else state = status ? 'error' : 'ok'
    }
    out.push({
      upid: r.upid.slice(0, 200),
      type: text(r.type, 40),
      id: text(r.id, 60) || undefined,
      user: text(r.user, 60),
      start,
      end,
      state,
      status
    })
  }
  return out.sort((a, b) => b.start - a.start)
}

function levelFromText(t: string): LogLevel {
  if (/\b(error|fail(ed|ure)?|critical|crit|panic|fatal|denied|refused)\b/i.test(t)) return 'error'
  if (/\b(warn(ing)?|timeout|timed out|retry)\b/i.test(t)) return 'warn'
  return 'info'
}

// /cluster/log: `pri` es la prioridad de syslog (0-7)
export function parseClusterLog(raw: unknown): LogLine[] {
  if (!Array.isArray(raw)) return []
  const out: LogLine[] = []
  for (const r of raw) {
    if (!isRec(r)) continue
    const msg = text(r.msg, 500)
    if (!msg) continue
    const pri = num(r.pri)
    out.push({
      time: num(r.time),
      source: [text(r.node, 40), text(r.tag, 40)].filter(Boolean).join(' · '),
      text: msg,
      level: pri !== undefined ? (pri <= 3 ? 'error' : pri === 4 ? 'warn' : 'info') : levelFromText(msg)
    })
  }
  return out.sort((a, b) => (b.time ?? 0) - (a.time ?? 0))
}

// /nodes/{node}/syslog: [{ n: número de línea, t: texto }] ya con la marca de tiempo dentro del texto
export function parseSyslog(raw: unknown): LogLine[] {
  if (!Array.isArray(raw)) return []
  const out: LogLine[] = []
  for (const r of raw) {
    if (!isRec(r)) continue
    const t = text(r.t, 600)
    if (!t) continue
    out.push({ source: 'syslog', text: t, level: levelFromText(t) })
  }
  return out.reverse() // lo más reciente primero
}

export function parseServices(raw: unknown): ServiceInfo[] {
  if (!Array.isArray(raw)) return []
  const out: ServiceInfo[] = []
  for (const r of raw) {
    if (!isRec(r)) continue
    const name = text(r.service ?? r.name, 60)
    if (!name) continue
    out.push({ name, description: text(r.desc, 120), running: r.state === 'running' })
  }
  return out.sort((a, b) => Number(a.running) - Number(b.running) || a.name.localeCompare(b.name))
}

export function parseApt(raw: unknown): { count: number; packages: string[] } {
  if (!Array.isArray(raw)) return { count: 0, packages: [] }
  const packages = raw
    .filter(isRec)
    .map((r) => text(r.Package, 80))
    .filter(Boolean)
  return { count: packages.length, packages: packages.slice(0, 40) }
}

export function parseDisks(raw: unknown): DiskInfo[] {
  if (!Array.isArray(raw)) return []
  const out: DiskInfo[] = []
  for (const r of raw) {
    if (!isRec(r)) continue
    const dev = text(r.devpath, 40)
    if (!dev) continue
    out.push({
      dev,
      model: text(r.model, 80),
      size: num(r.size) ?? 0,
      type: text(r.type, 10),
      health: text(r.health, 20) || 'UNKNOWN'
    })
  }
  return out
}

// `ps -eo pid,user:14,pcpu,pmem,etime,comm --sort=-pcpu`
export function parseProcesses(output: string): ProcessInfo[] {
  const out: ProcessInfo[] = []
  for (const line of output.split(/\r?\n/).slice(1)) {
    const m = /^\s*(\d+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+(\S+)\s+(.+?)\s*$/.exec(line)
    if (!m) continue
    out.push({ pid: Number(m[1]), user: m[2], cpu: Number(m[3]), mem: Number(m[4]), elapsed: m[5], command: m[6].slice(0, 60) })
  }
  return out
}

export const PROCESS_COMMAND = 'ps -eo pid,user:14,pcpu,pmem,etime,comm --sort=-pcpu | head -n 16'
