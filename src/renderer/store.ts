import { create } from 'zustand'
import {
  COLLAPSED_SIDEBAR_WIDTH,
  type CertPromptInfo,
  type Guest,
  type Panel,
  type PowerAction,
  type PveConfigView,
  type PanelStatus,
  type PveSnapshot,
  type SshConnection,
  type SshConnectionInput,
  type SshHostPromptInfo,
  type SshSession,
  type Shortcut,
  type ToastMessage,
  type UiConfig,
  type UpdateStatus,
  type ViewState
} from '../shared/types'
import type { MapInput } from '../shared/map'
import { defaultLayout, organize, type LayoutSection, type SidebarLayout } from '../shared/layout'
import { errMsg, t } from './i18n'
import { pushData } from './sshBus'

export type ItemKind = 'panel' | 'ssh' | 'session' | 'folder'

export type Page = 'view' | 'settings' | 'wizard' | 'ssh' | 'notes' | 'map'

export interface ConfirmState {
  title: string
  body: string
  confirmLabel: string
  danger?: boolean
  onConfirm: () => void
}

interface State {
  ready: boolean
  panels: Panel[]
  ui: UiConfig
  pve: PveConfigView | null
  snapshot: PveSnapshot
  themeCookie: string | null
  panelStatus: Record<string, PanelStatus>
  update: UpdateStatus
  activeId: string | null
  page: Page
  viewState: ViewState | null
  certQueue: CertPromptInfo[]
  toast: ToastMessage | null
  confirm: ConfirmState | null
  menu: { guest: Guest; x: number; y: number } | null
  searchOpen: boolean
  itemMenu: { kind: ItemKind; id: string; x: number; y: number } | null // menú contextual de un elemento de la barra lateral
  editRequest: { kind: 'panel' | 'ssh'; id: string } | null // elemento a editar al abrir Ajustes
  expanded: Record<string, boolean>
  sshConnections: SshConnection[]
  sshSessions: SshSession[]
  activeSshId: string | null
  sshHostQueue: SshHostPromptInfo[]
  sshSecretPrompt: { connId: string; name: string } | null
  sshDraft: Partial<SshConnectionInput> | null // conexión nueva con datos de un guest
  settingsAnchor: string | null // sección de Ajustes a la que desplazarse al abrir
  layout: SidebarLayout // orden, carpetas y fijados de la barra lateral
  folderDialog: { id?: string; section: LayoutSection; assign?: string } | null // crear/editar carpeta (assign: elemento a meter en ella)

  init: () => Promise<void>
  selectPanel: (id: string) => void
  openNotes: () => void
  openMap: () => void
  openSettings: (anchor?: string) => void
  closeSettings: () => void
  openWizard: () => void
  closeWizard: () => void
  saveManualPanels: (panels: Panel[]) => Promise<void>
  setUi: (patch: Partial<UiConfig>) => void
  setLayout: (next: SidebarLayout) => void
  openFolderDialog: (d: { id?: string; section: LayoutSection; assign?: string }) => void
  closeFolderDialog: () => void
  setSidebarWidthLive: (width: number) => void
  decideCert: (accept: boolean) => void
  showToast: (kind: ToastMessage['kind'], text: string) => void
  dismissToast: () => void
  askConfirm: (c: ConfirmState) => void
  closeConfirm: () => void
  openMenu: (guest: Guest, x: number, y: number) => void
  closeMenu: () => void
  openItemMenu: (kind: ItemKind, id: string, x: number, y: number) => void
  closeItemMenu: () => void
  requestEdit: (kind: 'panel' | 'ssh', id: string) => void
  setSearch: (open: boolean) => void
  toggleExpand: (key: string) => void
  setSshConnections: (connections: SshConnection[]) => void
  openSsh: (connId: string, secret?: string) => Promise<void>
  selectSsh: (id: string) => void
  closeSsh: (id: string) => void
  reconnectSsh: (session: SshSession) => Promise<void>
  answerSshHost: (accept: boolean) => void
  submitSshSecret: (secret: string) => void
  cancelSshSecret: () => void
  openSshForGuest: (guest: Guest) => Promise<void>
  runAction: (guest: Guest, action: PowerAction) => void
  openConsole: (guest: Guest) => Promise<void>
  openInPve: (guest: Guest) => Promise<void>
  closeTab: (id: string) => void
}

const emptySnapshot: PveSnapshot = {
  status: 'unconfigured',
  nodes: [],
  guests: [],
  diagnostics: [],
  canPower: true,
  updatedAt: null
}

