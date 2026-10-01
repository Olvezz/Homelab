import { describe, expect, it } from 'vitest'
import {
  connectionSchema,
  fingerprintSchema,
  guestRefSchema,
  hostSchema,
  httpUrlSchema,
  idSchema,
  powerActionSchema
} from '../src/main/ipcSchemas'

const fp = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, '0').toUpperCase()).join(':')

describe('validación IPC', () => {
  it('guestRef exige tipos y rangos', () => {
    expect(guestRefSchema.safeParse({ node: 'proxmox', type: 'lxc', vmid: 100 }).success).toBe(true)
    expect(guestRefSchema.safeParse({ node: 'proxmox', type: 'lxc', vmid: '100' }).success).toBe(false)
    expect(guestRefSchema.safeParse({ node: 'a/../b', type: 'lxc', vmid: 100 }).success).toBe(false)
    expect(guestRefSchema.safeParse({ node: 'p', type: 'container', vmid: 100 }).success).toBe(false)
    expect(guestRefSchema.safeParse({ node: 'p', type: 'qemu', vmid: 0 }).success).toBe(false)
    expect(guestRefSchema.safeParse({ node: 'p', type: 'qemu', vmid: 1.5 }).success).toBe(false)
  })
  it('acciones solo de la lista blanca', () => {
    for (const a of ['start', 'shutdown', 'stop', 'reboot']) expect(powerActionSchema.safeParse(a).success).toBe(true)
    expect(powerActionSchema.safeParse('destroy').success).toBe(false)
  })
  it('conexión: formato de token, secreto, host y huella', () => {
    const ok = {
      host: '10.0.0.50',
      port: 8006,
      tokenId: 'olvezz@pve!desktop',
      secret: '12345678-aaaa-bbbb-cccc-1234567890ab',
      fingerprint: fp,
      pollIntervalSec: 10
    }
    expect(connectionSchema.safeParse(ok).success).toBe(true)
    expect(connectionSchema.safeParse({ ...ok, tokenId: 'root' }).success).toBe(false)
    expect(connectionSchema.safeParse({ ...ok, secret: 'con espacios y ; raros' }).success).toBe(false)
    expect(connectionSchema.safeParse({ ...ok, port: 70000 }).success).toBe(false)
    expect(connectionSchema.safeParse({ ...ok, pollIntervalSec: 1 }).success).toBe(false)
    expect(connectionSchema.safeParse({ ...ok, host: 'a b' }).success).toBe(false)
  })
  it('huella e ids', () => {
    expect(fingerprintSchema.safeParse(fp).success).toBe(true)
    expect(fingerprintSchema.safeParse('abc').success).toBe(false)
    expect(idSchema.safeParse('pve-102-ab12cd').success).toBe(true)
    expect(idSchema.safeParse('../x').success).toBe(false)
    expect(hostSchema.safeParse('proxmox.local').success).toBe(true)
    expect(hostSchema.safeParse('x/y').success).toBe(false)
  })
  it('URLs solo http(s)', () => {
    expect(httpUrlSchema.safeParse('https://10.0.0.1').success).toBe(true)
    expect(httpUrlSchema.safeParse('file:///etc/passwd').success).toBe(false)
  })
})
