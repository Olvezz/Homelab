import { safeStorage } from 'electron'
import { Client, type ClientChannel } from 'ssh2'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import type {
  SshAuth,
  SshConnection,
  SshConnectionInput,
  SshHostPromptInfo,
  SshSession,
  SshStateEvent,
  SshTestResult
} from '../../shared/types'
import type { ConfigStore } from '../config/store'
import { log } from '../log'
import { isPpk, PpkError, ppkToOpenSsh } from './ppk'
import { authForPutty, friendlySshError, hostFingerprint, hostKeyType, parsePuttySessions } from './util'

const MAX_KEY_BYTES = 64 * 1024
const WINDOWS_AGENT_PIPE = '\\\\.\\pipe\\openssh-ssh-agent'

// Lee la clave privada. Los .ppk de PuTTY (v2/v3, RSA/ed25519/ECDSA) se convierten en memoria a OpenSSH;
// el resto (OpenSSH, PEM) lo lee ssh2 directamente con la frase de paso.
function loadPrivateKey(path: string | undefined, secret: string | undefined): { privateKey: Buffer; passphrase?: string } {
  if (!path || !existsSync(path)) throw new Error('No se encontró el archivo de la clave')
  if (statSync(path).size > MAX_KEY_BYTES) throw new Error('El archivo de la clave es demasiado grande')
  const raw = readFileSync(path)
  const text = raw.toString('utf8')
  if (isPpk(text)) {
    try {
      return { privateKey: Buffer.from(ppkToOpenSsh(text, secret).pem) }
    } catch (e) {
      if (e instanceof PpkError) throw new Error(e.message)
      throw e
    }
  }
  return { privateKey: raw, passphrase: secret }
}

interface Live {
  session: SshSession
  conn: { host: string; port: number; auth: SshAuth }
  client: Client
  stream: ClientChannel | null
  hostDecision: ((accept: boolean) => void) | null
  ended: boolean
}

// Sesiones SSH interactivas (reemplazo de PuTTY). Todo el tráfico va por ssh2 en el proceso principal;
// la UI solo recibe y envía bytes del terminal. Las huellas de servidor se fijan en el primer uso (TOFU)
// y los secretos se guardan cifrados con safeStorage (DPAPI).
export class SshManager {
  private live = new Map<string, Live>()

  constructor(
    private store: ConfigStore,
    private send: (channel: string, payload: unknown) => void,
    private channels: { data: string; state: string; hostPrompt: string }
  ) {}

  // ---- Conexiones guardadas ----

  list(): SshConnection[] {
    return this.store.get().ssh.map(({ secretEnc, ...c }) => ({ ...c, hasSecret: !!secretEnc }))
  }

  save(input: SshConnectionInput): SshConnection[] {
    const existing = input.id ? this.store.get().ssh.find((c) => c.id === input.id) : undefined
    const id = existing?.id ?? `ssh-${randomUUID().slice(0, 8)}`
    let secretEnc = existing?.secretEnc ?? null
    if (input.secret !== undefined) {
      // '' borra el secreto guardado; sin cifrado disponible nunca se guarda en claro
      secretEnc =
        input.secret && safeStorage.isEncryptionAvailable()
          ? safeStorage.encryptString(input.secret).toString('base64')
          : null
    }
    const next = {
      id,
      name: input.name,
      host: input.host,
      port: input.port,
      username: input.username,
      auth: input.auth,
      keyPath: input.auth === 'key' ? input.keyPath : undefined,
      secretEnc
    }
    this.store.update((c) => {
      const i = c.ssh.findIndex((x) => x.id === id)
      if (i >= 0) c.ssh[i] = next
      else c.ssh.push(next)
    })
    return this.list()
  }

  delete(id: string): SshConnection[] {
    this.store.update((c) => {
      c.ssh = c.ssh.filter((x) => x.id !== id)
    })
    return this.list()
  }

  // Lee las sesiones guardadas de PuTTY (registro de Windows); no modifica nada de PuTTY
  async importPutty(): Promise<{ added: number; connections: SshConnection[] }> {
    if (process.platform !== 'win32') return { added: 0, connections: this.list() }
    const output = await new Promise<string>((resolve) => {
      execFile(
        'reg',
        ['query', 'HKCU\\Software\\SimonTatham\\PuTTY\\Sessions', '/s'],
        { windowsHide: true, maxBuffer: 4_000_000, encoding: 'utf8' },
        (_err, stdout) => resolve(stdout ?? '')
      )
    })
    let added = 0
    for (const s of parsePuttySessions(output)) {
      // PuTTY puede no guardar usuario (lo pregunta al conectar): se usa root como punto de partida editable
      const username = s.username || 'root'
      const dup = this.store.get().ssh.some((c) => c.host === s.host && c.port === s.port && c.username === username)
      if (dup) continue
      this.save({
        name: s.name,
        host: s.host,
        port: s.port,
        username,
        auth: authForPutty(s),
        keyPath: s.keyPath
      })
      added++
    }
    return { added, connections: this.list() }
  }

