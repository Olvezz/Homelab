// Tipos y constantes compartidos entre main, preload y renderer.

export const TOOLBAR_HEIGHT = 40
export const DEFAULT_SIDEBAR_WIDTH = 260
export const COLLAPSED_SIDEBAR_WIDTH = 56

export const IPC = {
  getConfig: 'config:get',
  savePanels: 'panels:save',
  setUi: 'ui:set',
  showView: 'view:show',
  setOverlay: 'view:overlay',
  nav: 'view:nav',
  decideCert: 'cert:decide',
  closeTab: 'tab:close',
  pveProbe: 'pve:probe',
  pveTest: 'pve:test',
  pveSave: 'pve:save',
  pveForget: 'pve:forget',
  pveRefresh: 'pve:refresh',
  pveAction: 'pve:action',
  pveConsole: 'pve:console',
  pveOpenInPve: 'pve:open-in-pve',
  pveApproveExternal: 'pve:approve-external',
  setNativeTheme: 'theme:native',
  sshList: 'ssh:list',
  sshSave: 'ssh:save',
  sshDelete: 'ssh:delete',
  sshImportPutty: 'ssh:import-putty',
  sshPickKey: 'ssh:pick-key',
  sshOpen: 'ssh:open',
  sshTest: 'ssh:test',
  panelOpenUrl: 'panel:open-url',
  panelClearData: 'panel:clear-data',
  sshInput: 'ssh:input',
  sshResize: 'ssh:resize',
  sshClose: 'ssh:close',
  sshDecideHost: 'ssh:decide-host',
  terminalFocus: 'terminal:focus',
  clipboardRead: 'clipboard:read',
  provisionGet: 'provision:get',
  provisionSave: 'provision:save',
  provisionCopy: 'provision:copy',
  provisionShell: 'provision:shell',
  copyText: 'clipboard:copy',
  updateGet: 'update:get',
  updateCheck: 'update:check',
  updateInstall: 'update:install',
  // eventos main -> renderer
  viewState: 'view:state',
  certPrompt: 'cert:prompt',
  panelsChanged: 'panels:changed',
  snapshot: 'pve:snapshot',
  toast: 'toast',
  themeCookie: 'theme:cookie',
  updateStatus: 'update:status',
  sshData: 'ssh:data',
  sshState: 'ssh:state',
  sshHostPrompt: 'ssh:host-prompt',
  shortcut: 'shortcut'
} as const

export type PanelSource = 'manual' | 'proxmox-notes' | 'proxmox-tag'

export interface Panel {
  id: string // estable: `manual-<uuid>` o `pve-<vmid>-<hash>`
  name: string
  url: string // http(s)://ip:puerto
  icon?: string // opcional: clave de icono (logo de marca o `ui:…`); si falta se asigna sola
  source: PanelSource
  vmid?: number
  // Solo paneles descubiertos con host fuera de rangos privados
  external?: boolean
  // Pestañas efímeras (consolas, Proxmox en un guest): no se guardan y se pueden cerrar
  kind?: 'tab'
  // Partición de sesión a reutilizar (la consola comparte el login de la web de Proxmox)
  sessionId?: string
}

// 'proxmox' = seguir el tema que Proxmox/ProxMorph tenga elegido; 'light' | 'system'; o el id de un tema ProxMorph
export type Theme = string

export interface UiConfig {
  theme: Theme
  sidebarWidth: number
  sidebarCollapsed: boolean
  closeToTray: boolean
  startWithWindows: boolean
  showTemplates: boolean
  autoUpdate: boolean // comprobar y descargar actualizaciones en segundo plano
  lastActiveId?: string
}

export interface PveConfigView {
  host: string
  port: number
  tokenId: string
  fingerprint: string
  pollIntervalSec: number
  secretStored: boolean
}

