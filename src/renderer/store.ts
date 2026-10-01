import { create } from 'zustand'
import {
  COLLAPSED_SIDEBAR_WIDTH,
  type CertPromptInfo,
  type Guest,
  type Panel,
  type PowerAction,
  type PveConfigView,
  type PveSnapshot,
  type Shortcut,
  type ToastMessage,
  type UiConfig,
  type UpdateStatus,
  type ViewState
} from '../shared/types'
import { errMsg, t } from './i18n'

export type Page = 'view' | 'settings' | 'wizard'

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
  update: UpdateStatus
  activeId: string | null
  page: Page
  viewState: ViewState | null
  certQueue: CertPromptInfo[]
  toast: ToastMessage | null
  confirm: ConfirmState | null
  menu: { guest: Guest; x: number; y: number } | null
  searchOpen: boolean
  expanded: Record<string, boolean>

  init: () => Promise<void>
  selectPanel: (id: string) => void
  openSettings: () => void
  closeSettings: () => void
  openWizard: () => void
  closeWizard: () => void
  saveManualPanels: (panels: Panel[]) => Promise<void>
  setUi: (patch: Partial<UiConfig>) => void
  setSidebarWidthLive: (width: number) => void
  decideCert: (accept: boolean) => void
  showToast: (kind: ToastMessage['kind'], text: string) => void
  dismissToast: () => void
  askConfirm: (c: ConfirmState) => void
  closeConfirm: () => void
  openMenu: (guest: Guest, x: number, y: number) => void
  closeMenu: () => void
  setSearch: (open: boolean) => void
  toggleExpand: (key: string) => void
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
  update: { state: 'idle' },
  activeId: null,
  page: 'view',
  viewState: null,
  certQueue: [],
  toast: null,
  confirm: null,
  menu: null,
  searchOpen: false,
  expanded: {},

  init: async () => {
    const { panels, ui, pve, snapshot, themeCookie } = await window.api.getConfig()
    wantedId = ui.lastActiveId
    const activeId = panels.find((p) => p.id === ui.lastActiveId)?.id ?? listedPanels(panels)[0]?.id ?? null
    // Sin conexión configurada se abre el asistente (se puede omitir)
    const page: Page = snapshot.status === 'unconfigured' && !pve ? 'wizard' : 'view'
    set({ ready: true, panels, ui, pve, snapshot, themeCookie, activeId, page })

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
      window.api.onUpdate((update) => {
        set({ update })
        if (update.state === 'ready') get().showToast('ok', t('updateReadyToast', { version: update.version ?? '' }))
      })
      void window.api.getUpdate().then((update) => set({ update }))
      window.api.onToast((toast) => get().showToast(toast.kind, toast.text))
      window.api.onShortcut((sc) => handleShortcut(sc))
    }

    await window.api.showView(page === 'view' ? activeId : null)
  },

  selectPanel: (id) => {
    userPicked = true
    set({ activeId: id, page: 'view', viewState: null, menu: null, searchOpen: false })
    if (!get().panels.find((p) => p.id === id)?.kind) void window.api.setUi({ lastActiveId: id })
    void window.api.showView(id)
  },

  openSettings: () => {
    set({ page: 'settings' })
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
    set({ page: 'view' })
    void window.api.showView(get().activeId)
  },

  saveManualPanels: async (panels) => {
    await window.api.savePanels(panels)
  },

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

  askConfirm: (confirm) => set({ confirm, menu: null }),
  closeConfirm: () => set({ confirm: null }),
  openMenu: (guest, x, y) => set({ menu: { guest, x, y } }),
  closeMenu: () => set({ menu: null }),
  setSearch: (open) => set({ searchOpen: open }),
  toggleExpand: (key) => set((s) => ({ expanded: { ...s.expanded, [key]: !s.expanded[key] } })),

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
    const panel = listedPanels(s.panels)[n - 1]
    if (panel) s.selectPanel(panel.id)
  }
}