  // Prueba una conexión sin abrir terminal. Nunca envía credenciales a un servidor cuya huella no esté
  // confirmada: con un servidor desconocido solo comprueba que responde y enseña su huella.
  async test(input: SshConnectionInput): Promise<SshTestResult> {
    const existing = input.id ? this.store.get().ssh.find((c) => c.id === input.id) : undefined
    let secret = input.secret
    if (secret === undefined && existing?.secretEnc && safeStorage.isEncryptionAvailable()) {
      try {
        secret = safeStorage.decryptString(Buffer.from(existing.secretEnc, 'base64'))
      } catch {
        secret = undefined
      }
    }
    if (input.auth === 'password' && !secret) {
      return { level: 'warn', message: 'Escribe la contraseña para probar el acceso (no hace falta guardarla)' }
    }
    let privateKey: Buffer | undefined
    let keyPassphrase: string | undefined
    if (input.auth === 'key') {
      try {
        const k = loadPrivateKey(input.keyPath, secret)
        privateKey = k.privateKey
        keyPassphrase = k.passphrase
      } catch (e) {
        return { level: 'error', message: e instanceof Error ? e.message : String(e) }
      }
    }

    const { host, port, username, auth } = input
    const saved = this.store.get().sshHostKeys[`${host}:${port}`]
    return new Promise<SshTestResult>((resolve) => {
      const client = new Client()
      let settled = false
      let seen = ''
      let verdict: 'unknown' | 'changed' | null = null
      const finish = (r: SshTestResult): void => {
        if (settled) return
        settled = true
        try {
          client.end()
        } catch {
          // ya cerrada
        }
        resolve(r)
      }
      client.on('ready', () =>
        finish({ level: 'ok', message: `Correcto: ${username}@${host}:${port} acepta el acceso`, fingerprint: seen })
      )
      client.on('keyboard-interactive', (_n, _i, _l, prompts, answer) => answer(prompts.map(() => secret ?? '')))
      client.on('error', (e) => {
        if (verdict === 'unknown') {
          finish({
            level: 'warn',
            message: `El servidor responde. Es la primera vez: huella ${seen}. No se probó el acceso; se te pedirá confirmar la huella al conectar.`,
            fingerprint: seen
          })
        } else if (verdict === 'changed') {
          finish({
            level: 'error',
            message: `¡La huella del servidor cambió! Ahora es ${seen} (guardada: ${saved}). No se envió ninguna credencial.`,
            fingerprint: seen
          })
        } else {
          finish({ level: 'error', message: friendlySshError(e.message, host, port, auth) })
        }
      })
      client.on('close', () => finish({ level: 'error', message: 'La conexión se cerró antes de completar la prueba' }))
      try {
        client.connect({
          host,
          port,
          username,
          readyTimeout: 15000,
          tryKeyboard: auth === 'password',
          password: auth === 'password' ? secret : undefined,
          privateKey,
          passphrase: keyPassphrase,
          agent: auth === 'agent' ? (process.env.SSH_AUTH_SOCK ?? (existsSync(WINDOWS_AGENT_PIPE) ? WINDOWS_AGENT_PIPE : 'pageant')) : undefined,
          hostVerifier: ((key: Buffer, verify: (accept: boolean) => void) => {
            seen = hostFingerprint(key)
            if (saved === seen) return verify(true)
            verdict = saved ? 'changed' : 'unknown'
            verify(false) // sin huella confirmada no se autentica
          }) as never
        })
      } catch (e) {
        finish({ level: 'error', message: friendlySshError(e instanceof Error ? e.message : String(e), host, port, auth) })
      }
    })
  }

  // ---- Sesiones ----

