import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { z } from 'zod'
import {
  COLLAPSED_SIDEBAR_WIDTH,
  IPC,
  type AppConfigView,
  type Panel,
  type ProbeResult,
  type UiConfig
} from '../shared/types'
import { buildExport, notesSchema, panelsSchema, parseImport, uiPatchSchema, type ConfigStore } from './config/store'
import {
  adguardConfigSchema,
  certDecisionSchema,
  connectionSchema,
  guestNameSchema,
  guestRefSchema,
  hostSchema,
  httpUrlSchema,
  idSchema,
  nativeThemeSchema,
  navSchema,
  portSchema,
  powerActionSchema,
  sshConnectionSchema
} from './ipcSchemas'
import type { PanelHub } from './panelHub'
import { buildHostInstaller, DEFAULT_GUEST_SCRIPT, UNINSTALL_COMMAND, validateGuestScript } from './provision'
import { fetchSiteIcon } from './iconFetch'
import { probeCertificate } from './pve/client'
import { describeError, type PveService } from './pve/service'
import type { CertTrust } from './security/certTrust'
import type { AdguardManager } from './adguard/manager'
import type { MonitorService } from './pve/monitor'
import type { SshManager } from './ssh/manager'
import type { Updater } from './updater'
import type { ViewManager } from './viewManager'

interface Deps {
  win: BrowserWindow
  store: ConfigStore
  views: ViewManager
  trust: CertTrust
  service: PveService
  hub: PanelHub
  onUiChange: (patch: Partial<UiConfig>) => void
  onNativeTheme: (mode: 'dark' | 'light') => void
  updater: Updater
  ssh: SshManager
  monitor: MonitorService
  adguard: AdguardManager
  setTerminalFocus: (on: boolean) => void
}

