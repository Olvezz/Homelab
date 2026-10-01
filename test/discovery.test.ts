import { describe, expect, it } from 'vitest'
import {
  discoverPanels,
  isPrivateHost,
  parseNotes,
  parseWebTags,
  safeHttpUrl
} from '../src/main/pve/discovery'

describe('safeHttpUrl', () => {
  it('acepta http y https', () => {
    expect(safeHttpUrl('http://10.0.0.53:9000')).toBe('http://10.0.0.53:9000/')
    expect(safeHttpUrl('https://nas.local')).toBe('https://nas.local/')
  })
  it.each(['javascript:alert(1)', 'file:///c:/x', 'ftp://a', 'data:text/html,hi', 'no es url', ''])(
    'rechaza %s',
    (u) => expect(safeHttpUrl(u)).toBeNull()
  )
  it('rechaza credenciales embebidas', () => {
    expect(safeHttpUrl('http://user:pass@10.0.0.1')).toBeNull()
  })
})

describe('parseNotes', () => {
  it('lee paneles; el icono es una clave opcional y un emoji se ignora', () => {
    const r = parseNotes('panel: Portainer | http://10.0.0.53:9000 | 🐳\nPanel: AdGuard Home | http://10.0.0.52:3000 | adguard')
    expect(r.issues).toEqual([])
    expect(r.panels).toEqual([
      { name: 'Portainer', url: 'http://10.0.0.53:9000/', icon: undefined },
      { name: 'AdGuard Home', url: 'http://10.0.0.52:3000/', icon: 'adguard' }
    ])
  })
  it('ignora el texto normal y reporta líneas mal formadas sin romper', () => {
    const r = parseNotes(
      ['Notas del servidor', 'panel: sin url', 'panel: Malo | javascript:alert(1)', 'panel: Ok | http://10.0.0.5', 'panel: a | http://x | i | extra'].join('\r\n')
    )
    expect(r.panels.map((p) => p.name)).toEqual(['Ok'])
    expect(r.issues).toHaveLength(3)
  })
  it('limita el nombre; un icono largo o raro no invalida el panel, solo se ignora', () => {
    expect(parseNotes(`panel: ${'x'.repeat(61)} | http://10.0.0.1`).issues).toHaveLength(1)
    const r = parseNotes(`panel: a | http://10.0.0.1 | ${'i'.repeat(40)}`)
    expect(r.issues).toEqual([])
    expect(r.panels[0].icon).toBeUndefined()
  })
})

describe('parseWebTags', () => {
  it('reconoce web-<puerto> y web-<puerto>-https', () => {
    expect(parseWebTags(['web-9000', 'web-8443-https', 'otro', 'web-0', 'web-70000', 'web-x'])).toEqual([
      { port: 9000, https: false },
      { port: 8443, https: true }
    ])
  })
})

describe('isPrivateHost', () => {
  it.each(['10.1.2.3', '172.16.0.1', '172.31.255.1', '192.168.1.1', '100.64.0.1', '100.127.0.1', '127.0.0.1', 'nas', 'x.local', 'fd00::1'])(
    '%s es privado',
    (h) => expect(isPrivateHost(h)).toBe(true)
  )
  it.each(['8.8.8.8', '172.32.0.1', '100.128.0.1', '192.169.0.1', 'example.com', '2001:db8::1'])('%s es externo', (h) =>
    expect(isPrivateHost(h)).toBe(false)
  )
})

describe('discoverPanels', () => {
  const base = { vmid: 102, name: 'docker-server', description: '', tags: [] as string[], ips: ['10.0.0.53'] }

  it('genera ids estables según vmid y URL', () => {
    const a = discoverPanels({ ...base, description: 'panel: P | http://10.0.0.53:9000' }, new Set())
    const b = discoverPanels({ ...base, description: 'panel: Otro nombre | http://10.0.0.53:9000' }, new Set())
    expect(a.panels[0].id).toMatch(/^pve-102-[0-9a-f]{6}$/)
    expect(a.panels[0].id).toBe(b.panels[0].id)
  })
  it('arma el panel de un tag con la IP detectada', () => {
    const r = discoverPanels({ ...base, tags: ['web-9000'] }, new Set())
    expect(r.panels).toMatchObject([{ name: 'docker-server', url: 'http://10.0.0.53:9000/', source: 'proxmox-tag' }])
  })
  it('avisa si hay tag pero no IP', () => {
    const r = discoverPanels({ ...base, tags: ['web-9000'], ips: [] }, new Set())
    expect(r.panels).toEqual([])
    expect(r.diagnostics[0].kind).toBe('no-ip')
  })
  it('retiene los hosts externos hasta que se aprueban', () => {
    const notes = 'panel: Web | https://example.com'
    const pending = discoverPanels({ ...base, description: notes }, new Set())
    expect(pending.panels).toEqual([])
    expect(pending.pending).toHaveLength(1)
    expect(pending.diagnostics[0].kind).toBe('external-pending')
    const ok = discoverPanels({ ...base, description: notes }, new Set(['https://example.com']))
    expect(ok.panels).toHaveLength(1)
    expect(ok.panels[0].external).toBe(true)
  })
  it('no duplica paneles repetidos', () => {
    const r = discoverPanels({ ...base, description: 'panel: A | http://10.0.0.5\npanel: A | http://10.0.0.5' }, new Set())
    expect(r.panels).toHaveLength(1)
  })
})
