// Mapa de red: construye solo el árbol de la infraestructura a partir de lo que la app ya conoce
// (nodos y VMs/LXC de Proxmox + paneles). La IP decide dónde cuelga cada servicio y el puerto lo identifica.
// Lógica pura (sin Electron ni React) para poder probarla.

import { FOLDER_COLORS } from './layout'

export type MapKind = 'service' | 'router' | 'switch' | 'ap' | 'nas' | 'other'
export const MAP_KINDS: MapKind[] = ['service', 'router', 'switch', 'ap', 'nas', 'other']

export type MapNodeType = 'root' | 'net' | 'folder' | 'node' | 'vm' | 'lxc' | 'device' | 'service' | 'ext'

export interface MapNode {
  id: string
  type: MapNodeType
  label: string
  sub?: string
  ip?: string
  port?: string
  url?: string
  status: 'running' | 'stopped' | 'unknown'
  parent: string | null
  panelId?: string // panel que se abre al pulsar el nodo
  guestKey?: string
  vmid?: number
  deviceKind?: MapKind
  category?: boolean // carpeta creada sola para agrupar servicios (empieza cerrada)
  poolGroup?: boolean // carpeta creada sola por un pool de Proxmox
  color?: string // color propio (carpeta del usuario o pool); si falta vale el del tipo
}

export interface MapInput {
  pve: { host: string; port: number } | null
  nodes: { name: string; online: boolean }[]
  guests: { key: string; vmid: number; name: string; node: string; type: 'qemu' | 'lxc'; status: string; ips: string[]; template: boolean; pool?: string }[]
  panels: { id: string; name: string; url: string; vmid?: number; mapKind?: MapKind; mapLink?: string; folder?: string }[]
  groupByPools?: boolean // agrupa las máquinas de un nodo por su pool de Proxmox
  groupByFolders?: boolean // los paneles que están en una carpeta del usuario cuelgan de ella
  folders: { id: string; name: string; color?: string }[] // carpetas del usuario (con su color): destinos de enlace
  showTemplates?: boolean
}

// Servicios que se agrupan por categoría cuando un mismo host tiene varios (el orden decide la prioridad)
export const GROUP_RULES: [string, string[]][] = [
  ['Multimedia', ['jellyfin', 'jellyseerr', 'overseerr', 'plex', 'emby', 'immich', 'audiobookshelf']],
  ['Automatización', ['radarr', 'sonarr', 'prowlarr', 'lidarr', 'bazarr']],
  ['Descargas', ['qbittorrent', 'transmission', 'deluge', 'sabnzbd']],
  ['Red', ['adguard', 'pihole', 'pi-hole', 'tailscale', 'wireguard', 'unifi', 'proxy manager', 'npm', 'traefik', 'caddy']],
  ['Gestión', ['portainer', 'dockge', 'proxmox']],
  ['Monitoreo', ['pulse', 'grafana', 'prometheus', 'uptime', 'netdata']],
  ['Seguridad', ['bitwarden', 'vaultwarden', 'authelia', 'authentik']]
]
export const FOLDER_THRESHOLD = 4

export const NET_ID_PRIMARY = 'lan'
export const EXT_ID = 'ext'

interface Parsed {
  host: string
  port: string
  explicit: boolean
}

function parseUrl(url: string): Parsed {
  try {
    const u = new URL(url)
    return { host: u.hostname.toLowerCase(), port: u.port || (u.protocol === 'https:' ? '443' : '80'), explicit: !!u.port }
  } catch {
    return { host: url, port: '', explicit: false }
  }
}

const isIpv4 = (h: string): boolean => /^\d{1,3}(\.\d{1,3}){3}$/.test(h)

function isPrivateIpv4(h: string): boolean {
  if (!isIpv4(h)) return false
  const [a, b] = h.split('.').map(Number)
  return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 100 && b >= 64 && b <= 127) || a === 127
}

// Nombres de la red local (router.lan, nas, pi.local…): no son «nube»
const isLocalName = (h: string): boolean => !isIpv4(h) && (!h.includes('.') || /\.(lan|local|home|internal|localdomain|home\.arpa)$/.test(h))

const isLocalHost = (h: string): boolean => isPrivateIpv4(h) || isLocalName(h)

// Carpeta de red a la que pertenece una IP privada (una por /24; Tailscale aparte)
function netOf(h: string): { key: string; label: string } {
  if (isIpv4(h)) {
    const [a, b, c] = h.split('.').map(Number)
    if (a === 100 && b >= 64 && b <= 127) return { key: 'tailscale', label: 'Tailscale 100.64.0.0/10' }
    return { key: `${a}.${b}.${c}`, label: `LAN ${a}.${b}.${c}.0/24` }
  }
  return { key: '', label: 'LAN' }
}

