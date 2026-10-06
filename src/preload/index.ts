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
  getPanelStatus: () => ipcRenderer.invoke(IPC.panelStatusGet),
  stopPanel: (panelId) => ipcRenderer.invoke(IPC.panelStop, panelId),
  onPanelStatus: (cb) => on(IPC.panelStatus, cb),
  getAdguard: () => ipcRenderer.invoke(IPC.adguardGet),
  getAdguardConfig: () => ipcRenderer.invoke(IPC.adguardCfgGet),
  saveAdguard: (input) => ipcRenderer.invoke(IPC.adguardSave, input),
  testAdguard: (input) => ipcRenderer.invoke(IPC.adguardTest, input),
  clearAdguard: () => ipcRenderer.invoke(IPC.adguardClear),
  getMonitor: (node, timeframe) => ipcRenderer.invoke(IPC.monitorGet, node, timeframe),
  listSsh: () => ipcRenderer.invoke(IPC.sshList),
  saveSsh: (input) => ipcRenderer.invoke(IPC.sshSave, input),
  deleteSsh: (id) => ipcRenderer.invoke(IPC.sshDelete, id),
  importPutty: () => ipcRenderer.invoke(IPC.sshImportPutty),
  pickSshKey: () => ipcRenderer.invoke(IPC.sshPickKey),
  exportConfig: () => ipcRenderer.invoke(IPC.configExport),
  importConfig: () => ipcRenderer.invoke(IPC.configImport),
  testSsh: (input) => ipcRenderer.invoke(IPC.sshTest, input),
  openPanelUrl: (url) => ipcRenderer.invoke(IPC.panelOpenUrl, url),
  clearPanelData: (panelId) => ipcRenderer.invoke(IPC.panelClearData, panelId),
  openSsh: (connId, cols, rows, secret) => ipcRenderer.invoke(IPC.sshOpen, connId, cols, rows, secret),
  sshInput: (id, data) => ipcRenderer.invoke(IPC.sshInput, id, data),
  resizeSsh: (id, cols, rows) => ipcRenderer.invoke(IPC.sshResize, id, cols, rows),
  closeSsh: (id) => ipcRenderer.invoke(IPC.sshClose, id),
  decideSshHost: (id, accept) => ipcRenderer.invoke(IPC.sshDecideHost, id, accept),
  setTerminalFocus: (on) => ipcRenderer.invoke(IPC.terminalFocus, on),
  readClipboard: () => ipcRenderer.invoke(IPC.clipboardRead),
  onSshData: (cb) => on(IPC.sshData, cb),
  onSshState: (cb) => on(IPC.sshState, cb),
  onSshHostPrompt: (cb) => on(IPC.sshHostPrompt, cb),
  getProvision: () => ipcRenderer.invoke(IPC.provisionGet),
  saveProvision: (script) => ipcRenderer.invoke(IPC.provisionSave, script),
  copyProvisionInstaller: () => ipcRenderer.invoke(IPC.provisionCopy),
  openProvisionShell: () => ipcRenderer.invoke(IPC.provisionShell),
  copyText: (text) => ipcRenderer.invoke(IPC.copyText, text),
  getUpdate: () => ipcRenderer.invoke(IPC.updateGet),
  checkUpdate: () => ipcRenderer.invoke(IPC.updateCheck),
  installUpdate: () => ipcRenderer.invoke(IPC.updateInstall),
  getNotes: () => ipcRenderer.invoke(IPC.notesGet),
  saveNotes: (notes) => ipcRenderer.invoke(IPC.notesSave, notes),
  onUpdate: (cb) => on(IPC.updateStatus, cb),
  onViewState: (cb) => on(IPC.viewState, cb),
  onCertPrompt: (cb) => on(IPC.certPrompt, cb),
  onPanels: (cb) => on(IPC.panelsChanged, cb),
  onSnapshot: (cb) => on(IPC.snapshot, cb),
  onToast: (cb) => on(IPC.toast, cb),
  onShortcut: (cb) => on(IPC.shortcut, cb)
}

contextBridge.exposeInMainWorld('api', api)
