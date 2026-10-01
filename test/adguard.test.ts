import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isBlockedReason, parseClients, parseQueryLog, parseStats, parseStatus, resolveName, topList } from '../src/main/adguard/parse'
import { adguardGet, AdguardService } from '../src/main/adguard/service'

const stats = {
  time_units: 'hours',
  num_dns_queries: 1000,
  num_blocked_filtering: 150,
  num_replaced_safebrowsing: 5,
  num_replaced_parental: 0,
  avg_processing_time: 0.012,
  dns_queries: new Array(24).fill(1),
  top_blocked_domains: [{ 'ads.tracker.com': 90 }, { 'telemetry.example.net': 40 }, { 'x.ads.io': 20 }],
  top_clients: [{ '10.0.0.53': 500 }, { '10.0.0.77': 300 }, { '10.0.0.88': 200 }],
  top_queried_domains: [{ 'google.com': 100 }]
}
const clients = {
  clients: [{ name: 'iPhone de Ana', ids: ['10.0.0.77', '00:11:22:33:44:55', '10.0.0.0/24'] }],
  auto_clients: [{ ip: '10.0.0.88', name: 'smart-tv.lan', source: 'rDNS' }, { ip: '10.0.0.53', name: 'otro-nombre', source: 'ARP' }, { ip: '10.0.0.99', name: '10.0.0.99', source: 'ARP' }]
}
const log = (client: string, domain: string, reason: string, name?: string, min = 0): Record<string, unknown> => ({
  client,
  client_info: name ? { name } : {},
  question: { name: `${domain}.`, type: 'A' },
  reason,
  rules: [{ filter_list_id: 1, text: `||${domain}^` }],
  time: new Date(Date.UTC(2026, 9, 1, 12, 0 - min)).toISOString()
})
const querylog = {
  data: [
    log('10.0.0.77', 'ads.tracker.com', 'FilteredBlackList', undefined, 0),
    log('10.0.0.77', 'ads.tracker.com', 'FilteredBlackList', undefined, 1),
    log('10.0.0.88', 'ads.tracker.com', 'FilteredBlackList', 'tv-del-salon', 2),
    log('10.0.0.53', 'telemetry.example.net', 'FilteredBlackList', undefined, 3),
    log('10.0.0.55', 'telemetry.example.net', 'FilteredBlackList', undefined, 4),
    log('10.0.0.55', 'safe.search.com', 'FilteredSafeSearch', undefined, 5) // reescritura, no bloqueo
  ]
}

