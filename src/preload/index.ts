import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type Api } from '../shared/types'

// API mínima y tipada: nada de ipcRenderer crudo en el renderer
function on<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: unknown, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: Api = {
  getConfig: () => ipcRenderer.invoke(IPC.getConfig),
  savePanels: (panels) => ipcRenderer.invoke(IPC.savePanels, panels),
  setUi: (patch) => ipcRenderer.invoke(IPC.setUi, patch),
  showView: (panelId) => ipcRenderer.invoke(IPC.showView, panelId),
  setOverlay: (on) => ipcRenderer.invoke(IPC.setOverlay, on),
  nav: (action) => ipcRenderer.invoke(IPC.nav, action),
  decideCert: (hostname, fingerprint, accept) =>
    ipcRenderer.invoke(IPC.decideCert, hostname, fingerprint, accept),
  closeTab: (panelId) => ipcRenderer.invoke(IPC.closeTab, panelId),
  pveProbe: (host, port) => ipcRenderer.invoke(IPC.pveProbe, host, port),
  pveTest: (input) => ipcRenderer.invoke(IPC.pveTest, input),
  pveSave: (input) => ipcRenderer.invoke(IPC.pveSave, input),
  pveForget: () => ipcRenderer.invoke(IPC.pveForget),
  pveRefresh: () => ipcRenderer.invoke(IPC.pveRefresh),
  pveAction: (ref, action) => ipcRenderer.invoke(IPC.pveAction, ref, action),
  pveConsole: (ref, name) => ipcRenderer.invoke(IPC.pveConsole, ref, name),
  pveOpenInPve: (ref) => ipcRenderer.invoke(IPC.pveOpenInPve, ref),
  pveApproveExternal: (url) => ipcRenderer.invoke(IPC.pveApproveExternal, url),
  setNativeTheme: (mode) => ipcRenderer.invoke(IPC.setNativeTheme, mode),
  onThemeCookie: (cb) => on(IPC.themeCookie, cb),
  getProvision: () => ipcRenderer.invoke(IPC.provisionGet),
  saveProvision: (script) => ipcRenderer.invoke(IPC.provisionSave, script),
  copyProvisionInstaller: () => ipcRenderer.invoke(IPC.provisionCopy),
  openProvisionShell: () => ipcRenderer.invoke(IPC.provisionShell),
  copyText: (text) => ipcRenderer.invoke(IPC.copyText, text),
  getUpdate: () => ipcRenderer.invoke(IPC.updateGet),
  checkUpdate: () => ipcRenderer.invoke(IPC.updateCheck),
  installUpdate: () => ipcRenderer.invoke(IPC.updateInstall),
  onUpdate: (cb) => on(IPC.updateStatus, cb),
  onViewState: (cb) => on(IPC.viewState, cb),
  onCertPrompt: (cb) => on(IPC.certPrompt, cb),
  onPanels: (cb) => on(IPC.panelsChanged, cb),
  onSnapshot: (cb) => on(IPC.snapshot, cb),
  onToast: (cb) => on(IPC.toast, cb),
  onShortcut: (cb) => on(IPC.shortcut, cb)
}

contextBridge.exposeInMainWorld('api', api)
