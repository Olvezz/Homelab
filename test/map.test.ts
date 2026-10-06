import { describe, expect, it } from 'vitest'
import { buildMap, linkTargets, tagColor, type MapInput, type MapNode } from '../src/shared/map'

const guest = (vmid: number, name: string, type: 'qemu' | 'lxc', ips: string[], status = 'running', template = false) => ({
  key: `proxmox/${vmid}`,
  vmid,
  name,
  node: 'proxmox',
  type,
  status,
  ips,
  template
})

// El inventario del prototipo: nodo, 6 guests y 13 paneles
const base = (): MapInput => ({
  pve: { host: '10.0.0.50', port: 8006 },
  nodes: [{ name: 'proxmox', online: true }],
  guests: [
    guest(100, 'adguard', 'lxc', ['10.0.0.51']),
    guest(101, 'tailscale-router', 'lxc', []),
    guest(102, 'docker-server', 'qemu', ['10.0.0.53']),
    guest(103, 'ubuntu-base', 'qemu', [], 'stopped'),
    guest(104, 'pulse', 'lxc', ['10.0.0.54']),
    guest(105, 'olvezz', 'lxc', ['10.0.0.55'])
  ],
  panels: [
    { id: 'pve', name: 'Proxmox', url: 'https://10.0.0.50:8006' },
    { id: 'router', name: 'Router ISP', url: 'http://10.0.0.1/' },
    { id: 'bw', name: 'bitwarden', url: 'https://vault.bitwarden.com/#/vault' },
    { id: 'adg', name: 'Adguard', url: 'http://10.0.0.51/' },
    { id: 'qb', name: 'qBittorrent', url: 'http://10.0.0.53:8080' },
    { id: 'jf', name: 'Jellyfin', url: 'http://10.0.0.53:8096' },
    { id: 'rad', name: 'Radarr', url: 'http://10.0.0.53:7878' },
    { id: 'pro', name: 'Prowlarr', url: 'http://10.0.0.53:9696' },
    { id: 'seerr', name: 'Jellyseerr', url: 'http://10.0.0.53:5055' },
    { id: 'son', name: 'Sonarr', url: 'http://10.0.0.53:8989' },
    { id: 'port', name: 'Portainer', url: 'http://10.0.0.53' },
    { id: 'pulse', name: 'Pulse', url: 'http://10.0.0.54:7655/proxmox/overview' },
    { id: 'npm', name: 'NPM Plus', url: 'https://10.0.0.55:81' }
  ],
  folders: []
})

const by = (nodes: MapNode[], id: string): MapNode => nodes.find((n) => n.id === id)!
// ¿cuelga `id` (directa o indirectamente, p. ej. dentro de una subcarpeta de categoría) de `ancestor`?
const under = (nodes: MapNode[], id: string, ancestor: string): boolean => {
  for (let n = by(nodes, id); n.parent; n = by(nodes, n.parent)) if (n.parent === ancestor) return true
  return false
}
const kids = (nodes: MapNode[], id: string): string[] => nodes.filter((n) => n.parent === id).map((n) => n.id)

