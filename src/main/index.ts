import { app, BrowserWindow, Menu, nativeImage, nativeTheme, screen, session, shell, Tray } from 'electron'
import type { Event as ElectronEvent, Input, WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import iconPath from '../../resources/icon.png?asset'
import { COLLAPSED_SIDEBAR_WIDTH, IPC, type Shortcut, type UiConfig } from '../shared/types'
import { ConfigStore } from './config/store'
import { registerIpc } from './ipc'
import { log } from './log'
import { PanelHub } from './panelHub'
import { PveService } from './pve/service'
import { CertTrust } from './security/certTrust'
import { AiManager } from './ai/manager'
import { MonitorService } from './pve/monitor'
import { SshManager } from './ssh/manager'
import { Updater } from './updater'
import { ViewManager } from './viewManager'

const isDev = !app.isPackaged
const startHidden = process.argv.includes('--hidden')
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()

let win: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false
// Con un terminal SSH enfocado, los atajos de la app (Ctrl+R, Ctrl+K, Ctrl+B, Ctrl+1..9) pasan al shell
let terminalActive = false

// CSP estricta para la UI propia. En desarrollo Vite necesita scripts inline y websocket (HMR).
function applyCsp(): void {
  const csp = isDev
    ? "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: http://localhost:*"
    : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:"
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] }
    })
  })
  // La UI propia no necesita ningún permiso del navegador
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))
  session.defaultSession.setPermissionCheckHandler(() => false)
}

function applyLoginItem(enabled: boolean): void {
  // En desarrollo registraría electron.exe en el arranque de Windows: solo con la app instalada
  if (!app.isPackaged) return
  app.setLoginItemSettings({ openAtLogin: enabled, args: ['--hidden'] })
}

