import { describe, expect, it } from 'vitest'
import { HttpError, PveClient } from '../src/main/pve/client'
import { MonitorService, NO_SSH } from '../src/main/pve/monitor'
import {
  num,
  parseApt,
  parseClusterLog,
  parseDisks,
  parseNodeStatus,
  parseProcesses,
  parseRrd,
  parseServices,
  parseStorage,
  parseSyslog,
  parseTasks
} from '../src/main/pve/monitorParse'

describe('lectores del API de Proxmox', () => {
  it('num acepta números y cadenas numéricas, nada más', () => {
    expect([num(1.5), num('0.25'), num(''), num('x'), num(NaN), num(null), num(undefined)]).toEqual([1.5, 0.25, undefined, undefined, undefined, undefined, undefined])
  })

  it('estado del nodo (loadavg llega como texto)', () => {
    const s = parseNodeStatus({
      uptime: 90061, cpu: 0.034, wait: 0.002, loadavg: ['0.10', '0.08', '0.05'],
      memory: { used: 4e9, total: 16e9 }, swap: { used: 0, total: 8e9 }, rootfs: { used: 10e9, total: 100e9 },
      cpuinfo: { model: 'Intel(R) N100', cpus: 4, sockets: 1 }, kversion: 'Linux 6.14.8-2-pve', pveversion: 'pve-manager/9.2.1/abc'
    })!
    expect(s).toMatchObject({ uptime: 90061, cpu: 0.034, load: [0.1, 0.08, 0.05], cores: 4, pveVersion: '9.2.1', kernel: 'Linux 6.14.8-2-pve' })
    expect(s.mem).toEqual({ used: 4e9, total: 16e9 })
    expect(parseNodeStatus(null)).toBeNull()
    expect(parseNodeStatus({})).toMatchObject({ cpu: 0, load: [0, 0, 0] })
  })

  it('historial rrd: ordena, ignora filas vacías y valores nulos', () => {
    const pts = parseRrd([
      { time: 200, cpu: 0.2, memused: 5, memtotal: 10, netin: 100, netout: 50 },
      { time: 100, cpu: 0.1, iowait: 0.01, loadavg: 0.3 },
      { time: 300 }, // fila vacía del último intervalo
      { cpu: 1 }, // sin tiempo
      'basura'
    ])
    expect(pts.map((p) => p.t)).toEqual([100, 200])
    expect(pts[1]).toMatchObject({ cpu: 0.2, memUsed: 5, netIn: 100 })
  })

  it('almacenamiento', () => {
    expect(parseStorage([{ storage: 'local-zfs', type: 'zfspool', used: 5, total: 10, active: 1, content: 'rootdir,images' }, { type: 'x' }])).toEqual([
      { id: 'local-zfs', type: 'zfspool', used: 5, total: 10, active: true, shared: false, content: 'rootdir,images' }
    ])
  })

  it('tareas: estado según el resultado y orden por fecha', () => {
    const t = parseTasks([
      { upid: 'UPID:a', type: 'qmstart', id: '102', user: 'root@pam', starttime: 100, endtime: 105, status: 'OK' },
      { upid: 'UPID:b', type: 'vzdump', user: 'root@pam', starttime: 300 },
      { upid: 'UPID:c', type: 'qmstop', id: '103', user: 'u@pve', starttime: 200, endtime: 201, status: 'command failed: exit code 1' },
      { upid: 'UPID:d', type: 'aptupdate', user: 'root@pam', starttime: 50, endtime: 51, status: 'WARNINGS: 1' }
    ])
    expect(t.map((x) => [x.type, x.state])).toEqual([['vzdump', 'running'], ['qmstop', 'error'], ['qmstart', 'ok'], ['aptupdate', 'warn']])
  })

  it('registros: prioridad syslog y detección por texto', () => {
    const c = parseClusterLog([
      { time: 10, pri: 6, node: 'proxmox', tag: 'pvedaemon', msg: 'starting task' },
      { time: 20, pri: 3, node: 'proxmox', tag: 'pve', msg: 'something broke' },
      { time: 30, pri: 4, msg: 'careful' },
      { time: 40, msg: '' }
    ])
    expect(c.map((x) => x.level)).toEqual(['warn', 'error', 'info'])
    const s = parseSyslog([{ n: 1, t: 'Oct 01 pveproxy: ok' }, { n: 2, t: 'Oct 01 kernel: I/O error on dev sda' }, { n: 3, t: 'Oct 01 sshd: Failed password' }])
    expect(s[0].text).toContain('Failed password') // más reciente primero
    expect(s.map((x) => x.level)).toEqual(['error', 'error', 'info'])
  })

  it('servicios (los caídos primero), actualizaciones y discos', () => {
    const sv = parseServices([{ service: 'pveproxy', state: 'running' }, { service: 'pvedaemon', state: 'stopped', desc: 'x' }])
    expect(sv.map((x) => [x.name, x.running])).toEqual([['pvedaemon', false], ['pveproxy', true]])
    expect(parseApt([{ Package: 'pve-kernel' }, { Package: 'curl' }])).toEqual({ count: 2, packages: ['pve-kernel', 'curl'] })
    expect(parseApt('x')).toEqual({ count: 0, packages: [] })
    expect(parseDisks([{ devpath: '/dev/sda', model: 'WD', size: 5e11, type: 'ssd', health: 'PASSED' }, {}])).toEqual([{ dev: '/dev/sda', model: 'WD', size: 5e11, type: 'ssd', health: 'PASSED' }])
  })

  it('procesos de `ps`', () => {
    const out = '    PID USER           %CPU %MEM     ELAPSED COMMAND\n   1234 root           12.5  3.2  1-02:03:04 qemu-system-x86\n      1 root            0.0  0.1       10:00 systemd\nbasura sin formato\n'
    expect(parseProcesses(out)).toEqual([
      { pid: 1234, user: 'root', cpu: 12.5, mem: 3.2, elapsed: '1-02:03:04', command: 'qemu-system-x86' },
      { pid: 1, user: 'root', cpu: 0, mem: 0.1, elapsed: '10:00', command: 'systemd' }
    ])
  })
})

