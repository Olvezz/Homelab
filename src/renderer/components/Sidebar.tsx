import { useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Guest, Panel, PanelStatus, PveStatus, SshConnection } from '../../shared/types'
import { flatOrder, moveItem, movePin, organize, togglePin, type LayoutSection, type Named, type SidebarFolder, type SortMode } from '../../shared/layout'
import { t, type Key } from '../i18n'
import { effectiveSidebarWidth, listedPanels, resolvePanel, useStore } from '../store'
import { fmtAgo } from '../homeFormat'
import { guestIconKey, Icon, PanelIcon } from './Icon'

const STATUS_KEY: Record<PveStatus, Key> = {
  unconfigured: 'statusUnconfigured',
  'needs-secret': 'statusNeedsSecret',
  connecting: 'statusConnecting',
  connected: 'statusConnected',
  offline: 'statusOffline',
  unauthorized: 'statusUnauthorized',
  'cert-changed': 'statusCertChanged',
  error: 'statusError'
}

export function statusLevel(status: PveStatus): 'ok' | 'warn' | 'bad' {
  if (status === 'connected') return 'ok'
  if (status === 'connecting' || status === 'unconfigured') return 'warn'
  return 'bad'
}

function guestDot(g: Guest): string {
  if (g.status === 'running') return 'dot running'
  if (g.status === 'stopped') return 'dot stopped'
  return 'dot unknown'
}

function pct(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value * 100)))
}

