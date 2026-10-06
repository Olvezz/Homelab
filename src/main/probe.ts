import { connect } from 'node:net'

const TIMEOUT_MS = 1500
const CONCURRENCY = 8

// host:puerto de una URL de panel (80 o 443 si no lo indica); null si no es una URL válida
export function endpointOf(url: string): { host: string; port: number } | null {
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    const port = u.port ? Number(u.port) : u.protocol === 'https:' ? 443 : 80
    return { host: u.hostname.replace(/^\[|\]$/g, ''), port }
  } catch {
    return null
  }
}

// ¿Acepta conexiones TCP? Es la forma barata de saber si un servicio está encendido (sin TLS ni credenciales)
export function tcpOpen(host: string, port: number, timeoutMs = TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port })
    let done = false
    const finish = (ok: boolean): void => {
      if (done) return
      done = true
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

// Sondea varias URLs (poca concurrencia). Devuelve url -> encendido
export async function probeUrls(urls: string[]): Promise<Record<string, boolean>> {
  const out: Record<string, boolean> = {}
  const queue = [...new Set(urls)]
  const worker = async (): Promise<void> => {
    for (let url = queue.shift(); url !== undefined; url = queue.shift()) {
      const ep = endpointOf(url)
      out[url] = ep ? await tcpOpen(ep.host, ep.port) : false
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker))
  return out
}
