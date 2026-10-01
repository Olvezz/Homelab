import { describe, expect, it } from 'vitest'
import {
  ipsFromAgent,
  ipsFromConfig,
  ipsFromLxcInterfaces,
  parseResources,
  parseTags
} from '../src/main/pve/mapping'

describe('parseResources', () => {
  const raw = [
    { type: 'node', node: 'proxmox', status: 'online', cpu: 0.1, maxcpu: 4, mem: 1, maxmem: 8 },
    { type: 'lxc', node: 'proxmox', vmid: 100, name: 'adguard', status: 'running', cpu: 0.02, maxcpu: 1, mem: 100, maxmem: 512, uptime: 50, tags: 'dns;web-3000' },
    { type: 'qemu', node: 'proxmox', vmid: 103, name: 'ubuntu-base', status: 'stopped', template: 1, maxcpu: 2, maxmem: 2048 },
    { type: 'qemu', node: 'proxmox', vmid: 102, name: 'docker-server', status: 'running' },
    { type: 'storage', node: 'proxmox', storage: 'local' },
    { type: 'qemu', node: '../etc', vmid: 5 }, // nodo inválido: se descarta sin romper el resto
    'basura',
    null
  ]

  it('mapea guests ordenados por vmid y nodos', () => {
    const { guests, nodes } = parseResources(raw)
    expect(guests.map((g) => g.vmid)).toEqual([100, 102, 103])
    expect(guests[0]).toMatchObject({ type: 'lxc', status: 'running', tags: ['dns', 'web-3000'], template: false })
    expect(guests[2]).toMatchObject({ template: true, status: 'stopped', cpu: 0 })
    expect(nodes).toEqual([{ name: 'proxmox', online: true, cpu: 0.1, maxcpu: 4, mem: 1, maxmem: 8, uptime: 0, disk: 0, maxdisk: 0 }])
  })
  it('tolera respuestas que no son una lista', () => {
    expect(parseResources({ data: 1 })).toEqual({ guests: [], nodes: [] })
  })
})

describe('parseTags', () => {
  it('separa por ; , o espacios', () => {
    expect(parseTags('a;b, c d')).toEqual(['a', 'b', 'c', 'd'])
    expect(parseTags(undefined)).toEqual([])
  })
})

describe('detección de IP', () => {
  it('LXC: usa inet e ignora lo/docker', () => {
    const data = [
      { name: 'lo', inet: '127.0.0.1/8' },
      { name: 'docker0', inet: '172.17.0.1/16' },
      { name: 'eth0', inet: '10.0.0.52/24', inet6: 'fe80::1/64' }
    ]
    expect(ipsFromLxcInterfaces(data)).toEqual(['10.0.0.52'])
  })
  it('VM con guest-agent: solo ipv4 útil', () => {
    const data = {
      result: [
        { name: 'lo', 'ip-addresses': [{ 'ip-address': '127.0.0.1', 'ip-address-type': 'ipv4' }] },
        { name: 'docker0', 'ip-addresses': [{ 'ip-address': '172.17.0.1', 'ip-address-type': 'ipv4' }] },
        {
          name: 'ens18',
          'ip-addresses': [
            { 'ip-address': 'fe80::1', 'ip-address-type': 'ipv6' },
            { 'ip-address': '10.0.0.53', 'ip-address-type': 'ipv4' }
          ]
        }
      ]
    }
    expect(ipsFromAgent(data)).toEqual(['10.0.0.53'])
  })
  it('respaldo desde la config (net0 / ipconfig0)', () => {
    expect(ipsFromConfig({ net0: 'name=eth0,bridge=vmbr0,ip=10.0.0.5/24,gw=10.0.0.1' })).toEqual(['10.0.0.5'])
    expect(ipsFromConfig({ ipconfig0: 'ip=10.0.0.6/24,gw=10.0.0.1' })).toEqual(['10.0.0.6'])
    expect(ipsFromConfig({ net0: 'name=eth0,ip=dhcp' })).toEqual([])
  })
  it('datos raros no lanzan', () => {
    expect(ipsFromLxcInterfaces(null)).toEqual([])
    expect(ipsFromAgent('x')).toEqual([])
  })
})
