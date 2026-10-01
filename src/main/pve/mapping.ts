import { z } from 'zod'
import type { GuestStatus, GuestType } from '../../shared/types'

// Las respuestas del API se validan con zod en el borde antes de usarse.

const num = z.number().catch(0)

const resourceSchema = z.object({
  type: z.string(),
  node: z.string().regex(/^[A-Za-z0-9-]{1,63}$/),
  vmid: z.number().int().positive().optional(),
  name: z.string().max(200).optional(),
  status: z.string().optional(),
  template: z.union([z.number(), z.boolean()]).optional(),
  cpu: num,
  maxcpu: num,
  mem: num,
  maxmem: num,
  uptime: num,
  tags: z.string().optional(),
  netin: num,
  netout: num,
  diskread: num,
  diskwrite: num,
  disk: num,
  maxdisk: num
})

export interface ParsedGuest {
  vmid: number
  name: string
  node: string
  type: GuestType
  status: GuestStatus
  template: boolean
  cpu: number
  maxcpu: number
  mem: number
  maxmem: number
  uptime: number
  tags: string[]
  netin: number
  netout: number
  diskread: number
  diskwrite: number
  disk: number
  maxdisk: number
}

export interface ParsedNode {
  name: string
  online: boolean
  cpu: number
  maxcpu: number
  mem: number
  maxmem: number
  uptime: number
  disk: number
  maxdisk: number
}

export function parseTags(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(/[;, ]+/)
    .map((t) => t.trim())
    .filter(Boolean)
}

function toStatus(raw: string | undefined): GuestStatus {
  if (raw === 'running' || raw === 'stopped' || raw === 'paused') return raw
  return 'unknown'
}

// /cluster/resources -> guests y nodos. Una entrada defectuosa no tumba el resto.
export function parseResources(raw: unknown): { guests: ParsedGuest[]; nodes: ParsedNode[] } {
  const guests: ParsedGuest[] = []
  const nodes: ParsedNode[] = []
  if (!Array.isArray(raw)) return { guests, nodes }
  for (const item of raw) {
    const r = resourceSchema.safeParse(item)
    if (!r.success) continue
    const v = r.data
    if ((v.type === 'qemu' || v.type === 'lxc') && v.vmid !== undefined) {
      guests.push({
        vmid: v.vmid,
        name: v.name ?? `${v.type}-${v.vmid}`,
        node: v.node,
        type: v.type,
        status: toStatus(v.status),
        template: v.template === 1 || v.template === true,
        cpu: v.cpu,
        maxcpu: v.maxcpu,
        mem: v.mem,
        maxmem: v.maxmem,
        uptime: v.uptime,
        tags: parseTags(v.tags),
        netin: v.netin,
        netout: v.netout,
        diskread: v.diskread,
        diskwrite: v.diskwrite,
        disk: v.disk,
        maxdisk: v.maxdisk
      })
    } else if (v.type === 'node') {
      nodes.push({
        name: v.node,
        online: v.status === 'online',
        cpu: v.cpu,
        maxcpu: v.maxcpu,
        mem: v.mem,
        maxmem: v.maxmem,
        uptime: v.uptime,
        disk: v.disk,
        maxdisk: v.maxdisk
      })
    }
  }
  guests.sort((a, b) => a.vmid - b.vmid)
  nodes.sort((a, b) => a.name.localeCompare(b.name))
  return { guests, nodes }
}

// ---- Detección de IP ----

const IGNORED_IFACE = /^(lo|docker|br-|veth|virbr|cni|flannel|cali|vxlan)/i

function cleanIpv4(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const ip = raw.split('/')[0]
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return null
  if (ip.startsWith('127.') || ip.startsWith('169.254.') || ip === '0.0.0.0') return null
  return ip
}

// Redes domésticas primero, el resto después; sin duplicados
function rank(ips: string[]): string[] {
  const score = (ip: string): number => (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip) ? 0 : 1)
  return [...new Set(ips)].sort((a, b) => score(a) - score(b))
}

// GET /nodes/{node}/lxc/{vmid}/interfaces -> [{ name, hwaddr, inet: "10.0.0.5/24", inet6 }]
export function ipsFromLxcInterfaces(data: unknown): string[] {
  if (!Array.isArray(data)) return []
  const ips: string[] = []
  for (const iface of data) {
    if (!iface || typeof iface !== 'object') continue
    const { name, inet } = iface as { name?: unknown; inet?: unknown }
    if (typeof name === 'string' && IGNORED_IFACE.test(name)) continue
    const ip = cleanIpv4(inet)
    if (ip) ips.push(ip)
  }
  return rank(ips)
}

// GET /nodes/{node}/qemu/{vmid}/agent/network-get-interfaces -> { result: [{ name, "ip-addresses": [...] }] }
export function ipsFromAgent(data: unknown): string[] {
  const list = Array.isArray(data)
    ? data
    : data && typeof data === 'object'
      ? (data as { result?: unknown }).result
      : undefined
  if (!Array.isArray(list)) return []
  const ips: string[] = []
  for (const iface of list) {
    if (!iface || typeof iface !== 'object') continue
    const { name, 'ip-addresses': addrs } = iface as { name?: unknown; 'ip-addresses'?: unknown }
    if (typeof name === 'string' && IGNORED_IFACE.test(name)) continue
    if (!Array.isArray(addrs)) continue
    for (const a of addrs) {
      if (!a || typeof a !== 'object') continue
      const { 'ip-address': ip, 'ip-address-type': kind } = a as Record<string, unknown>
      if (kind !== 'ipv4') continue
      const clean = cleanIpv4(ip)
      if (clean) ips.push(clean)
    }
  }
  return rank(ips)
}

// GET .../agent/get-osinfo -> { result: { id: "ubuntu", name: "Ubuntu", ... } }
export function osIdFromAgent(data: unknown): string | undefined {
  const result =
    data && typeof data === 'object' ? ((data as { result?: unknown }).result ?? data) : undefined
  if (!result || typeof result !== 'object') return undefined
  const id = (result as { id?: unknown }).id
  return typeof id === 'string' && /^[a-z0-9._-]{1,40}$/i.test(id) ? id.toLowerCase() : undefined
}

// Respaldo con la config: LXC `net0: ...,ip=10.0.0.5/24,...`; VM `ipconfig0: ip=10.0.0.5/24,...`
export function ipsFromConfig(config: Record<string, unknown>): string[] {
  const ips: string[] = []
  for (const [key, value] of Object.entries(config)) {
    if (!/^(net|ipconfig)\d+$/.test(key) || typeof value !== 'string') continue
    const m = /(?:^|,)ip=([^,]+)/.exec(value)
    const ip = m ? cleanIpv4(m[1]) : null
    if (ip) ips.push(ip)
  }
  return rank(ips)
}

export const guestConfigSchema = z
  .object({
    description: z.string().max(65536).optional(),
    tags: z.string().optional()
  })
  .passthrough()
