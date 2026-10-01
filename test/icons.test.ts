import { describe, expect, it } from 'vitest'
import { iconForGuest, iconForPanel } from '../src/shared/icons'
import brands from '../src/renderer/brands.json'

const known = (k: string): boolean => (k.startsWith('ui:') ? true : k in brands)

describe('iconForGuest', () => {
  it('reconoce por el nombre', () => {
    expect(iconForGuest({ name: 'adguard', type: 'lxc' })).toBe('adguard')
    expect(iconForGuest({ name: 'tailscale-router', type: 'lxc' })).toBe('tailscale')
    expect(iconForGuest({ name: 'docker-server', type: 'qemu' })).toBe('docker')
    expect(iconForGuest({ name: 'ubuntu-base', type: 'qemu' })).toBe('ubuntu')
  })
  it('usa el ostype de Proxmox cuando el nombre no dice nada', () => {
    expect(iconForGuest({ name: 'web1', type: 'lxc', osType: 'debian' })).toBe('debian')
    expect(iconForGuest({ name: 'srv', type: 'lxc', osType: 'alpine' })).toBe('alpinelinux')
    expect(iconForGuest({ name: 'srv', type: 'qemu', osType: 'win11' })).toBe('ui:windows')
  })
  it('la función manda sobre el SO: varios Ubuntu Server distintos se distinguen', () => {
    // dos VM Ubuntu: una sirve Portainer (host Docker), otra AdGuard; ambas con el mismo SO
    expect(iconForGuest({ name: 'srv-a', type: 'qemu', osId: 'ubuntu', panelIcons: ['portainer'] })).toBe('docker')
    expect(iconForGuest({ name: 'srv-b', type: 'qemu', osId: 'ubuntu', panelIcons: ['adguard'] })).toBe('adguard')
    expect(iconForGuest({ name: 'pihole', type: 'lxc', osType: 'debian' })).toBe('pihole')
  })
  it('los tags mandan sobre todo; el SO es el último recurso antes del genérico', () => {
    expect(iconForGuest({ name: 'x', type: 'lxc', osType: 'debian', tags: ['adguard'], panelIcons: ['grafana'] })).toBe('adguard')
    expect(iconForGuest({ name: 'x', type: 'qemu', osId: 'ubuntu' })).toBe('ubuntu')
    expect(iconForGuest({ name: 'x', type: 'qemu', osType: 'win11', osId: 'mswindows' })).toBe('ui:windows')
    expect(iconForGuest({ name: 'x', type: 'qemu', osType: 'l26' })).toBe('linux')
  })
  it('paneles genéricos (globo) no definen la función; el nombre sí', () => {
    expect(iconForGuest({ name: 'docker-server', type: 'qemu', osId: 'ubuntu', panelIcons: ['ui:globe'] })).toBe('docker')
  })
  it('ids del guest-agent: distros comunes', () => {
    const id = (osId: string): string => iconForGuest({ name: 'x', type: 'qemu', osId })
    expect(id('arch')).toBe('archlinux')
    expect(id('alpine')).toBe('alpinelinux')
    expect(id('opensuse-leap')).toBe('opensuse')
    expect(id('raspbian')).toBe('raspberrypi')
    expect(id('rhel')).toBe('ui:monitor') // sin logo: genérico
  })
  it('las líneas panel: de las notas no cuentan, el resto sí', () => {
    expect(iconForGuest({ name: 'x', type: 'lxc', description: 'panel: Grafana | http://10.0.0.5:3000' })).toBe('ui:box')
    expect(iconForGuest({ name: 'x', type: 'lxc', description: 'Servidor de Jellyfin' })).toBe('jellyfin')
  })
  it('sin pistas: contenedor o equipo genérico', () => {
    expect(iconForGuest({ name: 'a', type: 'lxc' })).toBe('ui:box')
    expect(iconForGuest({ name: 'a', type: 'qemu' })).toBe('ui:monitor')
  })
})

describe('iconForPanel', () => {
  const guest = { name: 'docker-server', type: 'qemu' as const }
  it('por nombre, por host y por puerto', () => {
    expect(iconForPanel({ name: 'Portainer', url: 'http://10.0.0.53:9000' }, guest, known)).toBe('portainer')
    expect(iconForPanel({ name: 'Bóveda', url: 'https://vault.bitwarden.com/#/vault' }, undefined, known)).toBe('bitwarden')
    expect(iconForPanel({ name: 'Casa', url: 'http://10.0.0.9:8123' }, undefined, known)).toBe('homeassistant')
  })
  it('una IP no cuenta como nombre; sin pistas hereda el icono del guest o usa el globo', () => {
    expect(iconForPanel({ name: 'Panel', url: 'http://10.0.0.53:1234' }, guest, known)).toBe('docker')
    expect(iconForPanel({ name: 'Panel', url: 'http://10.0.0.53:1234' }, undefined, known)).toBe('ui:globe')
  })
  it('un icono explícito válido gana; un emoji o desconocido se ignora', () => {
    expect(iconForPanel({ name: 'Portainer', url: 'http://x', icon: 'github' }, undefined, known)).toBe('github')
    expect(iconForPanel({ name: 'Portainer', url: 'http://x', icon: '🐳' }, undefined, known)).toBe('portainer')
    expect(iconForPanel({ name: 'Portainer', url: 'http://x', icon: 'noexiste' }, undefined, known)).toBe('portainer')
  })
  it('todas las claves de las reglas existen como logo', () => {
    const names = ['portainer', 'adguard', 'pihole', 'tailscale', 'vaultwarden', 'bitwarden', 'nginxproxymanager', 'ubuntu', 'debian', 'proxmox', 'docker', 'ubiquiti']
    for (const n of names) expect(n in brands, n).toBe(true)
  })
})
