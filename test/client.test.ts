import { X509Certificate } from 'node:crypto'
import { readFileSync } from 'node:fs'
import https from 'node:https'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CertMismatchError, HttpError, PveClient, probeCertificate } from '../src/main/pve/client'

const dir = join(__dirname, 'fixtures')
const key = readFileSync(join(dir, 'key.pem'))
const cert = readFileSync(join(dir, 'cert.pem'))
const fingerprint = new X509Certificate(cert).fingerprint256
const otherFingerprint = new X509Certificate(readFileSync(join(dir, 'cert2.pem'))).fingerprint256

const SECRET = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const seen: { method?: string; url?: string; auth?: string; body?: string }[] = []

let server: https.Server
let port = 0

beforeAll(async () => {
  server = https.createServer({ key, cert }, (req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, body })
      const send = (status: number, data?: unknown): void => {
        res.writeHead(status, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ data }))
      }
      if (req.headers.authorization !== `PVEAPIToken=user@pve!t=${SECRET}`) return send(401)
      if (req.url === '/api2/json/version') return send(200, { version: '9.2.1' })
      if (req.url === '/api2/json/cluster/resources') return send(200, [{ type: 'lxc', node: 'proxmox', vmid: 100 }])
      if (req.url === '/api2/json/nodes/proxmox/lxc/100/status/start' && req.method === 'POST') {
        return send(200, 'UPID:proxmox:0001')
      }
      if (req.url === '/api2/json/nodes/proxmox/lxc/101/status/start') return send(403)
      send(404)
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  port = (server.address() as AddressInfo).port
})

afterAll(() => new Promise<void>((r) => server.close(() => r())))

const client = (over: Partial<ConstructorParameters<typeof PveClient>[0]> = {}): PveClient =>
  new PveClient({ host: '127.0.0.1', port, tokenId: 'user@pve!t', tokenSecret: SECRET, fingerprint, ...over })

describe('probeCertificate (TOFU)', () => {
  it('devuelve la huella sin confiar en el certificado', async () => {
    const r = await probeCertificate('127.0.0.1', port)
    expect(r.fingerprint).toBe(fingerprint.toUpperCase())
    expect(r.subject).toBe('pve-test')
  })
})

describe('PveClient', () => {
  it('lee versión y recursos con la cabecera del token', async () => {
    seen.length = 0
    expect((await client().version()).version).toBe('9.2.1')
    expect(await client().resources()).toHaveLength(1)
    expect(seen[0].auth).toBe(`PVEAPIToken=user@pve!t=${SECRET}`)
  })

  it('envía POST de energía y devuelve el UPID', async () => {
    expect(await client().power('proxmox', 'lxc', 100, 'start')).toBe('UPID:proxmox:0001')
  })

  it('con otra huella fijada falla ANTES de enviar el token', async () => {
    seen.length = 0
    await expect(client({ fingerprint: otherFingerprint }).version()).rejects.toBeInstanceOf(CertMismatchError)
    expect(seen).toHaveLength(0)
  })

  it('401 con token incorrecto', async () => {
    await expect(client({ tokenSecret: 'incorrecto-incorrecto' }).version()).rejects.toMatchObject({
      name: 'HttpError',
      status: 401
    })
  })

  it('403 sin permiso de energía', async () => {
    const err = await client().power('proxmox', 'lxc', 101, 'start').catch((e) => e)
    expect(err).toBeInstanceOf(HttpError)
    expect(err.status).toBe(403)
  })

  it('sin conexión rechaza con error de red', async () => {
    await expect(client({ port: 1 }).version()).rejects.toBeInstanceOf(Error)
  })
})
