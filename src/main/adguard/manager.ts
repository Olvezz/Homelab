import { safeStorage } from 'electron'
import type { AdguardConfigInput, AdguardConfigView } from '../../shared/types'
import type { ConfigStore } from '../config/store'
import { AdguardService, type AdguardCfg } from './service'

// Configuración de AdGuard Home (dirección y credenciales). La contraseña se cifra con DPAPI y solo la
// usa el proceso principal.
export class AdguardManager {
  readonly service: AdguardService
  // Sin cifrado disponible la contraseña vive solo en memoria durante la sesión
  private sessionPassword: string | null = null

  constructor(
    private store: ConfigStore,
    guestNames: () => Map<string, string>
  ) {
    this.service = new AdguardService(() => this.cfg(), guestNames)
  }

  private storedPassword(): string {
    if (this.sessionPassword) return this.sessionPassword
    const enc = this.store.get().adguard?.passwordEnc
    if (enc && safeStorage.isEncryptionAvailable()) {
      try {
        return safeStorage.decryptString(Buffer.from(enc, 'base64'))
      } catch {
        return ''
      }
    }
    return ''
  }

  private cfg(): AdguardCfg | null {
    const a = this.store.get().adguard
    if (!a) return null
    return { url: a.url, username: a.username || undefined, password: this.storedPassword() }
  }

  view(): AdguardConfigView | null {
    const a = this.store.get().adguard
    if (!a) return null
    return { url: a.url, username: a.username, hasPassword: !!a.passwordEnc || !!this.sessionPassword }
  }

  save(input: AdguardConfigInput): AdguardConfigView {
    const prev = this.store.get().adguard
    let passwordEnc = prev?.passwordEnc ?? null
    if (input.password !== undefined) {
      this.sessionPassword = null
      if (!input.password) passwordEnc = null
      else if (safeStorage.isEncryptionAvailable()) passwordEnc = safeStorage.encryptString(input.password).toString('base64')
      else {
        passwordEnc = null
        this.sessionPassword = input.password
      }
    }
    this.store.update((c) => {
      c.adguard = { url: input.url.replace(/\/+$/, ''), username: input.username ?? '', passwordEnc }
    })
    this.service.reset()
    return this.view()!
  }

  clear(): void {
    this.sessionPassword = null
    this.store.update((c) => {
      c.adguard = null
    })
    this.service.reset()
  }

  test(input: AdguardConfigInput): Promise<{ ok: boolean; message: string }> {
    const password = input.password !== undefined ? input.password : this.storedPassword()
    return this.service.test({ url: input.url.replace(/\/+$/, ''), username: input.username || undefined, password })
  }
}