  async open(connId: string, cols: number, rows: number, secretOverride?: string): Promise<SshSession> {
    const conn = this.store.get().ssh.find((c) => c.id === connId)
    if (!conn) throw new Error('Conexión SSH no encontrada')

    let secret = secretOverride
    if (secret === undefined && conn.secretEnc && safeStorage.isEncryptionAvailable()) {
      try {
        secret = safeStorage.decryptString(Buffer.from(conn.secretEnc, 'base64'))
      } catch {
        secret = undefined
      }
    }
    if (conn.auth === 'password' && !secret) throw new Error('NEEDS_SECRET')

    let privateKey: Buffer | undefined
    let keyPassphrase: string | undefined
    if (conn.auth === 'key') {
      const k = loadPrivateKey(conn.keyPath, secret)
      privateKey = k.privateKey
      keyPassphrase = k.passphrase
    }

    const id = randomUUID()
    const sameName = [...this.live.values()].filter((l) => l.session.connId === connId).length
    const session: SshSession = {
      id,
      connId,
      name: sameName > 0 ? `${conn.name} (${sameName + 1})` : conn.name,
      state: 'connecting'
    }
    const client = new Client()
    const live: Live = {
      session,
      conn: { host: conn.host, port: conn.port, auth: conn.auth },
      client,
      stream: null,
      hostDecision: null,
      ended: false
    }
    this.live.set(id, live)

    client.on('ready', () => {
      client.shell({ term: 'xterm-256color', cols, rows }, (err, stream) => {
        if (err) return this.fail(live, err.message)
        live.stream = stream
        this.setState(live, 'open')
        stream.on('data', (data: Buffer) => this.send(this.channels.data, { id, data }))
        stream.stderr.on('data', (data: Buffer) => this.send(this.channels.data, { id, data }))
        stream.on('close', () => this.finish(live, 'closed'))
      })
    })
    client.on('keyboard-interactive', (_name, _instructions, _lang, prompts, finish) => {
      finish(prompts.map(() => secret ?? ''))
    })
    client.on('error', (e) => this.fail(live, e.message))
    client.on('close', () => this.finish(live, 'closed'))

    log.info(`SSH: conectando ${conn.username}@${conn.host}:${conn.port} (${conn.auth})`)
    try {
      client.connect({
        host: conn.host,
        port: conn.port,
        username: conn.username,
        readyTimeout: 20000,
        keepaliveInterval: 15000,
        tryKeyboard: conn.auth === 'password',
        password: conn.auth === 'password' ? secret : undefined,
        privateKey,
        passphrase: keyPassphrase,
        agent: conn.auth === 'agent' ? (process.env.SSH_AUTH_SOCK ?? (existsSync(WINDOWS_AGENT_PIPE) ? WINDOWS_AGENT_PIPE : 'pageant')) : undefined,
        hostVerifier: ((key: Buffer, verify: (accept: boolean) => void) => this.verifyHost(live, key, verify)) as never
      })
    } catch (e) {
      this.fail(live, e instanceof Error ? e.message : String(e))
    }
    return session
  }

  input(id: string, data: string): void {
    this.live.get(id)?.stream?.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    this.live.get(id)?.stream?.setWindow(rows, cols, 0, 0)
  }

  close(id: string): void {
    const l = this.live.get(id)
    if (!l) return
    l.ended = true
    l.hostDecision?.(false)
    try {
      l.stream?.close()
      l.client.end()
    } catch {
      // ya cerrada
    }
    this.live.delete(id)
  }

  closeAll(): void {
    for (const id of [...this.live.keys()]) this.close(id)
  }

  decideHost(id: string, accept: boolean): void {
    const l = this.live.get(id)
    if (!l?.hostDecision) return
    const decide = l.hostDecision
    l.hostDecision = null
    decide(accept)
  }

  // ---- Interno ----

  // TOFU: la primera vez se pregunta la huella; si cambia, se avisa con más énfasis (posible suplantación)
  private verifyHost(live: Live, key: Buffer, verify: (accept: boolean) => void): void {
    const { host, port } = live.conn
    const fingerprint = hostFingerprint(key)
    const saved = this.store.get().sshHostKeys[`${host}:${port}`]
    if (saved === fingerprint) return verify(true)

    live.hostDecision = (accept) => {
      if (accept) {
        this.store.update((c) => {
          c.sshHostKeys[`${host}:${port}`] = fingerprint
        })
      }
      verify(accept)
    }
    const info: SshHostPromptInfo = {
      sessionId: live.session.id,
      host,
      port,
      keyType: hostKeyType(key),
      fingerprint,
      previous: saved
    }
    this.send(this.channels.hostPrompt, info)
  }

  private setState(live: Live, state: SshSession['state'], message?: string): void {
    live.session = { ...live.session, state, message }
    const event: SshStateEvent = { id: live.session.id, state, message }
    this.send(this.channels.state, event)
  }

  private fail(live: Live, message: string): void {
    if (live.ended) return
    live.ended = true
    log.warn(`SSH ${live.conn.host}:${live.conn.port}: ${message}`)
    this.setState(live, 'error', friendlySshError(message, live.conn.host, live.conn.port, live.conn.auth))
    try {
      live.client.end()
    } catch {
      // ya cerrada
    }
  }

  private finish(live: Live, state: 'closed'): void {
    if (live.ended) return
    live.ended = true
    this.setState(live, state)
  }
}
