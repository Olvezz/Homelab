import type { GuestRef, Panel } from '../shared/types'
import type { ConfigStore } from './config/store'
import type { PveService } from './pve/service'
import type { ViewManager } from './viewManager'

const PVE_TAB_ID = 'tab-pve'

export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw)
    return `${u.origin}${u.pathname.replace(/\/$/, '')}${u.search}${u.hash}`
  } catch {
    return raw
  }
}

// Une los paneles manuales (config), los descubiertos (Proxmox) y las pestañas efímeras
// (consolas) en una sola lista y la sincroniza con las vistas y con la UI.
export class PanelHub {
  private tabs: Panel[] = []
  private lastSignature = ''

  constructor(
    private store: ConfigStore,
    private service: PveService,
    private views: ViewManager,
    private emit: (panels: Panel[]) => void
  ) {}

  all(): Panel[] {
    const out: Panel[] = []
    const seen = new Set<string>()
    // Un panel descubierto con la misma URL que uno manual no se duplica: se usa el manual (misma sesión)
    const manual = this.store.get().panels
    const manualUrls = new Set(manual.map((p) => normalizeUrl(p.url)))
    const discovered = this.service.discoveredPanels().filter((p) => !manualUrls.has(normalizeUrl(p.url)))
    for (const p of [...manual, ...discovered, ...this.tabs]) {
      if (seen.has(p.id)) continue
      seen.add(p.id)
      out.push(p)
    }
    return out
  }

  // Los snapshots llegan cada pocos segundos: solo se propaga si la lista de paneles cambió
  sync(): void {
    const all = this.all()
    const signature = JSON.stringify(all)
    if (signature === this.lastSignature) return
    this.lastSignature = signature
    this.views.setPanels(all)
    this.emit(all)
  }

  closeTab(id: string): void {
    this.tabs = this.tabs.filter((t) => t.id !== id)
    this.sync()
  }

  // Panel que muestra la web de Proxmox: uno manual con ese origen o, si no hay, una pestaña propia
  private pveWebPanel(): Panel | null {
    const cfg = this.service.getConfigView()
    if (!cfg) return null
    const origin = `https://${cfg.host}:${cfg.port}`
    const manual = this.store.get().panels.find((p) => {
      try {
        return new URL(p.url).origin === origin
      } catch {
        return false
      }
    })
    if (manual) return manual
    let tab = this.tabs.find((t) => t.id === PVE_TAB_ID)
    if (!tab) {
      tab = { id: PVE_TAB_ID, name: 'Proxmox', url: `${origin}/`, icon: 'proxmox', source: 'manual', kind: 'tab' }
      this.tabs.push(tab)
      this.sync()
    }
    return tab
  }

  // Abre el guest dentro de la web de Proxmox (formato `#v1:0:=qemu%2F102:4:::::::`)
  openInPve(ref: GuestRef): string | null {
    const panel = this.pveWebPanel()
    const cfg = this.service.getConfigView()
    if (!panel || !cfg) return null
    this.views.navigate(panel.id, `https://${cfg.host}:${cfg.port}/#v1:0:=${ref.type}%2F${ref.vmid}:4:::::::`)
    return panel.id
  }

  // Shell del propio nodo Proxmox (requiere sesión web de root@pam)
  openShell(node: string): string | null {
    const panel = this.pveWebPanel()
    const cfg = this.service.getConfigView()
    if (!panel || !cfg) return null
    const u = new URL(`https://${cfg.host}:${cfg.port}/`)
    u.searchParams.set('console', 'shell')
    u.searchParams.set('xtermjs', '1')
    u.searchParams.set('node', node)
    const id = `tab-shell-${node.replace(/[^A-Za-z0-9-]/g, '')}`
    const tab: Panel = {
      id,
      name: `Shell ${node}`.slice(0, 60),
      url: u.toString(),
      icon: 'ui:terminal',
      source: 'manual',
      kind: 'tab',
      sessionId: panel.sessionId ?? panel.id
    }
    this.tabs = [...this.tabs.filter((t) => t.id !== id), tab]
    this.sync()
    return id
  }

  // Consola xterm.js (LXC) o noVNC (VM) en una pestaña que comparte la sesión web de Proxmox
  openConsole(ref: GuestRef, name: string): string | null {
    const panel = this.pveWebPanel()
    const cfg = this.service.getConfigView()
    if (!panel || !cfg) return null

    const u = new URL(`https://${cfg.host}:${cfg.port}/`)
    if (ref.type === 'lxc') {
      u.searchParams.set('console', 'lxc')
      u.searchParams.set('xtermjs', '1')
    } else {
      u.searchParams.set('console', 'kvm')
      u.searchParams.set('novnc', '1')
    }
    u.searchParams.set('vmid', String(ref.vmid))
    u.searchParams.set('vmname', name)
    u.searchParams.set('node', ref.node)
    if (ref.type === 'lxc') u.searchParams.set('cmd', '')
    else u.searchParams.set('resize', 'off')

    const id = `tab-console-${ref.type}-${ref.vmid}`
    const tab: Panel = {
      id,
      name: `Consola ${ref.vmid} ${name}`.slice(0, 60),
      url: u.toString(),
      icon: 'ui:terminal',
      source: 'manual',
      kind: 'tab',
      sessionId: panel.sessionId ?? panel.id
    }
    this.tabs = [...this.tabs.filter((t) => t.id !== id), tab]
    this.sync()
    return id
  }
}
