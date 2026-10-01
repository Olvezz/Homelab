import { generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Server, utils, type ParsedKey } from 'ssh2'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { ed25519Key, rsaKey, writePpk } from './helpers/ppk-writer'

const logDir = mkdtempSync(join(tmpdir(), 'hl-ssh-'))
vi.mock('electron', () => ({
  app: { getPath: () => logDir, getVersion: () => '0.0.0' },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString()
  }
}))

const { SshManager } = await import('../src/main/ssh/manager')
const { ppkToOpenSsh: ppkToOpenSshSync } = await import('../src/main/ssh/ppk')

const CH = { data: 'data', state: 'state', hostPrompt: 'prompt' }
const hostKey = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } }).privateKey

let server: Server
let port = 0
// Clave pública autorizada para el login por clave (la fija cada test)
let allowedKey: ParsedKey | null = null

beforeAll(async () => {
  server = new Server({ hostKeys: [hostKey] }, (client) => {
    client.on('error', () => undefined) // el cliente rechaza la huella a propósito en algunos tests
    client.on('authentication', (ctx) => {
      if (ctx.method === 'password' && ctx.username === 'tester' && ctx.password === 's3cret') ctx.accept()
      else if (ctx.method === 'publickey' && ctx.username === 'tester' && allowedKey && ctx.key.data.equals(allowedKey.getPublicSSH())) {
        if (!ctx.signature) ctx.accept() // consulta previa de la clave
        else if (allowedKey.verify(ctx.blob as Buffer, ctx.signature, ctx.hashAlgo) === true) ctx.accept()
        else ctx.reject()
      } else ctx.reject(['password', 'publickey'])
    })
    client.on('ready', () => {
      client.on('session', (accept) => {
        const session = accept()
        session.on('pty', (acc) => acc())
        session.on('window-change', (acc) => acc && acc())
        session.on('shell', (acc) => {
          const stream = acc()
          stream.write('welcome\r\n')
          stream.on('data', (d: Buffer) => stream.write('echo:' + d.toString()))
        })
      })
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  port = (server.address() as AddressInfo).port
})
afterAll(() => new Promise<void>((r) => server.close(() => r())))

interface Payload {
  id?: string
  data?: Uint8Array
  state?: string
  message?: string
  fingerprint?: string
  keyType?: string
  previous?: string
}
interface Conn {
  id: string
  name: string
  host: string
  port: number
  username: string
  auth: string
  secretEnc: string | null
}

interface Harness {
  mgr: InstanceType<typeof SshManager>
  events: { channel: string; payload: Payload }[]
  config: { ssh: Conn[]; sshHostKeys: Record<string, string> }
}

function harness(auth: 'password' | 'key' | 'agent' = 'password'): Harness {
  const config = {
    ssh: [{ id: 'ssh-test', name: 'Test', host: '127.0.0.1', port, username: 'tester', auth, secretEnc: null }],
    sshHostKeys: {} as Record<string, string>
  }
  const events: Harness['events'] = []
  const store = {
    get: () => config,
    update: (fn: (c: typeof config) => void) => fn(config)
  }
  const mgr = new SshManager(store as never, (channel, payload) => events.push({ channel, payload: payload as Payload }), CH)
  return { mgr, events, config }
}

const waitFor = async (cond: () => boolean, ms = 8000): Promise<void> => {
  const t0 = Date.now()
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timeout esperando la condición')
    await new Promise((r) => setTimeout(r, 25))
  }
}
const text = (h: Harness): string =>
  h.events
    .filter((e) => e.channel === 'data')
    .map((e) => Buffer.from(e.payload.data ?? []).toString())
    .join('')
const lastState = (h: Harness): Payload | undefined => h.events.filter((e) => e.channel === 'state').at(-1)?.payload

describe('SshManager contra un servidor SSH local', () => {
  it('pide confirmar la huella la primera vez, abre el shell y hace eco', async () => {
    const h = harness()
    const session = await h.mgr.open('ssh-test', 80, 24, 's3cret')
    expect(session.state).toBe('connecting')

    await waitFor(() => h.events.some((e) => e.channel === 'prompt'))
    const prompt = h.events.find((e) => e.channel === 'prompt')!.payload
    expect(prompt.fingerprint).toMatch(/^SHA256:/)
    expect(prompt.keyType).toBe('ssh-rsa')
    expect(prompt.previous).toBeUndefined()

    h.mgr.decideHost(session.id, true)
    await waitFor(() => lastState(h)?.state === 'open')
    await waitFor(() => text(h).includes('welcome'))
    expect(h.config.sshHostKeys[`127.0.0.1:${port}`]).toBe(prompt.fingerprint)

    h.mgr.input(session.id, 'hola')
    await waitFor(() => text(h).includes('echo:hola'))
    h.mgr.resize(session.id, 100, 30) // no lanza
    h.mgr.close(session.id)
  })

  it('con la huella ya conocida conecta sin preguntar', async () => {
    const first = harness()
    const s1 = await first.mgr.open('ssh-test', 80, 24, 's3cret')
    await waitFor(() => first.events.some((e) => e.channel === 'prompt'))
    first.mgr.decideHost(s1.id, true)
    await waitFor(() => lastState(first)?.state === 'open')
    first.mgr.close(s1.id)

    const second = harness()
    second.config.sshHostKeys = { ...first.config.sshHostKeys }
    const s2 = await second.mgr.open('ssh-test', 80, 24, 's3cret')
    await waitFor(() => lastState(second)?.state === 'open')
    expect(second.events.some((e) => e.channel === 'prompt')).toBe(false)
    second.mgr.close(s2.id)
  })

  it('avisa con la huella anterior si el servidor cambió de clave', async () => {
    const h = harness()
    h.config.sshHostKeys[`127.0.0.1:${port}`] = 'SHA256:huella-antigua'
    const s = await h.mgr.open('ssh-test', 80, 24, 's3cret')
    await waitFor(() => h.events.some((e) => e.channel === 'prompt'))
    expect(h.events.find((e) => e.channel === 'prompt')!.payload.previous).toBe('SHA256:huella-antigua')
    h.mgr.decideHost(s.id, false)
    await waitFor(() => lastState(h)?.state === 'error')
    h.mgr.close(s.id)
  })

  it('rechazar la huella cancela la conexión sin guardarla', async () => {
    const h = harness()
    const s = await h.mgr.open('ssh-test', 80, 24, 's3cret')
    await waitFor(() => h.events.some((e) => e.channel === 'prompt'))
    h.mgr.decideHost(s.id, false)
    await waitFor(() => lastState(h)?.state === 'error')
    expect(h.config.sshHostKeys).toEqual({})
    h.mgr.close(s.id)
  })

  it('contraseña incorrecta: error claro en español', async () => {
    const h = harness()
    h.config.sshHostKeys = {}
    const s = await h.mgr.open('ssh-test', 80, 24, 'mala')
    await waitFor(() => h.events.some((e) => e.channel === 'prompt'))
    h.mgr.decideHost(s.id, true)
    await waitFor(() => lastState(h)?.state === 'error')
    expect(lastState(h)?.message).toContain('Autenticación rechazada')
    h.mgr.close(s.id)
  })

  it('sin contraseña guardada pide el secreto (NEEDS_SECRET)', async () => {
    const h = harness()
    await expect(h.mgr.open('ssh-test', 80, 24)).rejects.toThrow('NEEDS_SECRET')
  })

  it('puerto sin servidor: mensaje de conexión rechazada', async () => {
    const h = harness()
    h.config.ssh[0].port = 1
    const s = await h.mgr.open('ssh-test', 80, 24, 's3cret')
    await waitFor(() => lastState(h)?.state === 'error')
    expect(lastState(h)?.message).toMatch(/rechazada|Sin respuesta/)
    h.mgr.close(s.id)
  })

  it('guardar cifra o no guarda el secreto y no lo expone en la lista', () => {
    const h = harness()
    const list = h.mgr.save({ name: 'Nuevo', host: '10.0.0.5', port: 22, username: 'root', auth: 'password', secret: 'x' })
    expect(list).toHaveLength(2)
    const nuevo = list.find((c) => c.name === 'Nuevo')!
    expect(JSON.stringify(list)).not.toContain('secretEnc')
    expect(nuevo.hasSecret).toBe(false) // sin cifrado disponible nunca se guarda en claro
    expect(h.mgr.delete(nuevo.id)).toHaveLength(1)
  })
})

describe('Probar conexión', () => {
  const input = (over: Record<string, unknown> = {}): Parameters<InstanceType<typeof SshManager>['test']>[0] =>
    ({ name: 'T', host: '127.0.0.1', port, username: 'tester', auth: 'password', secret: 's3cret', ...over }) as never

  it('servidor desconocido: enseña la huella y NO envía la contraseña', async () => {
    const h = harness()
    const r = await h.mgr.test(input())
    expect(r.level).toBe('warn')
    expect(r.fingerprint).toMatch(/^SHA256:/)
    expect(r.message).toContain('primera vez')
    expect(h.config.sshHostKeys).toEqual({}) // probar no guarda la huella
  })

  it('huella conocida y contraseña correcta: correcto', async () => {
    const h = harness()
    const first = await h.mgr.test(input())
    h.config.sshHostKeys[`127.0.0.1:${port}`] = first.fingerprint!
    const r = await h.mgr.test(input())
    expect(r.level).toBe('ok')
    expect(r.message).toContain('acepta el acceso')
  })

  it('huella conocida y contraseña incorrecta: autenticación rechazada', async () => {
    const h = harness()
    const first = await h.mgr.test(input())
    h.config.sshHostKeys[`127.0.0.1:${port}`] = first.fingerprint!
    const r = await h.mgr.test(input({ secret: 'mala' }))
    expect(r.level).toBe('error')
    expect(r.message).toContain('Autenticación rechazada')
  })

  it('huella distinta a la guardada: error y no autentica', async () => {
    const h = harness()
    h.config.sshHostKeys[`127.0.0.1:${port}`] = 'SHA256:otra'
    const r = await h.mgr.test(input())
    expect(r.level).toBe('error')
    expect(r.message).toContain('cambió')
  })

  it('sin contraseña avisa; puerto cerrado da error de red', async () => {
    const h = harness()
    expect((await h.mgr.test(input({ secret: undefined }))).level).toBe('warn')
    const r = await h.mgr.test(input({ port: 1 }))
    expect(r.level).toBe('error')
  })
})

describe('Acceso con clave .ppk de PuTTY', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hl-ppk-'))

  async function prepared(key: ReturnType<typeof ed25519Key>, version: 2 | 3, passphrase?: string): Promise<{ h: Harness; input: Record<string, unknown> }> {
    const file = join(dir, `k-${Math.random().toString(36).slice(2)}.ppk`)
    writeFileSync(file, writePpk(key, { version, passphrase }))
    const { ppkToOpenSsh } = await import('../src/main/ssh/ppk')
    const parsed = utils.parseKey(ppkToOpenSsh(readFileSync(file, 'utf8'), passphrase).pem)
    allowedKey = Array.isArray(parsed) ? parsed[0] : (parsed as ParsedKey)
    const h = harness('key')
    h.config.ssh[0].keyPath = file
    // huella del servidor ya confirmada
    const first = await h.mgr.test({ name: 'T', host: '127.0.0.1', port, username: 'tester', auth: 'key', keyPath: file, secret: passphrase } as never)
    h.config.sshHostKeys[`127.0.0.1:${port}`] = first.fingerprint!
    return { h, input: { name: 'T', host: '127.0.0.1', port, username: 'tester', auth: 'key', keyPath: file, secret: passphrase } }
  }

  it('ed25519 v3 con frase de paso: probar y abrir sesión', async () => {
    const { h, input } = await prepared(ed25519Key(true), 3, 'mi frase')
    expect((await h.mgr.test(input as never)).level).toBe('ok')
    const s = await h.mgr.open('ssh-test', 80, 24, 'mi frase')
    await waitFor(() => lastState(h)?.state === 'open')
    h.mgr.close(s.id)
  })

  it('RSA v2 sin frase de paso', async () => {
    const { h, input } = await prepared(rsaKey(), 2)
    expect((await h.mgr.test(input as never)).level).toBe('ok')
  })

  it('frase de paso incorrecta o ausente: mensaje claro, sin intentar conectar', async () => {
    const { h, input } = await prepared(ed25519Key(true), 3, 'buena')
    const bad = await h.mgr.test({ ...input, secret: 'mala' } as never)
    expect(bad.level).toBe('error')
    expect(bad.message).toContain('Frase de paso incorrecta')
    const none = await h.mgr.test({ ...input, secret: undefined } as never)
    expect(none.message).toContain('frase de paso')
  })

  it('una clave que el servidor no tiene autorizada: autenticación rechazada', async () => {
    const { h, input } = await prepared(ed25519Key(true), 3)
    allowedKey = (() => {
      const other = utils.parseKey(
        ppkToOpenSshSync(writePpk(ed25519Key(true), { version: 3 })).pem
      )
      return Array.isArray(other) ? other[0] : (other as ParsedKey)
    })()
    const r = await h.mgr.test(input as never)
    expect(r.level).toBe('error')
    expect(r.message).toContain('Autenticación rechazada')
  })
})