function GuestRow({ guest, collapsed }: { guest: Guest; collapsed: boolean }): React.JSX.Element {
  const activeId = useStore((s) => s.activeId)
  const page = useStore((s) => s.page)
  const expanded = useStore((s) => !!s.expanded[guest.key])
  const selectPanel = useStore((s) => s.selectPanel)
  const toggleExpand = useStore((s) => s.toggleExpand)
  const openMenu = useStore((s) => s.openMenu)
  const openInPve = useStore((s) => s.openInPve)
  const openConsole = useStore((s) => s.openConsole)

  const allPanels = useStore((s) => s.panels)
  const guestPanels = guest.panels.map((p) => resolvePanel(allPanels, p))
  const hasPanels = guestPanels.length > 0
  const childActive = page === 'view' && guestPanels.some((p) => p.id === activeId)
  const mem = guest.maxmem > 0 ? guest.mem / guest.maxmem : 0
  const tip = [
    `${guest.vmid} ${guest.name}${guest.template ? ` (${t('template')})` : ''}`,
    guest.ips[0],
    guest.osId || guest.osType ? `SO: ${guest.osId ?? guest.osType}` : undefined,
    guest.status === 'running' ? `CPU ${pct(guest.cpu)}% · RAM ${pct(mem)}%` : undefined
  ]
    .filter(Boolean)
    .join(' · ')

  const onClick = (): void => {
    if (guestPanels.length === 1) selectPanel(guestPanels[0].id)
    else if (guestPanels.length > 1) toggleExpand(guest.key)
    else void openInPve(guest)
  }

  return (
    <li>
      <div className={`guest${childActive && !expanded ? ' active' : ''}${guest.template ? ' template' : ''}`}>
        {!collapsed && (
          <button
            className="chev"
            aria-label={expanded ? 'Contraer' : 'Expandir'}
            aria-expanded={expanded}
            disabled={!hasPanels}
            onClick={() => toggleExpand(guest.key)}
          >
            {hasPanels && <Icon k={expanded ? 'ui:chevron-down' : 'ui:chevron-right'} size={14} />}
          </button>
        )}
        <button
          className="guest-main"
          title={tip}
          onClick={onClick}
          onContextMenu={(e) => {
            e.preventDefault()
            openMenu(guest, e.clientX, e.clientY)
          }}
        >
          <span className={guestDot(guest)} />
          {collapsed ? (
            <>
              <Icon k={guestIconKey(guest)} />
              <span className="guest-id">{guest.vmid}</span>
            </>
          ) : (
            <>
              <span
                className="guest-icon"
                data-icon={guestIconKey(guest)}
                title={guest.type === 'lxc' ? t('guestCt') : t('guestVm')}
              >
                <Icon k={guestIconKey(guest)} />
              </span>
              <span className="guest-name">
                <span className="vmid">{guest.vmid}</span> {guest.name}
              </span>
              {guest.busy && <Icon k="ui:loader" size={14} className="spin busy" />}
            </>
          )}
        </button>
        {!collapsed && guest.status === 'running' && !guest.template && (
          <button
            className="guest-act"
            title={t('actConsole')}
            aria-label={`${t('actConsole')} ${guest.vmid}`}
            onClick={() => void openConsole(guest)}
          >
            <Icon k="ui:terminal" size={15} />
          </button>
        )}
        {!collapsed && guest.status === 'running' && !guest.template && (
          <div className="bars" aria-hidden="true">
            <span style={{ width: `${pct(guest.cpu)}%` }} />
            <span className="mem" style={{ width: `${pct(mem)}%` }} />
          </div>
        )}
      </div>
      {expanded && !collapsed && (
        <ul className="children">
          {guestPanels.map((p) => (
            <li key={p.id}>
              <PanelButton panel={p} nested />
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

const STATE_CLASS = { off: 'off', loading: 'unknown', ready: 'running', error: 'bad' } as const

// Texto del tooltip: estado de la vista, último uso y sesión guardada
function panelTip(status: PanelStatus | undefined): string {
  const state = status?.state ?? 'off'
  const label = { off: t('panelOff'), loading: t('panelLoading'), ready: t('panelReady'), error: t('panelError') }[state]
  const used = status?.lastUsed && state !== 'off' ? ` · ${t('panelUsed', { ago: fmtAgo(status.lastUsed) })}` : ''
  return `${label}${used} · ${status?.hasSession ? t('panelSession') : t('panelNoSession')}`
}

// Punto de estado (verde en uso, ámbar cargando, rojo falló, hueco apagado) y candado si hay sesión guardada
function PanelState({ status, corner }: { status: PanelStatus | undefined; corner?: boolean }): React.JSX.Element {
  const state = status?.state ?? 'off'
  return (
    <span className={`panel-state${corner ? ' corner' : ''}`} aria-label={panelTip(status)}>
      <span className={`dot ${STATE_CLASS[state]}`} />
      {!corner && status?.hasSession && <Icon k="ui:lock" size={11} className="lock" />}
    </span>
  )
}

// ---- Orden, carpetas y fijados ----

// Destino de un soltado sobre una fila: 'pins' reordena los fijados; 'list' coloca dentro de una sección/carpeta
interface RowDnd {
  zone: 'pins' | 'list'
  section: LayoutSection
  id: string
  folderId: string | null
  nextId: string | null // el siguiente de la lista (para soltar en la mitad inferior)
}

// Lo que se está arrastrando (dataTransfer no permite leerse durante dragover)
let dragged: { id: string; section: LayoutSection } | null = null

function dropItem(target: { zone: 'pins' | 'list'; section: LayoutSection; folderId: string | null }, before: string | null): void {
  const d = dragged
  dragged = null
  if (!d) return
  const s = useStore.getState()
  if (target.zone === 'pins') {
    const base = s.layout.pins.includes(d.id) ? s.layout : togglePin(s.layout, d.id)
    s.setLayout(movePin(base, d.id, before))
    return
  }
  if (d.section !== target.section) return
  const items: Named[] = target.section === 'panels' ? listedPanels(s.panels) : s.sshConnections
  s.setLayout(moveItem(s.layout, items, target.section, d.id, target.folderId, before))
}

// Arrastrar y soltar en una fila: devuelve las props del contenedor y la clase del indicador de posición
function useRowDnd(dnd: RowDnd | undefined): { props: React.HTMLAttributes<HTMLDivElement>; cls: string } {
  const [edge, setEdge] = useState<'top' | 'bottom' | null>(null)
  if (!dnd) return { props: {}, cls: '' }
  const edgeOf = (e: React.DragEvent<HTMLDivElement>): 'top' | 'bottom' => {
    const r = e.currentTarget.getBoundingClientRect()
    return e.clientY < r.top + r.height / 2 ? 'top' : 'bottom'
  }
  const accepts = (): boolean => !!dragged && dragged.id !== dnd.id && (dnd.zone === 'pins' || dragged.section === dnd.section)
  return {
    cls: edge ? ` drop-${edge}` : '',
    props: {
      draggable: true,
      onDragStart: (e) => {
        dragged = { id: dnd.id, section: dnd.section }
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', dnd.id)
      },
      onDragEnd: () => {
        dragged = null
        setEdge(null)
      },
      onDragOver: (e) => {
        if (!accepts()) return
        e.preventDefault()
        e.stopPropagation()
        setEdge(edgeOf(e))
      },
      onDragLeave: () => setEdge(null),
      onDrop: (e) => {
        if (!accepts()) return
        e.preventDefault()
        e.stopPropagation()
        const before = edgeOf(e) === 'top' ? dnd.id : dnd.nextId
        setEdge(null)
        dropItem(dnd, before)
      }
    }
  }
}

const SORT_KEY: Record<SortMode, Key> = { az: 'sortAz', za: 'sortZa', custom: 'sortCustom' }
const SORT_ICON: Record<SortMode, string> = { az: 'ui:sort-az', za: 'ui:sort-za', custom: 'ui:sort-custom' }

// Botones de la cabecera de una sección: orden (A-Z → Z-A → a mano) y nueva carpeta
function SectionTools({ section, items }: { section: LayoutSection; items: Named[] }): React.JSX.Element {
  const layout = useStore((s) => s.layout)
  const setLayout = useStore((s) => s.setLayout)
  const openFolderDialog = useStore((s) => s.openFolderDialog)
  const mode = layout.sort[section]
  const next: SortMode = mode === 'az' ? 'za' : mode === 'za' ? 'custom' : 'az'
  const cycle = (): void => {
    // Al pasar a «a mano» se parte de lo que se está viendo
    const order =
      next === 'custom'
        ? [...layout.order.filter((id) => !items.some((x) => x.id === id)), ...flatOrder(items, layout, section)]
        : layout.order
    setLayout({ ...layout, order, sort: { ...layout.sort, [section]: next } })
  }
  const title = `${t('sortBy')}: ${t(SORT_KEY[mode])} (${t('sortNext', { mode: t(SORT_KEY[next]) })})`
  return (
    <>
      <button className="mini" title={title} aria-label={title} onClick={cycle}>
        <Icon k={SORT_ICON[mode]} size={13} />
      </button>
      <button className="mini" title={t('folderNew')} aria-label={t('folderNew')} onClick={() => openFolderDialog({ section })}>
        <Icon k="ui:folder-plus" size={13} />
      </button>
    </>
  )
}

function FolderHeader({ folder, count, section }: { folder: SidebarFolder; count: number; section: LayoutSection }): React.JSX.Element {
  const layout = useStore((s) => s.layout)
  const setLayout = useStore((s) => s.setLayout)
  const openItemMenu = useStore((s) => s.openItemMenu)
  const [over, setOver] = useState(false)
  const accepts = (): boolean => !!dragged && dragged.section === section
  return (
    <div
      className={`folder-head${over ? ' drop-into' : ''}`}
      style={{ '--folder-color': folder.color } as CSSProperties}
      onContextMenu={(e) => {
        e.preventDefault()
        openItemMenu('folder', folder.id, e.clientX, e.clientY)
      }}
      onDragOver={(e) => {
        if (!accepts()) return
        e.preventDefault()
        e.stopPropagation()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!accepts()) return
        e.preventDefault()
        e.stopPropagation()
        setOver(false)
        dropItem({ zone: 'list', section, folderId: folder.id }, null)
      }}
    >
      <button
        className="folder-toggle"
        aria-expanded={!folder.collapsed}
        onClick={() => setLayout({ ...layout, folders: layout.folders.map((f) => (f.id === folder.id ? { ...f, collapsed: !f.collapsed } : f)) })}
      >
        <Icon k={folder.collapsed ? 'ui:chevron-right' : 'ui:chevron-down'} size={14} />
        <Icon k="ui:folder" size={15} className="folder-ico" />
        <span className="folder-name">{folder.name}</span>
        <span className="folder-count">{count}</span>
      </button>
    </div>
  )
}

interface ItemExtra {
  dnd?: RowDnd
  folderColor?: string
}

// Una sección con su orden: carpetas (con su color) y, debajo, los elementos sueltos
function OrganizedList<T extends Named>({
  section,
  items,
  collapsed,
  render
}: {
  section: LayoutSection
  items: T[]
  collapsed: boolean
  render: (item: T, extra: ItemExtra) => React.ReactNode
}): React.JSX.Element {
  const layout = useStore((s) => s.layout)
  const o = organize(items, layout, section)
  const renderList = (list: T[], folderId: string | null, color?: string): React.ReactNode =>
    list.map((item, i) =>
      render(item, {
        folderColor: color,
        dnd: collapsed ? undefined : { zone: 'list', section, id: item.id, folderId, nextId: list[i + 1]?.id ?? null }
      })
    )
  return (
    <div
      className="panel-list"
      onDragOver={(e) => {
        if (dragged?.section === section) e.preventDefault()
      }}
      onDrop={(e) => {
        if (dragged?.section !== section) return
        e.preventDefault()
        dropItem({ zone: 'list', section, folderId: null }, null)
      }}
    >
      {o.groups.map((g) => (
        <div key={g.folder.id} className="folder">
          {!collapsed && <FolderHeader folder={g.folder} count={g.items.length} section={section} />}
          {(collapsed || !g.folder.collapsed) && renderList(g.items, g.folder.id, g.folder.color)}
        </div>
      ))}
      {renderList(o.loose, null)}
    </div>
  )
}

// Fijados: arriba de todo, por encima del nodo de Proxmox
function PinnedList({ collapsed }: { collapsed: boolean }): React.JSX.Element | null {
  const layout = useStore((s) => s.layout)
  const panels = useStore((s) => s.panels)
  const connections = useStore((s) => s.sshConnections)
  type Pinned = { id: string; panel?: Panel; conn?: SshConnection }
  const entries = layout.pins
    .map((id): Pinned | null => {
      const panel = listedPanels(panels).find((p) => p.id === id)
      if (panel) return { id, panel }
      const conn = connections.find((c) => c.id === id)
      return conn ? { id, conn } : null
    })
    .filter((x): x is Pinned => !!x)
  if (entries.length === 0) return null
  return (
    <>
      {!collapsed && (
        <div className="sidebar-section pinned-title">
          <Icon k="ui:pin" size={12} /> {t('pinned')}
        </div>
      )}
      <div
        className="panel-list"
        onDragOver={(e) => {
          if (dragged) e.preventDefault()
        }}
        onDrop={(e) => {
          if (!dragged) return
          e.preventDefault()
          dropItem({ zone: 'pins', section: dragged.section, folderId: null }, null)
        }}
      >
        {entries.map((x, i) => {
          const dnd: RowDnd | undefined = collapsed
            ? undefined
            : { zone: 'pins', section: x.panel ? 'panels' : 'ssh', id: x.id, folderId: null, nextId: entries[i + 1]?.id ?? null }
          return x.panel ? (
            <PanelButton key={x.id} panel={x.panel} collapsed={collapsed} dnd={dnd} />
          ) : (
            <SshRow key={x.id} conn={x.conn!} collapsed={collapsed} dnd={dnd} />
          )
        })}
      </div>
    </>
  )
}

function PanelButton({
  panel,
  nested,
  collapsed,
  dnd,
  folderColor
}: {
  panel: Panel
  nested?: boolean
  collapsed?: boolean
  dnd?: RowDnd
  folderColor?: string
}): React.JSX.Element {
  const { props: dndProps, cls: dndCls } = useRowDnd(dnd)
  const activeId = useStore((s) => s.activeId)
  const page = useStore((s) => s.page)
  const selectPanel = useStore((s) => s.selectPanel)
  const closeTab = useStore((s) => s.closeTab)
  const openItemMenu = useStore((s) => s.openItemMenu)
  const status = useStore((s) => s.panelStatus[panel.id])
  const guest = useStore((s) => (panel.vmid ? s.snapshot.guests.find((g) => g.vmid === panel.vmid) : undefined))
  const active = page === 'view' && panel.id === activeId
  return (
    <div
      className={`panel-row${active ? ' active' : ''}${nested ? ' nested' : ''}${folderColor ? ' foldered' : ''}${dndCls}`}
      style={folderColor ? ({ '--folder-color': folderColor } as CSSProperties) : undefined}
      {...dndProps}
      onContextMenu={(e) => {
        e.preventDefault()
        openItemMenu('panel', panel.id, e.clientX, e.clientY)
      }}
    >
      <button className="panel-item" onClick={() => selectPanel(panel.id)} title={`${panel.name} — ${panel.url}\n${panelTip(status)}`}>
        <span className="panel-icon">
          <PanelIcon panel={panel} guest={guest} />
          {collapsed && <PanelState status={status} corner />}
        </span>
        {!collapsed && <span className="panel-name">{panel.name}</span>}
        {!collapsed && <PanelState status={status} />}
      </button>
      {panel.kind === 'tab' && !collapsed && (
        <button className="tab-close" title={t('closeTab')} aria-label={t('closeTab')} onClick={() => closeTab(panel.id)}>
          <Icon k="ui:x" size={14} />
        </button>
      )}
    </div>
  )
}

function SshRow({ conn: c, collapsed, dnd, folderColor }: { conn: SshConnection; collapsed: boolean; dnd?: RowDnd; folderColor?: string }): React.JSX.Element {
  const openSsh = useStore((s) => s.openSsh)
  const openItemMenu = useStore((s) => s.openItemMenu)
  const { props: dndProps, cls: dndCls } = useRowDnd(dnd)
  return (
    <div
      className={`panel-row${folderColor ? ' foldered' : ''}${dndCls}`}
      style={folderColor ? ({ '--folder-color': folderColor } as CSSProperties) : undefined}
      {...dndProps}
      onContextMenu={(e) => {
        e.preventDefault()
        openItemMenu('ssh', c.id, e.clientX, e.clientY)
      }}
    >
      <button className="panel-item" title={`${c.username}@${c.host}:${c.port}`} onClick={() => void openSsh(c.id)}>
        <span className="panel-icon">
          <Icon k="ui:terminal" />
        </span>
        {!collapsed && <span className="panel-name">{c.name}</span>}
      </button>
    </div>
  )
}

function SshSection({ collapsed }: { collapsed: boolean }): React.JSX.Element | null {
  const connections = useStore((s) => s.sshConnections)
  const sessions = useStore((s) => s.sshSessions)
  const activeSshId = useStore((s) => s.activeSshId)
  const page = useStore((s) => s.page)
  const selectSsh = useStore((s) => s.selectSsh)
  const closeSsh = useStore((s) => s.closeSsh)
  const openSettings = useStore((s) => s.openSettings)
  const openItemMenu = useStore((s) => s.openItemMenu)

  if (collapsed && connections.length === 0 && sessions.length === 0) return null
  const dot = (state: string): string =>
    state === 'open' ? 'running' : state === 'connecting' ? 'unknown' : state === 'error' ? 'bad' : 'stopped'

  return (
    <>
      {!collapsed && (
        <div className="sidebar-section with-action">
          <span>{t('sshSection')}</span>
          <span className="section-actions">
            <SectionTools section="ssh" items={connections} />
            <button className="mini" title={t('sshNew')} aria-label={t('sshNew')} onClick={() => openSettings('ssh-form')}>
              <Icon k="ui:plus" size={13} />
            </button>
          </span>
        </div>
      )}
      {connections.length === 0 && !collapsed && (
        <div className="panel-list">
          <div className="empty">{t('sshNone')}</div>
        </div>
      )}
      <OrganizedList
        section="ssh"
        items={connections}
        collapsed={collapsed}
        render={(c, extra) => <SshRow key={c.id} conn={c} collapsed={collapsed} {...extra} />}
      />
      {sessions.length > 0 && (
        <>
          {!collapsed && <div className="sidebar-section">{t('sshSessions')}</div>}
          <div className="panel-list">
            {sessions.map((s) => (
              <div
                className={`panel-row${page === 'ssh' && s.id === activeSshId ? ' active' : ''}`}
                key={s.id}
                onContextMenu={(e) => {
                  e.preventDefault()
                  openItemMenu('session', s.id, e.clientX, e.clientY)
                }}
              >
                <button className="panel-item" title={s.message ?? s.name} onClick={() => selectSsh(s.id)}>
                  <span className="panel-icon">
                    <span className={`dot ${dot(s.state)}`} />
                  </span>
                  {!collapsed && <span className="panel-name">{s.name}</span>}
                </button>
                {!collapsed && (
                  <button className="tab-close" title={t('sshClose')} aria-label={t('sshClose')} onClick={() => closeSsh(s.id)}>
                    <Icon k="ui:x" size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </>
  )
}

function MapEntry({ collapsed }: { collapsed: boolean }): React.JSX.Element {
  const page = useStore((s) => s.page)
  const openMap = useStore((s) => s.openMap)
  return (
    <div className="panel-list">
      <div className={`panel-row${page === 'map' ? ' active' : ''}`}>
        <button className="panel-item" title={t('mapTitle')} onClick={openMap}>
          <span className="panel-icon">
            <Icon k="ui:network" />
          </span>
          {!collapsed && <span className="panel-name">{t('mapTitle')}</span>}
        </button>
      </div>
    </div>
  )
}

function Tree({ collapsed }: { collapsed: boolean }): React.JSX.Element | null {
  const snapshot = useStore((s) => s.snapshot)
  const showTemplates = useStore((s) => s.ui.showTemplates)
  const openWizard = useStore((s) => s.openWizard)

  if (snapshot.status === 'unconfigured') {
    if (collapsed) return null
    return (
      <div className="cta">
        <p>{t('connectCtaHint')}</p>
        <button className="btn primary small" onClick={openWizard}>
          {t('connectCta')}
        </button>
      </div>
    )
  }

  const guests = snapshot.guests.filter((g) => showTemplates || !g.template)
  const nodeNames = [...new Set([...snapshot.nodes.map((n) => n.name), ...guests.map((g) => g.node)])]
  const stale = snapshot.status === 'offline'

  return (
    <div className={stale ? 'tree stale' : 'tree'}>
      {nodeNames.map((name) => {
        const node = snapshot.nodes.find((n) => n.name === name)
        const list = guests.filter((g) => g.node === name)
        return (
          <div key={name}>
            {!collapsed && (
              <div className="node-head">
                <span className={`dot ${node?.online === false ? 'stopped' : 'running'}`} />
                <Icon k="ui:server" size={14} />
                {t('nodeLabel', { name })}
              </div>
            )}
            <ul className="guest-list">
              {list.map((g) => (
                <GuestRow key={g.key} guest={g} collapsed={collapsed} />
              ))}
              {list.length === 0 && !collapsed && snapshot.status === 'connected' && (
                <li className="empty">{t('noGuests')}</li>
              )}
            </ul>
          </div>
        )
      })}
    </div>
  )
}

export function Sidebar(): React.JSX.Element {
  const panels = useStore((s) => s.panels)
  const ui = useStore((s) => s.ui)
  const page = useStore((s) => s.page)
  const status = useStore((s) => s.snapshot.status)
  const message = useStore((s) => s.snapshot.message)
  const openSettings = useStore((s) => s.openSettings)
  const closeSettings = useStore((s) => s.closeSettings)
  const openWizard = useStore((s) => s.openWizard)
  const openNotes = useStore((s) => s.openNotes)
  const update = useStore((s) => s.update)
  const setUi = useStore((s) => s.setUi)
  const setSearch = useStore((s) => s.setSearch)
  const setWidthLive = useStore((s) => s.setSidebarWidthLive)
  const drag = useRef<{ startX: number; startWidth: number } | null>(null)

  const collapsed = ui.sidebarCollapsed
  const listed = listedPanels(panels)
  const tabs = panels.filter((p) => p.kind === 'tab')
  const level = statusLevel(status)
  const statusText = message ?? t(STATUS_KEY[status])
  const needsAction = status === 'unauthorized' || status === 'cert-changed' || status === 'needs-secret'

  // Redimensionar: mientras se arrastra se ocultan las vistas nativas para seguir recibiendo el ratón
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { startX: e.clientX, startWidth: ui.sidebarWidth }
    void window.api.setOverlay(true)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!drag.current) return
    const width = drag.current.startWidth + e.clientX - drag.current.startX
    setWidthLive(Math.max(160, Math.min(480, Math.round(width))))
  }
  const onPointerUp = (): void => {
    if (!drag.current) return
    drag.current = null
    setUi({ sidebarWidth: useStore.getState().ui.sidebarWidth })
    void window.api.setOverlay(false)
  }

  return (
    <nav className={`sidebar${collapsed ? ' collapsed' : ''}`} style={{ width: effectiveSidebarWidth(ui) }}>
      <div className="sidebar-title">
        <button
          className="tool"
          title={collapsed ? t('expandSidebar') : t('collapseSidebar')}
          aria-label={collapsed ? t('expandSidebar') : t('collapseSidebar')}
          onClick={() => setUi({ sidebarCollapsed: !collapsed })}
        >
          <Icon k="ui:menu" />
        </button>
        {!collapsed && <span className="brand">{t('appName')}</span>}
        {!collapsed && (
          <button className="tool push" title={t('search')} aria-label={t('search')} onClick={() => setSearch(true)}>
            <Icon k="ui:search" />
          </button>
        )}
      </div>

      <div className="sidebar-scroll">
        <MapEntry collapsed={collapsed} />
        <PinnedList collapsed={collapsed} />

        {!collapsed && <div className="sidebar-section">{t('proxmox')}</div>}
        <Tree collapsed={collapsed} />

        {!collapsed && (
          <div className="sidebar-section with-action">
            <span>{t('panels')}</span>
            <span className="section-actions">
              <SectionTools section="panels" items={listed} />
              <button className="mini" title={t('addPanel')} aria-label={t('addPanel')} onClick={() => openSettings('panels-form')}>
                <Icon k="ui:plus" size={13} />
              </button>
            </span>
          </div>
        )}
        {listed.length === 0 && !collapsed && (
          <div className="panel-list">
            <div className="empty">{t('noPanels')}</div>
          </div>
        )}
        <OrganizedList
          section="panels"
          items={listed}
          collapsed={collapsed}
          render={(p, extra) => <PanelButton key={p.id} panel={p} collapsed={collapsed} {...extra} />}
        />

        <SshSection collapsed={collapsed} />

        {tabs.length > 0 && (
          <>
            {!collapsed && <div className="sidebar-section">{t('consoles')}</div>}
            <div className="panel-list">
              {tabs.map((p) => (
                <PanelButton key={p.id} panel={p} collapsed={collapsed} />
              ))}
            </div>
          </>
        )}
      </div>

      <div className="sidebar-footer">
        {update.state === 'ready' && (
          <button
            className="update-banner"
            title={t('updateInstall')}
            onClick={() => void window.api.installUpdate()}
          >
            <Icon k="ui:download" size={15} />
            {!collapsed && <span>{t('updateBanner', { version: update.version ?? '' })} · {t('updateInstall')}</span>}
          </button>
        )}
        <button
          className={`status ${level}`}
          title={needsAction ? t('statusHint') : statusText}
          onClick={status === 'unconfigured' || needsAction ? openWizard : () => openSettings()}
        >
          <span className={`dot ${level === 'ok' ? 'running' : level === 'warn' ? 'unknown' : 'bad'}`} />
          {!collapsed && <span className="status-text">{statusText}</span>}
        </button>
        <button className={`panel-item${page === 'notes' ? ' active' : ''}`} onClick={openNotes} title={t('notes')}>
          <span className="panel-icon">
            <Icon k="ui:notes" />
          </span>
          {!collapsed && <span className="panel-name">{t('notes')}</span>}
        </button>
        <button
          className={`panel-item${page === 'settings' ? ' active' : ''}`}
          onClick={page === 'settings' ? closeSettings : () => openSettings()}
          title={t('settings')}
        >
          <span className="panel-icon">
            <Icon k="ui:settings" />
          </span>
          {!collapsed && <span className="panel-name">{t('settings')}</span>}
        </button>
      </div>

      {!collapsed && (
        <div
          className="resize-handle"
          role="separator"
          aria-orientation="vertical"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
      )}
    </nav>
  )
}