describe('lista cerrada de rutas del cliente', () => {
  const c = new PveClient({ host: '127.0.0.1', port: 1, tokenId: 'u@pve!t', tokenSecret: 's', fingerprint: 'AA' })
  it('rechaza rutas que no son de monitoreo', () => {
    for (const p of ['/nodes/x/qemu/100/status/stop', '/nodes/../status', '/access/users', '/nodes/x/status/../../../etc', '/nodes/x/rrddata?timeframe=hour;rm', '/cluster/resources']) {
      expect(() => c.getMonitor(p), p).toThrow('Ruta no permitida')
    }
  })
})

describe('MonitorService', () => {
  const fakeClient = (handler: (path: string) => unknown): { client: PveClient; calls: string[] } => {
    const calls: string[] = []
    const client = { getMonitor: async (path: string) => { calls.push(path); return handler(path) } } as unknown as PveClient
    return { client, calls }
  }

  it('cada sección es independiente: un 403 no rompe el resto', async () => {
    const { client } = fakeClient((p) => {
      if (p.endsWith('/syslog?limit=120')) throw new HttpError(403)
      if (p.endsWith('/status')) return { uptime: 100, cpu: 0.1, memory: { used: 1, total: 2 } }
      return []
    })
    const svc = new MonitorService(() => client, async () => ({ exitCode: 0, output: '', truncated: false }), () => undefined)
    const s = await svc.get('proxmox', 'hour')
    expect(s.status?.uptime).toBe(100)
    expect(s.errors.syslog).toContain('PVEAuditor')
    expect(s.errors.status).toBeUndefined()
    expect(s.errors.processes).toBe(NO_SSH)
  })

  it('usa caché: dos consultas seguidas piden cada ruta una sola vez', async () => {
    const { client, calls } = fakeClient(() => [])
    const svc = new MonitorService(() => client, async () => ({ exitCode: 0, output: '', truncated: false }), () => undefined)
    await svc.get('proxmox', 'hour')
    const first = calls.length
    await svc.get('proxmox', 'hour')
    expect(calls.length).toBe(first)
    await svc.get('proxmox', 'day') // otro periodo: solo el historial se vuelve a pedir
    expect(calls.length).toBe(first + 1)
  })

  it('un fallo conserva el último dato bueno de esa sección', async () => {
    let fail = false
    const { client } = fakeClient((p) => {
      if (p.endsWith('/status')) {
        if (fail) throw new HttpError(500)
        return { uptime: 7 }
      }
      return []
    })
    const svc = new MonitorService(() => client, async () => ({ exitCode: 0, output: '', truncated: false }), () => undefined)
    await svc.get('n', 'hour')
    fail = true
    const realNow = Date.now
    Date.now = () => realNow() + 20_000 // la caché de 8 s ya caducó
    try {
      const s = await svc.get('n', 'hour')
      expect(s.status?.uptime).toBe(7)
      expect(s.errors.status).toContain('500')
    } finally {
      Date.now = realNow
    }
  })

  it('procesos por SSH solo con conexión configurada; los fallos de SSH se explican', async () => {
    const { client } = fakeClient(() => [])
    const ok = new MonitorService(() => client, async () => ({ exitCode: 0, truncated: false, output: 'PID USER %CPU %MEM ELAPSED COMMAND\n 5 root 1.0 2.0 00:10 foo\n' }), () => 'ssh-1')
    expect((await ok.get('n', 'hour')).processes).toHaveLength(1)
    const bad = new MonitorService(() => client, async () => { throw new Error('La huella del servidor no está confirmada') }, () => 'ssh-2')
    const s = await bad.get('n', 'hour')
    expect(s.errors.processes).toContain('huella')
  })

  it('sin conexión con Proxmox: todo con error y sin lanzar', async () => {
    const svc = new MonitorService(() => null, async () => ({ exitCode: 0, output: '', truncated: false }), () => undefined)
    const s = await svc.get('n', 'hour')
    expect(s.status).toBeNull()
    expect(Object.keys(s.errors)).toHaveLength(10)
  })
})