describe('lectores de AdGuard Home', () => {
  it('estado y estadísticas (listas top = objetos de una clave)', () => {
    expect(parseStatus({ running: true, protection_enabled: false, version: 'v0.107.50' })).toEqual({ running: true, protection: false, version: 'v0.107.50' })
    expect(parseStatus(null)).toBeNull()
    expect(topList([{ a: 1 }, { b: 5 }, { c: 'x' }, 'basura'])).toEqual([{ key: 'b', count: 5 }, { key: 'a', count: 1 }])
    const s = parseStats(stats)!
    expect(s).toMatchObject({ queries: 1000, blocked: 155, windowHours: 24 })
    expect(s.blockedPct).toBeCloseTo(0.155)
    expect(s.avgMs).toBeCloseTo(12)
    expect(s.topBlocked[0]).toEqual({ key: 'ads.tracker.com', count: 90 })
  })

  it('clientes: nombres fijos (solo IP, no CIDR ni MAC) y automáticos (sin nombre = IP)', () => {
    const c = parseClients(clients)
    expect([...c.persistent.entries()]).toEqual([['10.0.0.77', 'iPhone de Ana']])
    expect(c.auto.get('10.0.0.88')).toEqual({ name: 'smart-tv.lan', source: 'rDNS' })
    expect(c.auto.has('10.0.0.99')).toBe(false)
  })

  it('registro de consultas: dominio normalizado, nombre y fecha', () => {
    const e = parseQueryLog(querylog)
    expect(e).toHaveLength(6)
    expect(e[0]).toMatchObject({ ip: '10.0.0.77', domain: 'ads.tracker.com', rule: '||ads.tracker.com^' })
    expect(e[0].time).toBe(Date.UTC(2026, 9, 1, 12, 0))
    expect(e[2].name).toBe('tv-del-salon')
    expect(parseQueryLog({})).toEqual([])
  })

  it('qué cuenta como bloqueada', () => {
    for (const r of ['FilteredBlackList', 'FilteredBlockedService', 'FilteredSafeBrowsing', 'FilteredParental']) expect(isBlockedReason(r)).toBe(true)
    for (const r of ['NotFilteredNotFound', 'FilteredSafeSearch', 'Rewrite', '']) expect(isBlockedReason(r)).toBe(false)
  })

  it('prioridad del nombre: el que pones en AdGuard > guest de Proxmox > automático > el del registro', () => {
    const src = {
      persistent: new Map([['1.1.1.1', 'Fijo']]),
      guests: new Map([['1.1.1.1', 'guest'], ['2.2.2.2', 'docker-server']]),
      auto: new Map([['2.2.2.2', { name: 'auto', source: 'ARP' }], ['3.3.3.3', { name: 'tv.lan', source: 'rDNS' }]])
    }
    expect(resolveName('1.1.1.1', src)).toEqual({ name: 'Fijo', source: 'AdGuard' })
    expect(resolveName('2.2.2.2', src)).toEqual({ name: 'docker-server', source: 'Proxmox' })
    expect(resolveName('3.3.3.3', src)).toEqual({ name: 'tv.lan', source: 'rDNS' })
    expect(resolveName('4.4.4.4', src, 'del-registro')).toEqual({ name: 'del-registro', source: 'AdGuard' })
    expect(resolveName('5.5.5.5', src)).toEqual({})
  })
})

// ---- servicio contra un AdGuard simulado ----
let server: http.Server
let base = ''
let failQuerylog = false
const AUTH = `Basic ${Buffer.from('admin:pw').toString('base64')}`

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const send = (code: number, body?: unknown): void => {
      res.writeHead(code, { 'content-type': 'application/json' })
      res.end(body === undefined ? '' : JSON.stringify(body))
    }
    if (req.headers.authorization !== AUTH) return send(401)
    const p = (req.url ?? '').split('?')[0]
    if (p === '/control/status') return send(200, { running: true, protection_enabled: true, version: 'v0.107.50' })
    if (p === '/control/stats') return send(200, stats)
    if (p === '/control/clients') return send(200, clients)
    if (p === '/control/querylog') return failQuerylog ? send(500) : send(200, querylog)
    if (p === '/control/notjson') {
      res.writeHead(200)
      return res.end('<html>login</html>')
    }
    send(404)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => new Promise<void>((r) => server.close(() => r())))

const cfg = (over = {}): { url: string; username: string; password: string } => ({ url: base, username: 'admin', password: 'pw', ...over })
const guests = (): Map<string, string> => new Map([['10.0.0.53', 'docker-server']])