describe('buildMap automático', () => {
  const nodes = buildMap(base())

  it('el panel del nodo se fusiona con el nodo', () => {
    expect(nodes.find((n) => n.id === 'p:pve')).toBeUndefined()
    expect(by(nodes, 'n:proxmox').panelId).toBe('pve')
    expect(by(nodes, 'n:proxmox').parent).toBe('lan')
  })
  it('cada guest cuelga de su nodo y el router de la LAN', () => {
    expect(kids(nodes, 'n:proxmox')).toHaveLength(6)
    expect(by(nodes, 'p:router').parent).toBe('lan')
    expect(by(nodes, 'lan').label).toBe('LAN 10.0.0.0/24')
  })
  it('un servicio cuelga del guest que tiene su IP', () => {
    expect(by(nodes, 'p:adg').parent).toBe('g:proxmox/100')
    expect(by(nodes, 'p:pulse').parent).toBe('g:proxmox/104')
    expect(by(nodes, 'p:npm').parent).toBe('g:proxmox/105')
  })
  it('lo que no es de la LAN va a Externos', () => {
    expect(by(nodes, 'p:bw').parent).toBe('ext')
    expect(by(nodes, 'p:bw').type).toBe('ext')
  })
  it('con 4 o más servicios en un host se agrupan por categoría', () => {
    const docker = 'g:proxmox/102'
    const cats = nodes.filter((n) => n.parent === docker && n.type === 'folder').map((n) => n.label).sort()
    expect(cats).toEqual(['Automatización', 'Descargas', 'Gestión', 'Multimedia'])
    expect(by(nodes, 'p:jf').parent).toBe(`cat:${docker}:Multimedia`)
    expect(by(nodes, 'p:seerr').parent).toBe(`cat:${docker}:Multimedia`)
  })
  it('puerto solo si está en la URL', () => {
    expect(by(nodes, 'p:jf').port).toBe('8096')
    expect(by(nodes, 'p:port').port).toBeUndefined()
  })
  it('estado de los guests y plantillas ocultas', () => {
    expect(by(nodes, 'g:proxmox/103').status).toBe('stopped')
    const withTpl = buildMap({ ...base(), guests: [...base().guests, guest(900, 'tpl', 'qemu', [], 'stopped', true)] })
    expect(withTpl.find((n) => n.id === 'g:proxmox/900')).toBeUndefined()
  })
  it('otra subred crea su propia carpeta de red', () => {
    const n = buildMap({ ...base(), panels: [{ id: 'x', name: 'Cámara', url: 'http://192.168.1.20' }] })
    expect(by(n, 'p:x').parent).toBe('net:192.168.1')
    expect(by(n, 'net:192.168.1').label).toBe('LAN 192.168.1.0/24')
  })
  it('un nombre .lan es local y un dominio público es externo', () => {
    const n = buildMap({ ...base(), panels: [{ id: 'a', name: 'A', url: 'http://nas.lan' }, { id: 'b', name: 'B', url: 'https://example.com' }] })
    expect(by(n, 'p:a').parent).toBe('lan')
    expect(by(n, 'p:b').parent).toBe('ext')
  })
  it('sin conexión a Proxmox solo hay red y externos', () => {
    const n = buildMap({ pve: null, nodes: [], guests: [], folders: [], panels: [{ id: 'a', name: 'A', url: 'http://10.0.0.9' }] })
    expect(n.map((x) => x.id).sort()).toEqual(['net:10.0.0', 'p:a', 'root'])
    expect(by(n, 'p:a').parent).toBe('net:10.0.0')
  })
})

describe('enlaces manuales', () => {
  it('un panel nuevo se enlaza a una VM aunque su IP sea otra', () => {
    const input = base()
    input.panels.push({ id: 'new', name: 'Servicio', url: 'http://10.0.0.99:3000', mapLink: 'g:proxmox/102' })
    expect(under(buildMap(input), 'p:new', 'g:proxmox/102')).toBe(true)
  })
  it('un router con switch y equipos detrás', () => {
    const input = base()
    input.panels.push(
      { id: 'sw', name: 'Switch', url: 'http://10.0.0.2', mapKind: 'switch', mapLink: 'p:router' },
      { id: 'cam', name: 'Cámara', url: 'http://10.0.0.30', mapLink: 'p:sw' }
    )
    input.panels.find((p) => p.id === 'router')!.mapKind = 'router'
    const n = buildMap(input)
    expect(by(n, 'p:router').type).toBe('device')
    expect(by(n, 'p:sw').parent).toBe('p:router')
    expect(by(n, 'p:sw').deviceKind).toBe('switch')
    expect(by(n, 'p:cam').parent).toBe('p:sw')
  })
  it('enlazar a una carpeta del usuario la crea', () => {
    const input = { ...base(), folders: [{ id: 'abc', name: 'Casa' }] }
    input.panels.push({ id: 'n1', name: 'Nuevo', url: 'http://10.0.0.77', mapLink: 'f:abc' })
    const n = buildMap(input)
    expect(by(n, 'f:abc')).toMatchObject({ type: 'folder', label: 'Casa', parent: 'root' })
    expect(by(n, 'p:n1').parent).toBe('f:abc')
  })
  it('un enlace roto vuelve al automático', () => {
    const input = base()
    input.panels.push({ id: 'new', name: 'X', url: 'http://10.0.0.53:1', mapLink: 'g:proxmox/999' })
    expect(under(buildMap(input), 'p:new', 'g:proxmox/102')).toBe(true)
  })
  it('los ciclos entre paneles se rompen', () => {
    const input = base()
    input.panels.push(
      { id: 'a', name: 'A', url: 'http://10.0.0.60', mapKind: 'switch', mapLink: 'p:b' },
      { id: 'b', name: 'B', url: 'http://10.0.0.61', mapKind: 'switch', mapLink: 'p:a' }
    )
    const n = buildMap(input)
    const parents = [by(n, 'p:a').parent, by(n, 'p:b').parent]
    expect(parents.filter((p) => p === 'lan')).toHaveLength(1) // uno vuelve al automático y el otro queda colgado de él
  })
  it('un panel no puede colgar de sí mismo', () => {
    const input = base()
    input.panels.push({ id: 'a', name: 'A', url: 'http://10.0.0.60', mapKind: 'switch', mapLink: 'p:a' })
    expect(by(buildMap(input), 'p:a').parent).toBe('lan')
  })
})

