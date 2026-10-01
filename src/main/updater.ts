import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateStatus } from '../shared/types'
import { log } from './log'

const FIRST_CHECK_MS = 20_000
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000

// Actualizaciones desde las versiones publicadas del repositorio (ver `publish` en electron-builder.yml).
// Solo HTTPS; electron-updater comprueba el sha512 de cada instalador contra latest.yml. Solo funciona
// en la app instalada: en desarrollo queda desactivado.
export class Updater {
  private status: UpdateStatus = { state: app.isPackaged ? 'idle' : 'disabled' }
  private timer: NodeJS.Timeout | null = null
  private checking = false

  constructor(
    private autoEnabled: () => boolean,
    private emit: (status: UpdateStatus) => void,
    private beforeInstall: () => void
  ) {
    if (!app.isPackaged) return
    autoUpdater.logger = {
      info: (m: unknown) => log.info(`updater: ${String(m)}`),
      warn: (m: unknown) => log.warn(`updater: ${String(m)}`),
      error: (m: unknown) => log.error(`updater: ${String(m)}`),
      debug: () => undefined
    }
    autoUpdater.autoDownload = true
    // Si la app se cierra de verdad (Salir), la actualización pendiente se instala sola
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.allowDowngrade = false
    autoUpdater.allowPrerelease = false

    autoUpdater.on('checking-for-update', () => this.set({ state: 'checking' }))
    autoUpdater.on('update-available', (info) => this.set({ state: 'downloading', version: info.version, percent: 0 }))
    autoUpdater.on('update-not-available', () => this.set({ state: 'none', checkedAt: Date.now() }))
    autoUpdater.on('download-progress', (p) =>
      this.set({ state: 'downloading', version: this.status.version, percent: Math.round(p.percent) })
    )
    autoUpdater.on('update-downloaded', (info) => this.set({ state: 'ready', version: info.version }))
    autoUpdater.on('error', (e) => {
      log.warn(`updater: ${e?.message ?? e}`)
      this.set({
        state: 'error',
        message: 'No se pudo comprobar si hay actualizaciones (¿sin conexión o aún no hay versiones publicadas?)',
        checkedAt: Date.now()
      })
    })
  }

  getStatus(): UpdateStatus {
    return this.status
  }

  // Primera comprobación poco después de arrancar y luego cada 6 h (si está activado en Ajustes)
  start(): void {
    if (!app.isPackaged) return
    const tick = (): void => {
      if (this.autoEnabled()) void this.check()
    }
    setTimeout(tick, FIRST_CHECK_MS)
    this.timer = setInterval(tick, CHECK_EVERY_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  async check(): Promise<void> {
    if (!app.isPackaged || this.checking) return
    if (this.status.state === 'downloading' || this.status.state === 'ready') return
    this.checking = true
    try {
      await autoUpdater.checkForUpdates()
    } catch {
      // el evento 'error' ya informó del fallo
    } finally {
      this.checking = false
    }
  }

  install(): void {
    if (this.status.state !== 'ready') return
    this.beforeInstall() // evita que "cerrar a la bandeja" impida salir
    log.info(`Instalando la versión ${this.status.version}`)
    autoUpdater.quitAndInstall(false, true)
  }

  private set(status: UpdateStatus): void {
    this.status = status
    this.emit(status)
  }
}
