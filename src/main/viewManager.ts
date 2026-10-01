import { BrowserWindow, WebContentsView, clipboard, session, shell } from 'electron'
import type { Session, WebContents } from 'electron'
import { TOOLBAR_HEIGHT, type NavAction, type Panel, type ViewState } from '../shared/types'
import type { CertTrust } from './security/certTrust'

const MAX_LIVE_VIEWS = 8
const PVE_COOKIE = 'PVEAuthCookie'
const THEME_COOKIE = 'PVEThemeCookie'
const ALLOWED_PERMISSION = 'clipboard-sanitized-write'
const PVE_COOKIE_TTL_SEC = 2 * 60 * 60

interface Entry {
  view: WebContentsView
  panel: Panel
  lastUsed: number
}

function isHttpUrl(raw: string): boolean {
  try {
    const { protocol } = new URL(raw)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

function originOf(raw: string): string | null {
  try {
    return new URL(raw).origin
  } catch {
    return null
  }
}

// Gestiona un WebContentsView por panel: se crea al primer uso, se oculta (no se destruye)
// al cambiar de panel y conserva su sesión en una partición persistente propia.
export class ViewManager {
  private entries = new Map<string, Entry>()
  private panels = new Map<string, Panel>()
  private configured = new Set<string>()
  private activeId: string | null = null
  private overlay = false
  // Tema elegido en la web de Proxmox (cookie PVEThemeCookie); null si se borra
  onThemeCookie?: (value: string | null) => void

  constructor(
    private win: BrowserWindow,
    private trust: CertTrust,
    private emit: (state: ViewState) => void,
    private sidebarWidth: number,
    private hookInput: (wc: WebContents) => void
  ) {
    const relayout = (): void => this.layout()
    win.on('resize', relayout)
    win.on('maximize', relayout)
    win.on('unmaximize', relayout)
    win.on('enter-full-screen', relayout)
    win.on('leave-full-screen', relayout)
    win.on('restore', relayout)
  }

  setSidebarWidth(width: number): void {
    this.sidebarWidth = width
    this.layout()
  }

  // Sincroniza con la lista de paneles: descarta las vistas de paneles borrados o con otra URL
  setPanels(panels: Panel[]): void {
    this.panels = new Map(panels.map((p) => [p.id, p]))
    let activeDestroyed = false
    for (const [id, entry] of [...this.entries]) {
      const next = this.panels.get(id)
      if (!next || next.url !== entry.panel.url) {
        this.destroy(id)
        if (id === this.activeId) activeDestroyed = true
      } else {
        entry.panel = next
      }
    }
    if (activeDestroyed && this.activeId && this.panels.has(this.activeId)) {
      this.show(this.activeId)
    } else if (this.activeId && !this.panels.has(this.activeId)) {
      this.activeId = null
    }
  }

  // Carga una URL concreta en la vista de un panel (p. ej. abrir un guest dentro de la web de Proxmox)
  navigate(panelId: string, url: string): void {
    if (!this.panels.has(panelId) || !isHttpUrl(url)) return
    const existing = this.entries.get(panelId)
    if (existing) {
      void existing.view.webContents.loadURL(url).catch(() => undefined)
    } else {
      this.create(this.panels.get(panelId)!, url)
    }
    this.show(panelId)
  }

  show(panelId: string | null): void {
    this.activeId = panelId && this.panels.has(panelId) ? panelId : null
    if (this.activeId) {
      const entry = this.entries.get(this.activeId) ?? this.create(this.panels.get(this.activeId)!)
      entry.lastUsed = Date.now()
    }
    this.layout()
    if (this.activeId && !this.overlay) this.entries.get(this.activeId)?.view.webContents.focus()
    this.emitState(this.activeId)
  }

  // Los modales de la UI propia quedan tapados por las vistas nativas: se ocultan mientras están abiertos
  setOverlay(on: boolean): void {
    this.overlay = on
    this.layout()
  }

  nav(action: NavAction): void {
    const wc = this.activeId ? this.entries.get(this.activeId)?.view.webContents : undefined
    if (!wc) return
    switch (action) {
      case 'back':
        if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack()
        break
      case 'forward':
        if (wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward()
        break
      case 'reload':
        this.trust.clearDeclined()
        wc.reload()
        break
      case 'openExternal': {
        const url = wc.getURL()
        if (isHttpUrl(url)) void shell.openExternal(url)
        break
      }
      case 'copyUrl':
        clipboard.writeText(wc.getURL())
        break
      case 'zoomIn':
        wc.setZoomLevel(Math.min(5, wc.getZoomLevel() + 0.5))
        break
      case 'zoomOut':
        wc.setZoomLevel(Math.max(-3, wc.getZoomLevel() - 0.5))
        break
      case 'zoomReset':
        wc.setZoomLevel(0)
        break
    }
  }

  // Tras confiar en un certificado, recarga las vistas de ese host
  reloadHost(hostname: string): void {
    for (const entry of this.entries.values()) {
      const wc = entry.view.webContents
      let host = ''
      try {
        host = new URL(entry.panel.url).hostname
      } catch {
        continue
      }
      if (host !== hostname) continue
      void wc.session.closeAllConnections().then(() => {
        const current = wc.getURL()
        void wc.loadURL(isHttpUrl(current) ? current : entry.panel.url).catch(() => undefined)
      })
    }
  }

  private create(panel: Panel, initialUrl?: string): Entry {
    if (this.entries.size >= MAX_LIVE_VIEWS) this.evictLeastUsed()

    const partition = `persist:svc-${panel.sessionId ?? panel.id}`
    if (!this.configured.has(partition)) {
      this.configured.add(partition)
      this.configureSession(session.fromPartition(partition))
    }

    const view = new WebContentsView({
      webPreferences: {
        partition,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true
      }
    })
    view.setVisible(false)
    const wc = view.webContents
    this.hookInput(wc)

    // Enlaces nuevos: mismo origen -> misma vista; otro origen -> navegador externo. Nunca ventanas nuevas.
    wc.setWindowOpenHandler(({ url }) => {
      this.routeLink(wc, url)
      return { action: 'deny' }
    })
    wc.on('will-navigate', (event, url) => {
      const here = originOf(wc.getURL())
      const target = originOf(url)
      if (target && (target === here || target === originOf(panel.url))) return
      event.preventDefault()
      if (isHttpUrl(url)) void shell.openExternal(url)
    })

    const update = (): void => this.emitState(panel.id)
    wc.on('did-start-loading', update)
    wc.on('did-stop-loading', update)
    wc.on('did-navigate', update)
    wc.on('did-navigate-in-page', update)
    wc.on('page-title-updated', update)
    wc.on('did-fail-load', update)

    this.win.contentView.addChildView(view)
    const entry: Entry = { view, panel, lastUsed: Date.now() }
    this.entries.set(panel.id, entry)
    void wc.loadURL(initialUrl ?? panel.url).catch(() => undefined) // los fallos se ven en la propia vista
    return entry
  }

  private routeLink(wc: WebContents, url: string): void {
    if (!isHttpUrl(url)) return
    const here = originOf(wc.getURL())
    if (here && originOf(url) === here) {
      void wc.loadURL(url).catch(() => undefined)
    } else {
      void shell.openExternal(url)
    }
  }

  // Permisos denegados, certificados por huella y cookie de Proxmox persistente
  private configureSession(ses: Session): void {
    this.trust.attach(ses)
    // Solo se permite escribir en el portapapeles (copiar contraseñas en un gestor, URLs…); el resto, denegado
    ses.setPermissionRequestHandler((_wc, permission, callback) => callback(permission === ALLOWED_PERMISSION))
    ses.setPermissionCheckHandler((_wc, permission) => permission === ALLOWED_PERMISSION)

    // PVEAuthCookie llega como cookie de sesión: se re-guarda con caducidad (~2 h) para
    // seguir logueado tras reiniciar la app. Nunca se guarda la contraseña.
    ses.cookies.on('changed', (_event, cookie, cause, removed) => {
      if (cookie.name === THEME_COOKIE) {
        if (!removed) this.onThemeCookie?.(cookie.value)
        else if (cause !== 'overwrite') this.onThemeCookie?.(null)
        return
      }
      if (removed || cookie.name !== PVE_COOKIE || !cookie.session) return
      const host = (cookie.domain ?? '').replace(/^\./, '')
      if (!host) return
      void ses.cookies
        .set({
          url: `${cookie.secure ? 'https' : 'http'}://${host}${cookie.path ?? '/'}`,
          name: cookie.name,
          value: cookie.value,
          path: cookie.path,
          secure: cookie.secure,
          httpOnly: cookie.httpOnly,
          sameSite: cookie.sameSite,
          expirationDate: Date.now() / 1000 + PVE_COOKIE_TTL_SEC
        })
        .then(() => ses.cookies.flushStore())
        .catch(() => undefined)
    })
  }

  // Pega el portapapeles en la vista cuando termine de cargar (p. ej. un comando en el shell del nodo).
  // No pulsa Enter: el usuario revisa lo pegado y lo ejecuta.
  pasteWhenReady(panelId: string, delayMs = 3500): void {
    const wc = this.entries.get(panelId)?.view.webContents
    if (!wc) return
    const go = (): void => {
      setTimeout(() => {
        if (wc.isDestroyed()) return
        wc.focus()
        wc.paste()
      }, delayMs)
    }
    if (wc.isLoading()) wc.once('did-finish-load', go)
    else go()
  }

  // Lee PVEThemeCookie de las sesiones de los paneles que apuntan al host de Proxmox
  async readThemeCookie(host: string): Promise<string | null> {
    for (const panel of this.panels.values()) {
      let hostname = ''
      try {
        hostname = new URL(panel.url).hostname
      } catch {
        continue
      }
      if (hostname !== host) continue
      const ses = session.fromPartition(`persist:svc-${panel.sessionId ?? panel.id}`)
      const [cookie] = await ses.cookies.get({ name: THEME_COOKIE }).catch(() => [])
      if (cookie?.value) return cookie.value
    }
    return null
  }

  private evictLeastUsed(): void {
    let oldest: Entry | undefined
    let oldestId = ''
    for (const [id, entry] of this.entries) {
      if (id === this.activeId) continue
      if (!oldest || entry.lastUsed < oldest.lastUsed) {
        oldest = entry
        oldestId = id
      }
    }
    if (oldest) this.destroy(oldestId)
  }

  private destroy(id: string): void {
    const entry = this.entries.get(id)
    if (!entry) return
    this.entries.delete(id)
    this.win.contentView.removeChildView(entry.view)
    entry.view.webContents.close()
  }

  layout(): void {
    const { width, height } = this.win.contentView.getBounds()
    const bounds = {
      x: this.sidebarWidth,
      y: TOOLBAR_HEIGHT,
      width: Math.max(0, width - this.sidebarWidth),
      height: Math.max(0, height - TOOLBAR_HEIGHT)
    }
    for (const [id, entry] of this.entries) {
      entry.view.setBounds(bounds)
      entry.view.setVisible(id === this.activeId && !this.overlay)
    }
  }

  private emitState(id: string | null): void {
    if (!id || id !== this.activeId) return
    const wc = this.entries.get(id)?.view.webContents
    if (!wc || wc.isDestroyed()) return
    this.emit({
      panelId: id,
      url: wc.getURL(),
      title: wc.getTitle(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      loading: wc.isLoading()
    })
  }
}