describe('linkTargets', () => {
  it('ofrece red, nodos, máquinas, dispositivos y carpetas (sin el propio panel)', () => {
    const input = { ...base(), folders: [{ id: 'f1', name: 'Casa' }] }
    input.panels.find((p) => p.id === 'router')!.mapKind = 'router'
    const t = linkTargets(input, 'x')
    expect(t.map((x) => x.value)).toEqual(expect.arrayContaining(['lan', 'ext', 'n:proxmox', 'g:proxmox/102', 'p:router', 'f:f1']))
    expect(linkTargets(input, 'router').some((x) => x.value === 'p:router')).toBe(false)
  })
})

describe('agrupación por tags y carpetas', () => {
  const tagged = (): MapInput => {
    const input = base()
    input.guests[0].tags = ['red', 'web-8080'] // adguard
    input.guests[1].tags = ['red'] // tailscale
    input.guests[2].tags = ['docker'] // solo uno con este tag: no se agrupa
    return input
  }
  it('sin la opción, las máquinas cuelgan del nodo', () => {
    expect(by(buildMap(tagged()), 'g:proxmox/100').parent).toBe('n:proxmox')
  })
  it('con tags, las máquinas que comparten uno se agrupan bajo su nodo (ignorando web-<puerto>)', () => {
    const n = buildMap({ ...tagged(), groupByTags: true })
    expect(by(n, 'tag:proxmox:red')).toMatchObject({ type: 'folder', label: 'red', parent: 'n:proxmox' })
    expect(by(n, 'g:proxmox/100').parent).toBe('tag:proxmox:red')
    expect(by(n, 'g:proxmox/101').parent).toBe('tag:proxmox:red')
    expect(by(n, 'g:proxmox/102').parent).toBe('n:proxmox')
    expect(n.find((x) => x.id === 'tag:proxmox:web-8080')).toBeUndefined()
  })
  it('los servicios siguen colgando de su máquina aunque esta esté en un grupo', () => {
    const n = buildMap({ ...tagged(), groupByTags: true })
    expect(by(n, 'p:adg').parent).toBe('g:proxmox/100')
  })
  it('con carpetas, el panel de una carpeta del usuario cuelga de ella', () => {
    const input = { ...base(), folders: [{ id: 'mm', name: 'Multimedia' }], groupByFolders: true }
    input.panels.find((p) => p.id === 'jf')!.folder = 'mm'
    const n = buildMap(input)
    expect(by(n, 'p:jf').parent).toBe('f:mm')
    expect(by(n, 'f:mm').label).toBe('Multimedia')
  })
  it('sin la opción la carpeta del usuario no cambia el sitio, y un enlace manual manda sobre ella', () => {
    const input = { ...base(), folders: [{ id: 'mm', name: 'Multimedia' }] }
    input.panels.find((p) => p.id === 'jf')!.folder = 'mm'
    expect(by(buildMap(input), 'p:jf').parent).not.toBe('f:mm')
    const linked = { ...input, groupByFolders: true }
    linked.panels.find((p) => p.id === 'jf')!.mapLink = 'g:proxmox/104'
    expect(by(buildMap(linked), 'p:jf').parent).toBe('g:proxmox/104')
  })
})

describe('colores de carpetas y tags', () => {
  it('la carpeta del usuario lleva su color y el grupo de tag un color estable de la paleta', () => {
    const input = { ...base(), folders: [{ id: 'mm', name: 'Multimedia', color: '#e5484d' }], groupByFolders: true, groupByTags: true }
    input.panels.find((p) => p.id === 'jf')!.folder = 'mm'
    input.guests[0].tags = ['red']
    input.guests[1].tags = ['red']
    const n = buildMap(input)
    expect(by(n, 'f:mm').color).toBe('#e5484d')
    const tag = by(n, 'tag:proxmox:red').color
    expect(tag).toMatch(/^#[0-9a-f]{6}$/)
    expect(buildMap(input).find((x) => x.id === 'tag:proxmox:red')!.color).toBe(tag)
    expect(tagColor('Red')).toBe(tagColor('red')) // no distingue mayúsculas
  })
})
