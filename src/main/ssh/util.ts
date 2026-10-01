import { createHash } from 'node:crypto'
import type { SshAuth } from '../../shared/types'

// Huella al estilo OpenSSH: SHA256:<base64 sin relleno>
export function hostFingerprint(key: Buffer): string {
  return 'SHA256:' + createHash('sha256').update(key).digest('base64').replace(/=+$/, '')
}

// Tipo de clave del servidor: primer campo del formato de red de SSH (longitud + texto)
export function hostKeyType(key: Buffer): string {
  try {
    const len = key.readUInt32BE(0)
    return key.subarray(4, 4 + len).toString('ascii')
  } catch {
    return 'desconocido'
  }
}

export interface PuttySession {
  name: string
  host: string
  port: number
  username: string
  keyPath?: string
}

// Salida de `reg query "HKCU\Software\SimonTatham\PuTTY\Sessions" /s`
export function parsePuttySessions(output: string): PuttySession[] {
  const out: PuttySession[] = []
  const blocks = output.split(/\r?\n(?=HKEY_)/)
  for (const block of blocks) {
    const lines = block.split(/\r?\n/)
    const head = /Sessions\\(.+)$/.exec(lines[0]?.trim() ?? '')
    if (!head) continue
    let name = head[1]
    try {
      name = decodeURIComponent(name)
    } catch {
      // nombre con % suelto: se deja tal cual
    }
    if (name === 'Default Settings') continue
    const val = (key: string): string | undefined => {
      for (const l of lines) {
        const m = new RegExp(`^\\s+${key}\\s+REG_\\w+\\s+(.*)$`).exec(l)
        if (m) return m[1].trim()
      }
      return undefined
    }
    const protocol = val('Protocol')
    if (protocol && protocol !== 'ssh') continue
    const host = val('HostName')
    if (!host || !/^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/.test(host)) continue
    const portRaw = val('PortNumber')
    const port = portRaw ? (portRaw.startsWith('0x') ? parseInt(portRaw, 16) : Number(portRaw)) : 22
    const keyPath = val('PublicKeyFile')
    out.push({
      name: name.slice(0, 60),
      host,
      port: Number.isInteger(port) && port > 0 && port <= 65535 ? port : 22,
      username: val('UserName') ?? '',
      keyPath: keyPath || undefined
    })
  }
  return out
}

export function authForPutty(s: PuttySession): SshAuth {
  return s.keyPath ? 'key' : 'password'
}

// Mensajes de ssh2 -> texto claro en español
export function friendlySshError(message: string, host: string, port: number, auth: SshAuth): string {
  const m = message.toLowerCase()
  if (m.includes('all configured authentication methods failed')) {
    return auth === 'agent'
      ? 'Autenticación rechazada: el agente (Pageant/OpenSSH) no tiene una clave válida para este servidor'
      : 'Autenticación rechazada (usuario, contraseña o clave incorrectos)'
  }
  if (m.includes('econnrefused')) return `Conexión rechazada en ${host}:${port} (¿SSH activo en el guest?)`
  if (m.includes('etimedout') || m.includes('timed out') || m.includes('ehostunreach') || m.includes('enetunreach')) {
    return `Sin respuesta de ${host}:${port} (¿Tailscale activo?)`
  }
  if (m.includes('enotfound') || m.includes('getaddrinfo')) return `No se encontró el host ${host}`
  if (m.includes('encrypted private key') || m.includes('passphrase')) {
    return 'La clave está protegida: añade la frase de paso en la conexión'
  }
  if (m.includes('cannot parse privatekey') || m.includes('unsupported key format')) {
    return 'No se pudo leer la clave (formato no reconocido o archivo dañado). Se admiten OpenSSH, PEM y .ppk de PuTTY'
  }
  if (m.includes('host denied') || m.includes('host key') || m.includes('verification failed')) {
    return 'Huella del servidor rechazada'
  }
  if (m.includes('no such file') || m.includes('enoent')) return 'No se encontró el archivo de la clave'
  if (m.includes('agent') && m.includes('not')) return 'No hay agente SSH disponible (abre Pageant o activa el agente de OpenSSH)'
  return message
}