function showWindow(): void {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function createWindow(store: ConfigStore): void {
  const window = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 500,
    show: false,
    title: 'HomeLab Desktop',
    icon: nativeImage.createFromPath(iconPath),
    backgroundColor: '#1b1d21',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  win = window

  const send = (channel: string, payload: unknown): void => {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send(channel, payload)
  }
  const toast = (t: { kind: 'info' | 'ok' | 'error'; text: string }): void =>
    send(IPC.toast, { id: randomUUID(), ...t })

  // Atajos: las vistas web se quedan con el teclado, así que se interceptan en el main
  const hookInput = (wc: WebContents): void => {
    wc.on('before-input-event', (event: ElectronEvent, input: Input) => {
      if (input.type !== 'keyDown') return
      const key = input.key.toLowerCase()
      if (key === 'f11') {
        event.preventDefault()
        window.setFullScreen(!window.isFullScreen())
        return
      }
      if (terminalActive || !input.control || input.alt || input.meta) return
      if (key === 'r') {
        event.preventDefault()
        if (input.shift) service.refresh()
        else views.nav('reload')
      } else if (key === 'k') {
        event.preventDefault()
        send(IPC.shortcut, 'search' satisfies Shortcut)
      } else if (key === 'b') {
        event.preventDefault()
        send(IPC.shortcut, 'toggleSidebar' satisfies Shortcut)
      } else if (/^[1-9]$/.test(key)) {
        event.preventDefault()
        send(IPC.shortcut, `panel:${key}` as Shortcut)
      }
    })
  }
  hookInput(window.webContents)

  const ui = store.get().ui
  const trust = new CertTrust(store, (info) => send(IPC.certPrompt, info))
  const views = new ViewManager(
    window,
    trust,
    (state) => send(IPC.viewState, state),
    ui.sidebarCollapsed ? COLLAPSED_SIDEBAR_WIDTH : ui.sidebarWidth,
    hookInput
  )

  // service y hub se referencian entre sí a través de estos cierres
  const hubRef: { current?: PanelHub } = {}
  const service = new PveService(
    store,
    (snapshot) => {
      send(IPC.snapshot, snapshot)
      hubRef.current?.sync()
    },
    toast
  )
  const hub = new PanelHub(store, service, views, (panels) => send(IPC.panelsChanged, panels))
  hubRef.current = hub
  // Arrancada en la bandeja (--hidden): no se sondea hasta que la ventana se muestre
  if (startHidden) service.setActive(false)

  const onUiChange = (patch: Partial<UiConfig>): void => {
    if (patch.startWithWindows !== undefined) applyLoginItem(patch.startWithWindows)
  }
  // Las vistas web (Portainer, AdGuard…) siguen el claro/oscuro del tema elegido vía prefers-color-scheme
  const onNativeTheme = (mode: 'dark' | 'light'): void => {
    nativeTheme.themeSource = mode
  }
  views.onThemeCookie = (value) => send(IPC.themeCookie, value)
  views.onPanelStatus = (status) => send(IPC.panelStatus, status)
  const updater = new Updater(
    () => store.get().ui.autoUpdate,
    (status) => send(IPC.updateStatus, status),
    () => {
      quitting = true // la actualización cierra la app de verdad, sin mandarla a la bandeja
    }
  )
  const ssh = new SshManager(store, send, { data: IPC.sshData, state: IPC.sshState, hostPrompt: IPC.sshHostPrompt })
  // El asistente consulta el homelab a través de esta interfaz; las acciones siempre pasan por aprobación
  const ai = new AiManager(
    store,
    send,
    {
      snapshot: () => service.getSnapshot(),
      panels: () => hub.all(),
      sshConnections: () => ssh.list(),
      power: (ref, action) => service.action(ref, action),
      sshExec: (id, command) => ssh.exec(id, command)
    },
    IPC.aiEvent
  )
  const monitor = new MonitorService(
    () => service.getClient(),
    (id, command) => ssh.exec(id, command),
    () => store.get().ui.monitorSshId || undefined
  )
  registerIpc({
    win: window,
    store,
    views,
    trust,
    service,
    hub,
    onUiChange,
    onNativeTheme,
    updater,
    ssh,
    ai,
    monitor,
    setTerminalFocus: (on) => {
      terminalActive = on
    }
  })
  applyLoginItem(ui.startWithWindows)
  nativeTheme.themeSource = ui.theme === 'light' ? 'light' : 'dark'

  // El polling se pausa con la ventana minimizada u oculta
  const syncActive = (): void => service.setActive(window.isVisible() && !window.isMinimized())
  window.on('minimize', syncActive)
  window.on('restore', syncActive)
  window.on('show', syncActive)
  window.on('hide', syncActive)

  screen.on('display-metrics-changed', () => views.layout())

  // La UI propia nunca navega ni abre ventanas con contenido remoto
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event) => event.preventDefault())

  window.once('ready-to-show', () => {
    if (!startHidden) window.show()
  })

  // Cerrar la ventana la manda a la bandeja (configurable); "Salir" del menú de la bandeja cierra de verdad
  window.on('close', (event) => {
    if (!quitting && store.get().ui.closeToTray) {
      event.preventDefault()
      window.hide()
    }
  })
  window.on('closed', () => {
    win = null
    service.stop()
    updater.stop()
    ssh.closeAll()
    ai.reset()
  })

  createTray(
    () => service.refresh(),
    () => void updater.check()
  )

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  hub.sync()
  service.start()
  updater.start()
  log.info(`HomeLab Desktop ${app.getVersion()} iniciado`)
}

function createTray(refresh: () => void, checkUpdates: () => void): void {
  tray = new Tray(nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 }))
  tray.setToolTip('HomeLab Desktop')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Mostrar', click: showWindow },
      { label: 'Refrescar', click: refresh },
      { label: 'Buscar actualizaciones', click: checkUpdates },
      { type: 'separator' },
      { label: 'Salir', click: () => app.quit() }
    ])
  )
  tray.on('click', showWindow)
}

app.on('second-instance', showWindow)
app.on('before-quit', () => {
  quitting = true
})

if (gotLock) {
  void app.whenReady().then(() => {
    Menu.setApplicationMenu(null)
    applyCsp()
    createWindow(new ConfigStore())
  })
}

app.on('window-all-closed', () => app.quit())