describe('AdguardService', () => {
  it('sin configuración no devuelve nada', async () => {
    expect(await new AdguardService(() => null, guests).get()).toBeNull()
  })

  it('combina estadísticas, clientes con nombre y bloqueos por cliente', async () => {
    const snap = (await new AdguardService(() => cfg(), guests).get())!
    expect(snap.errors).toEqual({})
    expect(snap.status).toMatchObject({ protection: true, version: 'v0.107.50' })
    expect(snap.stats).toMatchObject({ queries: 1000, blocked: 155, clients: 3 })

    // clientes: el nombre fijo de AdGuard, el del guest de Proxmox (gana al ARP) y el automático
    const by = Object.fromEntries(snap.clients.map((c) => [c.ip, c]))
    expect(by['10.0.0.77']).toMatchObject({ name: 'iPhone de Ana', nameSource: 'AdGuard', queries: 300, blocked: 2 })
    expect(by['10.0.0.53']).toMatchObject({ name: 'docker-server', nameSource: 'Proxmox', queries: 500, blocked: 1 })
    expect(by['10.0.0.88']).toMatchObject({ name: 'smart-tv.lan', nameSource: 'rDNS' })

    // sitios bloqueados con QUIÉN los pidió
    const ads = snap.topBlocked.find((d) => d.domain === 'ads.tracker.com')!
    expect(ads.count).toBe(90)
    expect(ads.clients.map((c) => [c.ip, c.name, c.count])).toEqual([['10.0.0.77', 'iPhone de Ana', 2], ['10.0.0.88', 'smart-tv.lan', 1]])
    const tel = snap.topBlocked.find((d) => d.domain === 'telemetry.example.net')!
    expect(tel.clients.find((c) => c.ip === '10.0.0.55')).toMatchObject({ name: undefined, count: 1 }) // sin nombre: solo IP

    // recientes: solo bloqueos (SafeSearch no cuenta), con nombre cuando se conoce
    expect(snap.recent).toHaveLength(5)
    expect(snap.recent[0]).toMatchObject({ ip: '10.0.0.77', name: 'iPhone de Ana', domain: 'ads.tracker.com' })
  })

  it('un fallo en el registro no rompe el resto y se explica', async () => {
    failQuerylog = true
    const snap = (await new AdguardService(() => cfg(), guests).get())!
    failQuerylog = false
    expect(snap.stats?.queries).toBe(1000)
    expect(snap.clients.length).toBeGreaterThan(0)
    expect(snap.errors.querylog).toContain('500')
    expect(snap.recent).toEqual([])
  })

  it('credenciales incorrectas, dirección equivocada y servidor caído: mensajes claros', async () => {
    const bad = (await new AdguardService(() => cfg({ password: 'mala' }), guests).get())!
    expect(bad.errors.status).toBe('Usuario o contraseña incorrectos')
    expect(bad.stats).toBeNull()
    await expect(adguardGet(cfg(), '/control/notjson')).rejects.toThrow('no es de AdGuard')
    await expect(adguardGet(cfg(), '/control/nada')).rejects.toThrow('no parece AdGuard')
    await expect(adguardGet(cfg({ url: 'http://127.0.0.1:1' }), '/control/status')).rejects.toThrow('No se pudo conectar')
  })

  it('solo rutas /control/ permitidas', async () => {
    for (const p of ['/', '/control/../x', '/control/status;rm', '/etc/passwd', 'control/status']) {
      await expect(adguardGet(cfg(), p), p).rejects.toThrow('Ruta no permitida')
    }
  })

  it('probar la conexión', async () => {
    const svc = new AdguardService(() => null, guests)
    expect(await svc.test(cfg())).toMatchObject({ ok: true })
    expect((await svc.test(cfg())).message).toContain('v0.107.50')
    expect(await svc.test(cfg({ password: 'x' }))).toEqual({ ok: false, message: 'Usuario o contraseña incorrectos' })
  })

  it('la caché evita repetir peticiones y un error se reintenta pronto', async () => {
    const svc = new AdguardService(() => cfg(), guests)
    await svc.get()
    let hits = 0
    const counter = http.createServer((_q, r) => { hits++; r.writeHead(200); r.end('{}') })
    await new Promise<void>((r) => counter.listen(0, '127.0.0.1', r))
    const port = (counter.address() as AddressInfo).port
    const svc2 = new AdguardService(() => ({ url: `http://127.0.0.1:${port}` }), guests)
    await svc2.get()
    const first = hits
    await svc2.get()
    expect(hits).toBe(first)
    await new Promise<void>((r) => counter.close(() => r()))
  })
})