export type GuestType = 'qemu' | 'lxc'
export type GuestStatus = 'running' | 'stopped' | 'paused' | 'unknown'
export type PowerAction = 'start' | 'shutdown' | 'stop' | 'reboot'

export interface Guest {
  key: string // `${node}/${vmid}`
  vmid: number
  name: string
  node: string
  type: GuestType
  status: GuestStatus
  template: boolean
  cpu: number // fracción 0..1 del total asignado
  maxcpu: number
  mem: number
  maxmem: number
  uptime: number
  tags: string[]
  description: string
  osType?: string // `ostype` de la config de Proxmox (ubuntu, debian, l26, win11…)
  osId?: string // sistema que informa el qemu-guest-agent (ubuntu, debian, mswindows…)
  ips: string[]
  panels: Panel[]
  busy?: PowerAction // acción en curso
}

export interface NodeInfo {
  name: string
  online: boolean
  cpu: number
  maxcpu: number
  mem: number
  maxmem: number
}

export type PveStatus =
  | 'unconfigured'
  | 'needs-secret'
  | 'connecting'
  | 'connected'
  | 'offline'
  | 'unauthorized'
  | 'cert-changed'
  | 'error'

export interface Diagnostic {
  kind: 'note-line' | 'no-ip' | 'external-pending' | 'permission'
  text: string
  vmid?: number
  guest?: string
  url?: string
}

export interface PveSnapshot {
  status: PveStatus
  message?: string
  nodes: NodeInfo[]
  guests: Guest[]
  diagnostics: Diagnostic[]
  canPower: boolean // false tras un 403 al intentar una acción de energía
  updatedAt: number | null
}

export interface AppConfigView {
  panels: Panel[]
  ui: UiConfig
  pve: PveConfigView | null
  snapshot: PveSnapshot
  themeCookie: string | null // valor de PVEThemeCookie en la sesión web de Proxmox
}

export interface UpdateStatus {
  state: 'disabled' | 'idle' | 'checking' | 'downloading' | 'ready' | 'none' | 'error'
  version?: string
  percent?: number
  message?: string
  checkedAt?: number
}

export type SshAuth = 'password' | 'key' | 'agent'

export interface SshConnection {
  id: string
  name: string
  host: string
  port: number
  username: string
  auth: SshAuth
  keyPath?: string // archivo de clave privada (OpenSSH/PEM o .ppk v2)
  hasSecret: boolean // contraseña o frase de paso guardada (cifrada)
}

export interface SshConnectionInput {
  id?: string // sin id = conexión nueva
  name: string
  host: string
  port: number
  username: string
  auth: SshAuth
  keyPath?: string
  secret?: string // undefined = conservar el guardado; '' = borrarlo
}

export interface SshTestResult {
  level: 'ok' | 'warn' | 'error'
  message: string
  fingerprint?: string
}

export type SshState = 'connecting' | 'open' | 'closed' | 'error'

export interface SshSession {
  id: string
  connId: string
  name: string
  state: SshState
  message?: string
}

export interface SshStateEvent {
  id: string
  state: SshState
  message?: string
}

export interface SshDataEvent {
  id: string
  data: Uint8Array
}

export interface SshHostPromptInfo {
  sessionId: string
  host: string
  port: number
  keyType: string
  fingerprint: string // SHA256:…
  previous?: string // huella guardada si ya había una distinta
}

export interface ProvisionView {
  script: string // script que se ejecuta dentro de cada guest nuevo
  isDefault: boolean
  uninstall: string // comando para quitar el vigilante del nodo
}

export interface ViewState {
  panelId: string
  url: string
  title: string
  canGoBack: boolean
  canGoForward: boolean
  loading: boolean
}

export interface CertPromptInfo {
  hostname: string
  fingerprint: string // SHA-256 en hex con ":"
  changed: boolean // true si ya había una huella confiada distinta
  previous?: string
}

export interface ToastMessage {
  id: string
  kind: 'info' | 'ok' | 'error'
  text: string
}