const defaultUi: UiConfig = {
  theme: 'proxmox',
  sidebarWidth: 260,
  sidebarCollapsed: false,
  closeToTray: true,
  startWithWindows: false,
  showTemplates: false,
  autoUpdate: true
}

export const effectiveSidebarWidth = (ui: UiConfig): number =>
  ui.sidebarCollapsed ? COLLAPSED_SIDEBAR_WIDTH : ui.sidebarWidth

// Paneles de la sección "Paneles" (los que Ctrl+1..9 recorren): todo menos pestañas efímeras
// Un panel descubierto con la misma URL que uno manual se resuelve al manual (el hub no carga el duplicado)
export function resolvePanel(panels: Panel[], p: Panel): Panel {
  if (p.source === 'manual') return p
  const norm = (u: string): string => u.replace(/\/$/, '')
  return panels.find((m) => m.source === 'manual' && norm(m.url) === norm(p.url)) ?? p
}

export const listedPanels = (panels: Panel[]): Panel[] => panels.filter((p) => p.kind !== 'tab')

// Lo que el mapa de red sabe de la infraestructura (también alimenta el selector «Conectado a»)
export function mapInputOf(s: Pick<State, 'pve' | 'snapshot' | 'panels' | 'layout' | 'ui'>, group: { tags: boolean; folders: boolean } = { tags: false, folders: false }): MapInput {
  return {
    pve: s.pve ? { host: s.pve.host, port: s.pve.port } : null,
    nodes: s.snapshot.nodes.map((n) => ({ name: n.name, online: n.online })),
    guests: s.snapshot.guests.map((g) => ({ key: g.key, vmid: g.vmid, name: g.name, node: g.node, type: g.type, status: g.status, ips: g.ips, template: g.template, tags: g.tags })),
    panels: listedPanels(s.panels).map((p) => ({ id: p.id, name: p.name, url: p.url, vmid: p.vmid, mapKind: p.mapKind, mapLink: p.mapLink, folder: s.layout.folderOf[p.id] })),
    folders: s.layout.folders.filter((f) => f.section === 'panels').map((f) => ({ id: f.id, name: f.name, color: f.color })),
    showTemplates: s.ui.showTemplates,
    groupByTags: group.tags,
    groupByFolders: group.folders
  }
}

// Paneles en el orden en que se ven en la barra lateral (fijados, carpetas, sueltos): lo que recorren Ctrl+1..9
export function visiblePanels(panels: Panel[], layout: SidebarLayout): Panel[] {
  const o = organize(listedPanels(panels), layout, 'panels')
  return [...o.pinned, ...o.groups.flatMap((g) => g.items), ...o.loose]
}

const earlySshState = new Map<string, { id: string; state: SshSession['state']; message?: string }>()

let userPicked = false
let wantedId: string | undefined
let listening = false

