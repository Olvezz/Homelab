import { X509Certificate } from 'node:crypto'
import { app } from 'electron'
import type { Session } from 'electron'
import type { CertPromptInfo } from '../../shared/types'
import type { ConfigStore } from '../config/store'

type VerifyProc = NonNullable<Parameters<Session['setCertificateVerifyProc']>[0]>
type VerifyRequest = Parameters<VerifyProc>[0]

// Confianza de certificados por huella (TOFU). Nunca se ignoran errores de forma global:
// solo se acepta un certificado inválido si host + huella SHA-256 coinciden con lo que el
// usuario confirmó.
export class CertTrust {
  private pending = new Map<string, CertPromptInfo>()
  private declined = new Set<string>()

  constructor(
    private store: ConfigStore,
    private notify: (info: CertPromptInfo) => void
  ) {
    // Chromium reutiliza el rechazo anterior de un certificado sin volver a llamar al verificador, así
    // que tras aceptar la huella la recarga seguiría fallando. Este evento es la segunda barrera:
    // solo se permite si host + huella SHA-256 coinciden exactamente con lo que el usuario confirmó.
    app.on('certificate-error', (event, _wc, url, _error, certificate, callback) => {
      let hostname = ''
      let fingerprint = ''
      try {
        hostname = new URL(url).hostname
        fingerprint = new X509Certificate(certificate.data).fingerprint256
      } catch {
        return callback(false)
      }
      if (this.store.get().trustedCerts[hostname] === fingerprint) {
        event.preventDefault()
        callback(true)
      } else {
        callback(false)
      }
    })
  }

  attach(ses: Session): void {
    ses.setCertificateVerifyProc((req, callback) => callback(this.verify(req)))
  }

  private verify(req: VerifyRequest): number {
    // 0 = aceptar, -3 = usar el resultado de verificación de Chromium
    if (req.verificationResult === 'net::OK') return -3

    let fingerprint: string
    try {
      fingerprint = new X509Certificate(req.certificate.data).fingerprint256
    } catch {
      return -3
    }

    const trusted = this.store.get().trustedCerts[req.hostname]
    if (trusted === fingerprint) return 0

    const key = `${req.hostname}|${fingerprint}`
    if (!this.declined.has(key) && !this.pending.has(key)) {
      const info: CertPromptInfo = {
        hostname: req.hostname,
        fingerprint,
        changed: trusted !== undefined,
        previous: trusted
      }
      this.pending.set(key, info)
      this.notify(info)
    }
    return -3
  }

  // Devuelve true si se aceptó (hay que recargar las vistas de ese host)
  decide(hostname: string, fingerprint: string, accept: boolean): boolean {
    const key = `${hostname}|${fingerprint}`
    // Solo se admite decidir sobre lo que realmente se preguntó al usuario
    if (!this.pending.delete(key)) return false
    if (!accept) {
      this.declined.add(key)
      return false
    }
    this.store.update((c) => {
      c.trustedCerts[hostname] = fingerprint
    })
    return true
  }

  // Al recargar a mano se vuelve a preguntar por los certificados rechazados
  clearDeclined(): void {
    this.declined.clear()
  }
}
