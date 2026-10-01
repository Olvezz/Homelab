import https from 'node:https'
import tls from 'node:tls'
import { isIP } from 'node:net'
import type { GuestType, PowerAction } from '../../shared/types'

// Certificado distinto al fijado (pinning por huella SHA-256)
export class CertMismatchError extends Error {
  constructor(public actual: string) {
    super('El certificado de Proxmox cambió')
    this.name = 'CertMismatchError'
  }
}

export class HttpError extends Error {
  constructor(public status: number) {
    super(`PVE ${status}`)
    this.name = 'HttpError'
  }
}

const TIMEOUT_MS = 8000
const MONITOR_PATH = /^\/(nodes\/[A-Za-z0-9-]{1,63}\/(status|rrddata|storage|tasks|syslog|services|apt\/update|disks\/list)|cluster\/log)(\?[A-Za-z0-9=&._-]{0,80})?$/

function connect(
  host: string,
  port: number,
  onSecure: (socket: tls.TLSSocket) => Error | null
): Promise<tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      {
        host,
        port,
        // La verificación de la cadena se sustituye por la comprobación de huella en onSecure
        rejectUnauthorized: false,
        servername: isIP(host) ? undefined : host
      },
      () => {
        const err = onSecure(socket)
        if (err) {
          socket.destroy()
          reject(err)
          return
        }
        socket.setTimeout(0)
        resolve(socket)
      }
    )
    socket.setTimeout(TIMEOUT_MS, () => socket.destroy(new Error('timeout')))
    socket.once('error', reject)
  })
}

// Primer uso (TOFU): lee el certificado sin confiar en él para enseñar su huella al usuario
export async function probeCertificate(
  host: string,
  port: number
): Promise<{ fingerprint: string; subject: string }> {
  let result = { fingerprint: '', subject: '' }
  const socket = await connect(host, port, (s) => {
    const cert = s.getPeerCertificate()
    if (!cert || !cert.fingerprint256) return new Error('El servidor no presentó certificado')
    const subject = typeof cert.subject?.CN === 'string' ? cert.subject.CN : ''
    result = { fingerprint: cert.fingerprint256.toUpperCase(), subject }
    return null
  })
  socket.destroy()
  return result
}

export interface PveClientConfig {
  host: string
  port: number
  tokenId: string
  tokenSecret: string
  fingerprint: string
}

// Cliente del API de Proxmox con pinning por huella: la conexión se verifica ANTES de enviar
// nada, así el token nunca viaja a un servidor con otro certificado. No desactiva la
// verificación TLS de forma global (ver PROYECTO.md §6 y §10).
export class PveClient {
  constructor(private cfg: PveClientConfig) {}

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: Record<string, string>
  ): Promise<T> {
    const expected = this.cfg.fingerprint.toUpperCase()
    const socket = await connect(this.cfg.host, this.cfg.port, (s) => {
      const actual = s.getPeerCertificate()?.fingerprint256?.toUpperCase() ?? ''
      return actual === expected ? null : new CertMismatchError(actual)
    })

    const agent = new https.Agent({ keepAlive: false })
    // El socket ya está conectado y verificado: el agente solo lo reutiliza
    agent.createConnection = () => socket

    const payload = body ? new URLSearchParams(body).toString() : undefined
    return new Promise<T>((resolve, reject) => {
      const req = https.request(
        {
          host: this.cfg.host,
          port: this.cfg.port,
          method,
          path: `/api2/json${path}`,
          agent,
          timeout: TIMEOUT_MS,
          headers: {
            Authorization: `PVEAPIToken=${this.cfg.tokenId}=${this.cfg.tokenSecret}`,
            Connection: 'close',
            ...(payload
              ? {
                  'Content-Type': 'application/x-www-form-urlencoded',
                  'Content-Length': Buffer.byteLength(payload)
                }
              : {})
          }
        },
        (res) => {
          let raw = ''
          res.setEncoding('utf8')
          res.on('data', (chunk: string) => {
            raw += chunk
            if (raw.length > 8_000_000) req.destroy(new Error('respuesta demasiado grande'))
          })
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 400) return reject(new HttpError(res.statusCode))
            try {
              resolve((JSON.parse(raw) as { data: T }).data)
            } catch (e) {
              reject(e)
            }
          })
        }
      )
      req.on('timeout', () => req.destroy(new Error('timeout')))
      req.on('error', reject)
      if (payload) req.write(payload)
      req.end()
    }).finally(() => socket.destroy())
  }

  // Lecturas del panel de inicio: solo rutas de una lista cerrada (nada construido a partir de texto libre)
  getMonitor(path: string): Promise<unknown> {
    if (!MONITOR_PATH.test(path)) throw new Error('Ruta no permitida')
    return this.request('GET', path)
  }
  version(): Promise<{ version: string }> {
    return this.request('GET', '/version')
  }
  resources(): Promise<unknown> {
    return this.request('GET', '/cluster/resources')
  }
  guestConfig(node: string, type: GuestType, vmid: number): Promise<unknown> {
    return this.request('GET', `/nodes/${node}/${type}/${vmid}/config`)
  }
  lxcInterfaces(node: string, vmid: number): Promise<unknown> {
    return this.request('GET', `/nodes/${node}/lxc/${vmid}/interfaces`)
  }
  agentInterfaces(node: string, vmid: number): Promise<unknown> {
    return this.request('GET', `/nodes/${node}/qemu/${vmid}/agent/network-get-interfaces`)
  }
  agentOsInfo(node: string, vmid: number): Promise<unknown> {
    return this.request('GET', `/nodes/${node}/qemu/${vmid}/agent/get-osinfo`)
  }
  // Devuelve el UPID de la tarea
  power(node: string, type: GuestType, vmid: number, action: PowerAction): Promise<string> {
    return this.request('POST', `/nodes/${node}/${type}/${vmid}/status/${action}`)
  }
  taskStatus(node: string, upid: string): Promise<{ status: string; exitstatus?: string }> {
    return this.request('GET', `/nodes/${node}/tasks/${encodeURIComponent(upid)}/status`)
  }
}