export const useStore = create<State>((set, get) => ({
  ready: false,
  panels: [],
  ui: defaultUi,
  pve: null,
  snapshot: emptySnapshot,
  themeCookie: null,
  panelStatus: {},
  update: { state: 'idle' },
  activeId: null,
  page: 'view',
  viewState: null,
  certQueue: [],
  toast: null,
  confirm: null,
  menu: null,
  itemMenu: null,
  editRequest: null,
  searchOpen: false,
  expanded: {},
  sshConnections: [],
  sshSessions: [],
  activeSshId: null,
  sshHostQueue: [],
  sshSecretPrompt: null,
  sshDraft: null,
  settingsAnchor: null,
  layout: defaultLayout(),
  folderDialog: null,

  init: async () => {
    const { panels, ui, pve, snapshot, themeCookie, layout } = await window.api.getConfig()
    wantedId = ui.lastActiveId
    const activeId = panels.find((p) => p.id === ui.lastActiveId)?.id ?? listedPanels(panels)[0]?.id ?? null
    // Sin conexión configurada se abre el asistente (se puede omitir)
    const page: Page = snapshot.status === 'unconfigured' && !pve ? 'wizard' : 'map'
    set({ ready: true, panels, ui, pve, snapshot, themeCookie, activeId, page, layout })

    if (!listening) {
      listening = true
      window.api.onViewState((viewState) => {
        if (viewState.panelId === get().activeId) set({ viewState })
      })
      window.api.onCertPrompt((info) => set((s) => ({ certQueue: [...s.certQueue, info] })))
      window.api.onSnapshot((snap) => {
        set({ snapshot: snap })
        // La config del token puede haber cambiado (primer guardado, olvidar…): se relee solo si hace falta
        const hasCfg = !!get().pve
        if (snap.status === 'unconfigured' && hasCfg) set({ pve: null })
        else if (snap.status !== 'unconfigured' && !hasCfg) {
          void window.api.getConfig().then((c) => set({ pve: c.pve }))
        }
      })
      window.api.onPanels((next) => {
        const s = get()
        let activeId = s.activeId
        // El panel recordado puede aparecer después (los descubiertos llegan tras el primer sondeo)
        if (!userPicked && wantedId && next.some((p) => p.id === wantedId)) activeId = wantedId
        if (!activeId || !next.some((p) => p.id === activeId)) activeId = listedPanels(next)[0]?.id ?? null
        set({ panels: next, activeId })
        if (activeId !== s.activeId && s.page === 'view') {
          set({ viewState: null })
          void window.api.showView(activeId)
        }
      })
      window.api.onThemeCookie((value) => set({ themeCookie: value }))
      window.api.onPanelStatus((panelStatus) => set({ panelStatus }))
      void window.api.getPanelStatus().then((panelStatus) => set({ panelStatus }))
      window.api.onSshData((e) => pushData(e.id, e.data))
      window.api.onSshState((e) => {
        if (!get().sshSessions.some((s) => s.id === e.id)) {
          earlySshState.set(e.id, e) // el estado puede llegar antes de que la sesión se añada
          return
        }
        set((s) => ({
          sshSessions: s.sshSessions.map((x) => (x.id === e.id ? { ...x, state: e.state, message: e.message } : x))
        }))
      })
      window.api.onSshHostPrompt((info) => set((s) => ({ sshHostQueue: [...s.sshHostQueue, info] })))
      void window.api.listSsh().then((sshConnections) => set({ sshConnections }))
      window.api.onUpdate((update) => {
        set({ update })
        if (update.state === 'ready') get().showToast('ok', t('updateReadyToast', { version: update.version ?? '' }))
      })
      void window.api.getUpdate().then((update) => set({ update }))
      window.api.onToast((toast) => get().showToast(toast.kind, toast.text))
      window.api.onShortcut((sc) => handleShortcut(sc))
    }

    await window.api.showView(null) // se arranca en el mapa (o en el asistente): ninguna vista web delante
  },

  selectPanel: (id) => {
    userPicked = true
    set({ activeId: id, page: 'view', viewState: null, menu: null, searchOpen: false })
    if (!get().panels.find((p) => p.id === id)?.kind) void window.api.setUi({ lastActiveId: id })
    void window.api.showView(id)
  },

  openMap: () => {
    set({ page: 'map', menu: null, itemMenu: null, searchOpen: false })
    void window.api.showView(null)
  },
  openNotes: () => {
    set({ page: 'notes', menu: null, itemMenu: null, searchOpen: false })
    void window.api.showView(null)
  },
  openSettings: (anchor) => {
    // onClick={openSettings} pasa el evento como primer argumento: solo vale un texto
    set({ page: 'settings', settingsAnchor: typeof anchor === 'string' ? anchor : null })
    void window.api.showView(null)
  },
  closeSettings: () => {
    set({ page: 'view' })
    void window.api.showView(get().activeId)
  },
  openWizard: () => {
    set({ page: 'wizard' })
    void window.api.showView(null)
  },
  closeWizard: () => {
    set({ page: 'map' })
    void window.api.showView(null)
  },

  saveManualPanels: async (panels) => {
    await window.api.savePanels(panels)
  },

  setLayout: (layout) => {
    set({ layout })
    void window.api.saveLayout(layout)
  },
  openFolderDialog: (folderDialog) => set({ folderDialog, itemMenu: null }),
  closeFolderDialog: () => set({ folderDialog: null }),

  setUi: (patch) => {
    set((s) => ({ ui: { ...s.ui, ...patch } }))
    void window.api.setUi(patch)
  },
  // Durante el arrastre solo cambia el estado local; se persiste al soltar
  setSidebarWidthLive: (width) => set((s) => ({ ui: { ...s.ui, sidebarWidth: width } })),

  decideCert: (accept) => {
    const [current, ...rest] = get().certQueue
    if (!current) return
    set({ certQueue: rest })
    void window.api.decideCert(current.hostname, current.fingerprint, accept)
  },

  showToast: (kind, text) => {
    const toast: ToastMessage = { id: crypto.randomUUID(), kind, text }
    set({ toast })
    setTimeout(() => {
      if (get().toast?.id === toast.id) set({ toast: null })
    }, kind === 'error' ? 8000 : 5000)
  },
  dismissToast: () => set({ toast: null }),

  askConfirm: (confirm) => set({ confirm, menu: null, itemMenu: null }),
  closeConfirm: () => set({ confirm: null }),
  openMenu: (guest, x, y) => set({ menu: { guest, x, y } }),
  closeMenu: () => set({ menu: null }),
  openItemMenu: (kind, id, x, y) => set({ itemMenu: { kind, id, x, y }, menu: null }),
  closeItemMenu: () => set({ itemMenu: null }),
  requestEdit: (kind, id) => set({ editRequest: { kind, id } }),
  setSearch: (open) => set({ searchOpen: open }),
  toggleExpand: (key) => set((s) => ({ expanded: { ...s.expanded, [key]: !s.expanded[key] } })),

  setSshConnections: (sshConnections) => set({ sshConnections }),

  openSsh: async (connId, secret) => {
    try {
      const session = await window.api.openSsh(connId, 100, 30, secret)
      const early = earlySshState.get(session.id)
      earlySshState.delete(session.id)
      set((s) => ({
        sshSessions: [...s.sshSessions, early ? { ...session, state: early.state, message: early.message } : session],
        activeSshId: session.id,
        page: 'ssh',
        menu: null,
        searchOpen: false,
        sshSecretPrompt: null
      }))
      void window.api.showView(null)
    } catch (e) {
      if (errMsg(e).includes('NEEDS_SECRET')) {
        const conn = get().sshConnections.find((c) => c.id === connId)
        set({ sshSecretPrompt: { connId, name: conn?.name ?? '' }, menu: null, searchOpen: false })
      } else get().showToast('error', errMsg(e))
    }
  },

  selectSsh: (id) => {
    set({ activeSshId: id, page: 'ssh', menu: null, searchOpen: false })
    void window.api.showView(null)
  },

  closeSsh: (id) => {
    void window.api.closeSsh(id)
    const sessions = get().sshSessions.filter((s) => s.id !== id)
    const wasActive = get().activeSshId === id
    const next = wasActive ? (sessions[sessions.length - 1]?.id ?? null) : get().activeSshId
    set({ sshSessions: sessions, activeSshId: next })
    if (wasActive && !next && get().page === 'ssh') {
      set({ page: 'view' })
      void window.api.showView(get().activeId)
    }
  },

  reconnectSsh: async (session) => {
    get().closeSsh(session.id)
    await get().openSsh(session.connId)
  },

  answerSshHost: (accept) => {
    const [current, ...rest] = get().sshHostQueue
    if (!current) return
    set({ sshHostQueue: rest })
    void window.api.decideSshHost(current.sessionId, accept)
  },

  submitSshSecret: (secret) => {
    const prompt = get().sshSecretPrompt
    set({ sshSecretPrompt: null })
    if (prompt) void get().openSsh(prompt.connId, secret)
  },
  cancelSshSecret: () => set({ sshSecretPrompt: null }),

  openSshForGuest: async (guest) => {
    set({ menu: null })
    const ip = guest.ips[0]
    if (!ip) {
      get().showToast('error', t('noIp'))
      return
    }
    const conn = get().sshConnections.find((c) => c.host === ip)
    if (conn) return get().openSsh(conn.id)
    // Sin conexión guardada para esa IP: se abre el formulario con los datos del guest
    set({ sshDraft: { name: guest.name, host: ip, port: 22, username: 'root', auth: 'password' } })
    get().openSettings('ssh-form')
    get().showToast('info', t('sshNewFromGuest'))
  },

  runAction: (guest, action) => {
    set({ menu: null })
    void window.api
      .pveAction({ node: guest.node, type: guest.type, vmid: guest.vmid }, action)
      .catch((e) => get().showToast('error', errMsg(e)))
  },

  openConsole: async (guest) => {
    set({ menu: null })
    try {
      const id = await window.api.pveConsole({ node: guest.node, type: guest.type, vmid: guest.vmid }, guest.name)
      if (id) get().selectPanel(id)
      else get().showToast('error', t('statusUnconfigured'))
    } catch (e) {
      get().showToast('error', errMsg(e))
    }
  },

  openInPve: async (guest) => {
    set({ menu: null })
    try {
      const id = await window.api.pveOpenInPve({ node: guest.node, type: guest.type, vmid: guest.vmid })
      if (id) get().selectPanel(id)
    } catch (e) {
      get().showToast('error', errMsg(e))
    }
  },

  closeTab: (id) => {
    void window.api.closeTab(id)
  }
}))


function handleShortcut(sc: Shortcut): void {
  const s = useStore.getState()
  if (sc === 'search') s.setSearch(true)
  else if (sc === 'toggleSidebar') s.setUi({ sidebarCollapsed: !s.ui.sidebarCollapsed })
  else {
    const n = Number(sc.slice('panel:'.length))
    const panel = visiblePanels(s.panels, s.layout)[n - 1]
    if (panel) s.selectPanel(panel.id)
  }
}
