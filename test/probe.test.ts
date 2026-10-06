import { createServer, type Server } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { endpointOf, probeUrls, tcpOpen } from '../src/main/probe'

let server: Server
let port = 0

beforeAll(async () => {
  server = createServer((s) => s.destroy())
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  port = (server.address() as { port: number }).port
})
afterAll(() => {
  server.close()
})

describe('endpointOf', () => {
  it('usa el puerto de la URL o el del protocolo', () => {
    expect(endpointOf('http://10.0.0.5:8096/x')).toEqual({ host: '10.0.0.5', port: 8096 })
    expect(endpointOf('https://vault.example.com/')).toEqual({ host: 'vault.example.com', port: 443 })
    expect(endpointOf('http://nas.lan')).toEqual({ host: 'nas.lan', port: 80 })
  })
  it('rechaza lo que no es http(s)', () => {
    expect(endpointOf('ftp://x')).toBeNull()
    expect(endpointOf('no es una url')).toBeNull()
  })
})

describe('tcpOpen / probeUrls', () => {
  it('detecta un puerto abierto y uno cerrado', async () => {
    expect(await tcpOpen('127.0.0.1', port)).toBe(true)
    expect(await tcpOpen('127.0.0.1', 1, 500)).toBe(false)
  })
  it('devuelve el estado de cada URL (y repite sin duplicar)', async () => {
    const up = `http://127.0.0.1:${port}/`
    const down = 'http://127.0.0.1:1/'
    const r = await probeUrls([up, down, up])
    expect(r).toEqual({ [up]: true, [down]: false })
  })
})