export type Shortcut = 'search' | 'toggleSidebar' | `panel:${number}`

export type NavAction =
  | 'back'
  | 'forward'
  | 'reload'
  | 'openExternal'
  | 'copyUrl'
  | 'zoomIn'
  | 'zoomOut'
  | 'zoomReset'

export interface PveConnectionInput {
  host: string
  port: number
  tokenId: string
  secret: string
  fingerprint: string
  pollIntervalSec: number
}

export interface ProbeResult {
  fingerprint: string
  subject: string
  previous?: string // huella guardada si ya había una distinta
}

export interface GuestRef {
  node: string
  type: GuestType
  vmid: number
}

// API expuesta por el preload en `window.api`
export interface Api {
  getConfig(): Promise<AppConfigView>
  savePanels(panels: Panel[]): Promise<void>
  setUi(patch: Partial<UiConfig>): Promise<UiConfig>
  showView(panelId: string | null): Promise<void>
  setOverlay(on: boolean): Promise<void>
  nav(action: NavAction): Promise<void>
  decideCert(hostname: string, fingerprint: string, accept: boolean): Promise<void>
  closeTab(panelId: string): Promise<void>
  pveProbe(host: string, port: number): Promise<ProbeResult>
  pveTest(input: PveConnectionInput): Promise<string>
  pveSave(input: PveConnectionInput): Promise<void>
  pveForget(): Promise<void>
  pveRefresh(): Promise<void>
  pveAction(ref: GuestRef, action: PowerAction): Promise<void>
  pveConsole(ref: GuestRef, name: string): Promise<string | null>
  pveOpenInPve(ref: GuestRef): Promise<string | null>
  pveApproveExternal(url: string): Promise<void>
  onViewState(cb: (state: ViewState) => void): () => void
  onCertPrompt(cb: (info: CertPromptInfo) => void): () => void
  onPanels(cb: (panels: Panel[]) => void): () => void
  onSnapshot(cb: (snapshot: PveSnapshot) => void): () => void
  setNativeTheme(mode: 'dark' | 'light'): Promise<void>
  listSsh(): Promise<SshConnection[]>
  saveSsh(input: SshConnectionInput): Promise<SshConnection[]>
  deleteSsh(id: string): Promise<SshConnection[]>
  importPutty(): Promise<{ added: number; connections: SshConnection[] }>
  pickSshKey(): Promise<string | null>
  testSsh(input: SshConnectionInput): Promise<SshTestResult>
  openPanelUrl(url: string): Promise<void>
  clearPanelData(panelId: string): Promise<void>
  openSsh(connId: string, cols: number, rows: number, secret?: string): Promise<SshSession>
  sshInput(id: string, data: string): Promise<void>
  resizeSsh(id: string, cols: number, rows: number): Promise<void>
  closeSsh(id: string): Promise<void>
  decideSshHost(id: string, accept: boolean): Promise<void>
  setTerminalFocus(on: boolean): Promise<void>
  readClipboard(): Promise<string>
  onSshData(cb: (event: SshDataEvent) => void): () => void
  onSshState(cb: (event: SshStateEvent) => void): () => void
  onSshHostPrompt(cb: (info: SshHostPromptInfo) => void): () => void
  getProvision(): Promise<ProvisionView>
  saveProvision(script: string | null): Promise<void> // null = restaurar el predeterminado
  copyProvisionInstaller(): Promise<void>
  openProvisionShell(): Promise<string | null>
  copyText(text: string): Promise<void>
  getUpdate(): Promise<UpdateStatus>
  checkUpdate(): Promise<void>
  installUpdate(): Promise<void>
  onUpdate(cb: (status: UpdateStatus) => void): () => void
  onThemeCookie(cb: (value: string | null) => void): () => void
  onToast(cb: (toast: ToastMessage) => void): () => void
  onShortcut(cb: (shortcut: Shortcut) => void): () => void
}
