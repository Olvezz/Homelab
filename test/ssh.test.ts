import { describe, expect, it } from 'vitest'
import { authForPutty, friendlySshError, hostFingerprint, hostKeyType, parsePuttySessions } from '../src/main/ssh/util'

const REG = `
HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY\\Sessions\\Default%20Settings
    HostName    REG_SZ

HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY\\Sessions\\Mi%20Servidor
    HostName    REG_SZ    10.0.0.52
    Protocol    REG_SZ    ssh
    PortNumber    REG_DWORD    0x16
    UserName    REG_SZ    root
    PublicKeyFile    REG_SZ    C:\\keys\\id.ppk

HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY\\Sessions\\Puerto%20raro
    HostName    REG_SZ    nas.local
    Protocol    REG_SZ    ssh
    PortNumber    REG_DWORD    0x8ae
    UserName    REG_SZ    admin

HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY\\Sessions\\Telnet
    HostName    REG_SZ    10.0.0.9
    Protocol    REG_SZ    telnet

HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY\\Sessions\\Malo
    HostName    REG_SZ    host con espacios; rm -rf
    Protocol    REG_SZ    ssh
`

describe('importar sesiones de PuTTY', () => {
  const sessions = parsePuttySessions(REG)
  it('lee host, puerto en hexadecimal, usuario y clave', () => {
    expect(sessions).toEqual([
      { name: 'Mi Servidor', host: '10.0.0.52', port: 22, username: 'root', keyPath: 'C:\\keys\\id.ppk' },
      { name: 'Puerto raro', host: 'nas.local', port: 2222, username: 'admin', keyPath: undefined }
    ])
  })
  it('ignora Default Settings, protocolos que no son ssh y hosts inválidos', () => {
    expect(sessions.map((s) => s.name)).not.toContain('Telnet')
    expect(sessions.map((s) => s.name)).not.toContain('Malo')
    expect(sessions.map((s) => s.name)).not.toContain('Default Settings')
  })
  it('con clave usa clave; sin ella, contraseña', () => {
    expect(authForPutty(sessions[0])).toBe('key')
    expect(authForPutty(sessions[1])).toBe('password')
  })
  it('una salida vacía no rompe', () => {
    expect(parsePuttySessions('')).toEqual([])
  })
})

describe('huella del servidor', () => {
  // clave pública ed25519 en formato de red SSH: len("ssh-ed25519") + texto + len(32) + 32 bytes
  const key = Buffer.concat([
    Buffer.from([0, 0, 0, 11]),
    Buffer.from('ssh-ed25519'),
    Buffer.from([0, 0, 0, 32]),
    Buffer.alloc(32, 7)
  ])
  it('tipo y huella al estilo OpenSSH', () => {
    expect(hostKeyType(key)).toBe('ssh-ed25519')
    expect(hostFingerprint(key)).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/)
    expect(hostFingerprint(key)).toBe(hostFingerprint(Buffer.from(key)))
    expect(hostFingerprint(key)).not.toBe(hostFingerprint(Buffer.alloc(40, 1)))
  })
  it('una clave truncada no lanza', () => {
    expect(hostKeyType(Buffer.from([1]))).toBe('desconocido')
  })
})

describe('mensajes de error', () => {
  const f = (m: string, auth: 'password' | 'key' | 'agent' = 'password'): string => friendlySshError(m, '10.0.0.52', 22, auth)
  it('traduce los habituales', () => {
    expect(f('All configured authentication methods failed')).toContain('Autenticación rechazada')
    expect(f('connect ECONNREFUSED 10.0.0.52:22')).toContain('rechazada en 10.0.0.52:22')
    expect(f('Timed out while waiting for handshake')).toContain('Tailscale')
    expect(f('Cannot parse privateKey: Unsupported key format', 'key')).toContain('PuTTYgen')
    expect(f('Encrypted private key detected, but no passphrase given', 'key')).toContain('frase de paso')
    expect(f('All configured authentication methods failed', 'agent')).toContain('agente')
  })
  it('un mensaje desconocido se conserva', () => {
    expect(f('algo raro')).toBe('algo raro')
  })
})