export function registerIpc({ win, store, views, trust, service, hub, onUiChange, onNativeTheme, updater, ssh, monitor, adguard, setTerminalFocus }: Deps): void {
  // Solo la UI propia (frame principal de la ventana) puede hablar con el main; nunca una vista remota
  const handle = (channel: string, fn: (...args: unknown[]) => unknown): void => {
    ipcMain.handle(channel, (event, ...args) => {
      if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) {
        throw new Error('Remitente no autorizado')
      }
      return fn(...args)
    })
  }

  const currentUi = (): UiConfig => ({ ...store.get().ui })
  const effectiveWidth = (): number =>
    store.get().ui.sidebarCollapsed ? COLLAPSED_SIDEBAR_WIDTH : store.get().ui.sidebarWidth

  handle(IPC.getConfig, async (): Promise<AppConfigView> => {
    const pve = service.getConfigView()
    return {
      panels: hub.all(),
      ui: currentUi(),
      pve,
      snapshot: service.getSnapshot(),
      themeCookie: pve ? await views.readThemeCookie(pve.host) : null
    }
  })

  handle(IPC.savePanels, (raw) => {
    // Solo se guardan los manuales; los descubiertos y las pestañas los gestiona el hub
    const panels: Panel[] = panelsSchema.parse(raw).map((p) => ({ ...p, source: 'manual' as const }))
    store.update((c) => {
      c.panels = panels
    })
    hub.sync()
  })

  handle(IPC.notesGet, () => store.get().notes)
  handle(IPC.notesSave, (raw) => {
    const notes = notesSchema.parse(raw)
    store.update((c) => {
      c.notes = notes
    })
  })

  handle(IPC.setUi, (raw) => {
    const patch = uiPatchSchema.parse(raw)
    store.update((c) => {
      c.ui = { ...c.ui, ...patch }
    })
    if (patch.sidebarWidth !== undefined || patch.sidebarCollapsed !== undefined) {
      views.setSidebarWidth(effectiveWidth())
    }
    onUiChange(patch)
    return currentUi()
  })

  // ---- Arranque de guests nuevos ----
  const guestScript = (): string => store.get().provisionScript ?? DEFAULT_GUEST_SCRIPT

  handle(IPC.provisionGet, () => ({
    script: guestScript(),
    isDefault: store.get().provisionScript === null,
    uninstall: UNINSTALL_COMMAND
  }))

  handle(IPC.provisionSave, (raw) => {
    const script = z.string().max(20000).nullable().parse(raw)
    if (script !== null) {
      const problem = validateGuestScript(script)
      if (problem) throw new Error(problem)
    }
    store.update((c) => {
      c.provisionScript = script
    })
  })

  handle(IPC.provisionCopy, () => {
    clipboard.writeText(buildHostInstaller(guestScript()))
  })

  // Abre el shell del nodo y pega el instalador (sin ejecutarlo): la app nunca corre nada en el nodo sola
  handle(IPC.provisionShell, () => {
    const node = service.getSnapshot().nodes[0]?.name
    if (!node) throw new Error('Conecta primero con Proxmox para saber el nombre del nodo')
    clipboard.writeText(buildHostInstaller(guestScript()))
    const id = hub.openShell(node)
    if (!id) return null
    views.show(id)
    views.pasteWhenReady(id)
    return id
  })

  handle(IPC.copyText, (raw) => {
    clipboard.writeText(z.string().max(200000).parse(raw))
  })

  handle(IPC.panelStatusGet, () => views.statusMap())
  handle(IPC.panelStop, (raw) => views.stop(idSchema.parse(raw)))
  handle(IPC.adguardGet, () => adguard.service.get())
  handle(IPC.adguardCfgGet, () => adguard.view())
  handle(IPC.adguardSave, (raw) => adguard.save(adguardConfigSchema.parse(raw)))
  handle(IPC.adguardTest, (raw) => adguard.test(adguardConfigSchema.parse(raw)))
  handle(IPC.adguardClear, () => adguard.clear())
  handle(IPC.monitorGet, (...raw) => {
    const [node, timeframe] = z.tuple([z.string().regex(/^[A-Za-z0-9-]{1,63}$/), z.enum(['hour', 'day', 'week'])]).parse(raw)
    return monitor.get(node, timeframe)
  })

  // ---- SSH ----
  handle(IPC.sshList, () => ssh.list())
  handle(IPC.sshSave, (raw) => ssh.save(sshConnectionSchema.parse(raw)))
  handle(IPC.sshDelete, (raw) => ssh.delete(z.string().regex(/^ssh-[a-z0-9-]{1,40}$/).parse(raw)))
  handle(IPC.sshImportPutty, () => ssh.importPutty())
  handle(IPC.sshPickKey, async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Clave privada SSH',
      properties: ['openFile', 'showHiddenFiles'],
      filters: [
        { name: 'Claves SSH (OpenSSH, PEM, PuTTY .ppk)', extensions: ['*'] }
      ]
    })
    return r.canceled ? null : (r.filePaths[0] ?? null)
  })
  handle(IPC.sshTest, (raw) => ssh.test(sshConnectionSchema.parse(raw)))
  handle(IPC.panelFetchIcon, (raw) => fetchSiteIcon(httpUrlSchema.parse(raw)))
  handle(IPC.configExport, async () => {
    const r = await dialog.showSaveDialog(win, {
      title: 'Exportar configuración',
      defaultPath: 'homelab-desktop-config.json',
      filters: [{ name: 'Configuración de HomeLab Desktop', extensions: ['json'] }]
    })
    if (r.canceled || !r.filePath) return null
    writeFileSync(r.filePath, JSON.stringify(buildExport(store.get()), null, 2), 'utf8')
    return { path: r.filePath }
  })
  handle(IPC.configImport, async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Importar configuración',
      properties: ['openFile'],
      filters: [{ name: 'Configuración de HomeLab Desktop', extensions: ['json'] }]
    })
    if (r.canceled || !r.filePaths[0]) return null
    let imported: ReturnType<typeof parseImport> = null
    try {
      imported = parseImport(JSON.parse(readFileSync(r.filePaths[0], 'utf8')))
    } catch {
      imported = null
    }
    if (!imported) return { ok: false, error: 'invalid' }
    store.update((d) => Object.assign(d, imported, { appVersion: d.appVersion }))
    // Los servicios guardan la conexión en memoria: se reinicia la app para que arranque con lo importado
    setTimeout(() => {
      app.relaunch()
      app.exit(0)
    }, 600)
    return { ok: true }
  })
  handle(IPC.panelOpenUrl, (raw) => shell.openExternal(httpUrlSchema.parse(raw)))
  handle(IPC.panelClearData, (raw) => views.clearData(idSchema.parse(raw)))
  handle(IPC.sshOpen, (...raw) => {
    const [connId, cols, rows, secret] = z
      .tuple([
        z.string().regex(/^ssh-[a-z0-9-]{1,40}$/),
        z.number().int().min(1).max(1000),
        z.number().int().min(1).max(1000),
        z.string().max(1000).optional()
      ])
      .parse(raw)
    return ssh.open(connId, cols, rows, secret)
  })
  handle(IPC.sshInput, (...raw) => {
    const [id, data] = z.tuple([z.string().uuid(), z.string().max(200000)]).parse(raw)
    ssh.input(id, data)
  })
  handle(IPC.sshResize, (...raw) => {
    const [id, cols, rows] = z.tuple([z.string().uuid(), z.number().int().min(1).max(1000), z.number().int().min(1).max(1000)]).parse(raw)
    ssh.resize(id, cols, rows)
  })
  handle(IPC.sshClose, (raw) => ssh.close(z.string().uuid().parse(raw)))
  handle(IPC.sshDecideHost, (...raw) => {
    const [id, accept] = z.tuple([z.string().uuid(), z.boolean()]).parse(raw)
    ssh.decideHost(id, accept)
  })
  handle(IPC.terminalFocus, (raw) => setTerminalFocus(z.boolean().parse(raw)))
  handle(IPC.clipboardRead, async () => (await clipboard.readText()).slice(0, 200000))

  handle(IPC.updateGet, () => updater.getStatus())
  handle(IPC.updateCheck, () => updater.check())
  handle(IPC.updateInstall, () => {
    updater.install()
  })

  handle(IPC.setNativeTheme, (raw) => {
    onNativeTheme(nativeThemeSchema.parse(raw))
  })

  handle(IPC.showView, (raw) => {
    views.show(z.union([idSchema, z.null()]).parse(raw))
  })

  handle(IPC.setOverlay, (raw) => {
    views.setOverlay(z.boolean().parse(raw))
  })

  handle(IPC.nav, (raw) => {
    views.nav(navSchema.parse(raw))
  })

  handle(IPC.decideCert, (...raw) => {
    const [hostname, fingerprint, accept] = certDecisionSchema.parse(raw)
    if (trust.decide(hostname, fingerprint, accept)) views.reloadHost(hostname)
  })

  handle(IPC.closeTab, (raw) => {
    hub.closeTab(idSchema.parse(raw))
  })

  // ---- Proxmox ----

  handle(IPC.pveProbe, async (...raw): Promise<ProbeResult> => {
    const [host, port] = z.tuple([hostSchema, portSchema]).parse(raw)
    try {
      const { fingerprint, subject } = await probeCertificate(host, port)
      const saved = store.get().pve
      const previous =
        saved && saved.host === host && saved.port === port && saved.fingerprint !== fingerprint
          ? saved.fingerprint
          : undefined
      return { fingerprint, subject, previous }
    } catch {
      throw new Error(`No se pudo conectar con ${host}:${port} (¿Tailscale activo?)`)
    }
  })

  handle(IPC.pveTest, async (raw) => {
    const input = connectionSchema.parse(raw)
    try {
      return await service.test(input)
    } catch (e) {
      throw new Error(describeError(e).message)
    }
  })

  handle(IPC.pveSave, (raw) => {
    service.save(connectionSchema.parse(raw))
    hub.sync()
  })

  handle(IPC.pveForget, () => {
    service.forget()
    hub.sync()
  })

  handle(IPC.pveRefresh, () => {
    service.refresh()
  })

  handle(IPC.pveAction, (...raw) => {
    const [ref, action] = z.tuple([guestRefSchema, powerActionSchema]).parse(raw)
    void service.action(ref, action) // el resultado llega como toast
  })

  handle(IPC.pveConsole, (...raw) => {
    const [ref, name] = z.tuple([guestRefSchema, guestNameSchema]).parse(raw)
    return hub.openConsole(ref, name)
  })

  handle(IPC.pveOpenInPve, (raw) => hub.openInPve(guestRefSchema.parse(raw)))

  handle(IPC.pveApproveExternal, (raw) => {
    service.approveExternal(httpUrlSchema.parse(raw))
  })
}