// Color estable para un pool: el mismo nombre da siempre el mismo color de la paleta de carpetas
export function tagColor(tag: string): string {
  let h = 0
  for (const ch of tag.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return FOLDER_COLORS[h % FOLDER_COLORS.length]
}

function categoryOf(name: string): string {
  const n = name.toLowerCase()
  for (const [cat, words] of GROUP_RULES) if (words.some((w) => n.includes(w))) return cat
  return 'Otros'
}

export function buildMap(input: MapInput): MapNode[] {
  const out: MapNode[] = []
  const have = new Set<string>()
  const add = (n: MapNode): MapNode => {
    out.push(n)
    have.add(n.id)
    return n
  }
  add({ id: 'root', type: 'root', label: 'HomeLab', status: 'unknown', parent: null })

  const pvePort = input.pve ? String(input.pve.port) : ''
  const pveHost = input.pve?.host.toLowerCase() ?? ''
  const primary = isIpv4(pveHost) ? netOf(pveHost) : { key: '', label: 'LAN' }
  const primaryId = NET_ID_PRIMARY
  const nets = new Map<string, string>() // key de red -> id
  const ensureNet = (key: string, label: string): string => {
    if (key === primary.key) {
      if (!have.has(primaryId)) add({ id: primaryId, type: 'net', label: primary.label, sub: 'red local', status: 'unknown', parent: 'root' })
      return primaryId
    }
    let id = nets.get(key)
    if (!id) {
      id = `net:${key}`
      nets.set(key, id)
      add({ id, type: 'net', label, sub: 'red local', status: 'unknown', parent: 'root' })
    }
    return id
  }
  const ensureExt = (): string => {
    if (!have.has(EXT_ID)) add({ id: EXT_ID, type: 'folder', label: 'Externos / Nube', sub: 'fuera de la LAN', status: 'unknown', parent: 'root' })
    return EXT_ID
  }
  const netForHost = (h: string): string => {
    const n = netOf(h)
    return n.key ? ensureNet(n.key, n.label) : ensureNet(primary.key, primary.label)
  }

  // Nodos de Proxmox (con la IP de la conexión si hay uno solo)
  const singleNode = input.nodes.length === 1
  for (const nd of input.nodes) {
    add({
      id: `n:${nd.name}`,
      type: 'node',
      label: nd.name,
      ip: singleNode && pveHost ? pveHost : undefined,
      port: singleNode && pvePort ? pvePort : undefined,
      status: nd.online ? 'running' : 'stopped',
      parent: ensureNet(primary.key, primary.label)
    })
  }
  const nodeByIp = singleNode ? out.find((n) => n.type === 'node') : undefined

  // VMs y contenedores, colgados de su nodo (o de la carpeta de su pool, si se agrupa por pools)
  const guestByIp = new Map<string, MapNode>()
  const guestByVmid = new Map<number, MapNode>()
  const poolOf = (g: MapInput['guests'][number]): string | undefined => g.pool?.trim() || undefined
  const poolCount = new Map<string, number>()
  if (input.groupByPools) {
    for (const g of input.guests) {
      const pool = poolOf(g)
      if (pool && !(g.template && !input.showTemplates)) poolCount.set(`${g.node}:${pool}`, (poolCount.get(`${g.node}:${pool}`) ?? 0) + 1)
    }
  }
  for (const g of input.guests) {
    if (g.template && !input.showTemplates) continue
    let parent = have.has(`n:${g.node}`) ? `n:${g.node}` : ensureNet(primary.key, primary.label)
    const pool = input.groupByPools ? poolOf(g) : undefined
    const count = pool ? (poolCount.get(`${g.node}:${pool}`) ?? 0) : 0
    if (pool && count >= 2) {
      const id = `pool:${g.node}:${pool}`
      if (!have.has(id)) add({ id, type: 'folder', label: pool, sub: `${count} máquinas`, status: 'unknown', parent, poolGroup: true, color: tagColor(pool) })
      parent = id
    }
    const n = add({
      id: `g:${g.key}`,
      type: g.type === 'lxc' ? 'lxc' : 'vm',
      label: `${g.vmid} ${g.name}`,
      ip: g.ips[0],
      status: g.status === 'running' ? 'running' : g.status === 'stopped' ? 'stopped' : 'unknown',
      parent,
      guestKey: g.key,
      vmid: g.vmid
    })
    for (const ip of g.ips) if (!guestByIp.has(ip)) guestByIp.set(ip, n)
    guestByVmid.set(g.vmid, n)
  }

  // Carpetas del usuario que reciben enlaces (se crean solo si alguien cuelga de ellas)
  const folderIds = new Set(input.folders.map((f) => `f:${f.id}`))
  const folderName = new Map(input.folders.map((f) => [`f:${f.id}`, f.name]))
  const folderColor = new Map(input.folders.map((f) => [`f:${f.id}`, f.color]))
  const panelIds = new Set(input.panels.map((p) => `p:${p.id}`))

  // El panel que es el propio nodo de Proxmox se fusiona con él (no se duplica)
  const merged = new Set<string>()
  const parsed = new Map(input.panels.map((p) => [p.id, parseUrl(p.url)]))
  if (nodeByIp) {
    for (const p of input.panels) {
      const u = parsed.get(p.id)!
      if (u.host === pveHost && u.port === pvePort && !nodeByIp.panelId) {
        nodeByIp.panelId = p.id
        nodeByIp.url = p.url
        merged.add(p.id)
      }
    }
  }

  // Padre automático según la IP
  const autoParent = (p: MapInput['panels'][number]): string => {
    const u = parsed.get(p.id)!
    const byVmid = p.vmid !== undefined ? guestByVmid.get(p.vmid) : undefined
    if (byVmid) return byVmid.id
    const g = guestByIp.get(u.host)
    if (g) return g.id
    if (nodeByIp && u.host === pveHost) return nodeByIp.id
    if (isLocalHost(u.host)) return netForHost(u.host)
    return ensureExt()
  }

  // Un enlace manual vale si apunta a algo que existe
  const resolveLink = (link: string | undefined, selfId: string): string | null => {
    if (!link || link === `p:${selfId}`) return null
    if (link === 'lan') return ensureNet(primary.key, primary.label)
    if (link === 'ext') return ensureExt()
    if (have.has(link)) return link
    if (panelIds.has(link)) return link
    if (folderIds.has(link)) {
      if (!have.has(link)) add({ id: link, type: 'folder', label: folderName.get(link) ?? '', status: 'unknown', parent: 'root', color: folderColor.get(link) })
      return link
    }
    return null
  }

  const wanted = new Map<string, string>() // id de panel -> id del padre
  const autoOf = new Map<string, string>()
  for (const p of input.panels) {
    if (merged.has(p.id)) continue
    autoOf.set(p.id, autoParent(p))
    const byFolder = input.groupByFolders && p.folder ? resolveLink(`f:${p.folder}`, p.id) : null
    wanted.set(p.id, resolveLink(p.mapLink, p.id) ?? byFolder ?? autoOf.get(p.id)!)
  }
  // Ciclos entre paneles (A cuelga de B y B de A): el enlace que cierra el ciclo se ignora
  for (const id of wanted.keys()) {
    const seen = new Set<string>([`p:${id}`])
    let cur = wanted.get(id)
    while (cur && cur.startsWith('p:')) {
      if (seen.has(cur)) {
        wanted.set(id, autoOf.get(id)!)
        break
      }
      seen.add(cur)
      cur = wanted.get(cur.slice(2))
    }
  }

  for (const p of input.panels) {
    if (merged.has(p.id)) continue
    const u = parsed.get(p.id)!
    const parent = wanted.get(p.id)!
    const device = !!p.mapKind && p.mapKind !== 'service'
    const external = !device && (parent === EXT_ID || (parent.startsWith('f:') && !isLocalHost(u.host)))
    add({
      id: `p:${p.id}`,
      type: device ? 'device' : external ? 'ext' : 'service',
      label: p.name,
      ip: u.host,
      port: u.explicit ? u.port : undefined,
      url: p.url,
      status: 'unknown',
      parent,
      panelId: p.id,
      deviceKind: device ? p.mapKind : undefined
    })
  }

  // Subcarpetas automáticas: un padre con muchos servicios los agrupa por categoría
  const kids = new Map<string, MapNode[]>()
  for (const n of out) if ((n.type === 'service' || n.type === 'ext') && n.parent) (kids.get(n.parent) ?? kids.set(n.parent, []).get(n.parent)!).push(n)
  for (const [parent, list] of kids) {
    if (list.length < FOLDER_THRESHOLD || parent.startsWith('f:')) continue // en una carpeta del usuario se respeta lo que puso
    const groups = new Map<string, MapNode[]>()
    for (const n of list) (groups.get(categoryOf(n.label)) ?? groups.set(categoryOf(n.label), []).get(categoryOf(n.label))!).push(n)
    if (groups.size < 2) continue
    for (const [cat, items] of groups) {
      const id = `cat:${parent}:${cat}`
      add({ id, type: 'folder', label: cat, sub: `${items.length} servicio${items.length > 1 ? 's' : ''}`, status: 'unknown', parent, category: true })
      for (const n of items) n.parent = id
    }
  }
  return out
}

export interface LinkTarget {
  value: string // lo que se guarda en `mapLink`
  label: string
  group: 'Red' | 'Proxmox' | 'Máquinas' | 'Dispositivos' | 'Carpetas'
}

// Opciones del selector «Conectado a» al crear o editar un panel
export function linkTargets(input: MapInput, selfId?: string): LinkTarget[] {
  const out: LinkTarget[] = [
    { value: 'lan', label: 'Red local (LAN)', group: 'Red' },
    { value: 'ext', label: 'Externos / Nube', group: 'Red' }
  ]
  for (const n of input.nodes) out.push({ value: `n:${n.name}`, label: `Nodo ${n.name}`, group: 'Proxmox' })
  for (const g of input.guests) {
    if (g.template && !input.showTemplates) continue
    out.push({ value: `g:${g.key}`, label: `${g.vmid} ${g.name} (${g.type === 'lxc' ? 'LXC' : 'VM'})`, group: 'Máquinas' })
  }
  for (const p of input.panels) {
    if (p.id !== selfId && p.mapKind && p.mapKind !== 'service') out.push({ value: `p:${p.id}`, label: p.name, group: 'Dispositivos' })
  }
  for (const f of input.folders) out.push({ value: `f:${f.id}`, label: f.name, group: 'Carpetas' })
  return out
}
