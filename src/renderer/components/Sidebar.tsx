import { useRef } from 'react'
import type { Guest, Panel, PveStatus } from '../../shared/types'
import { t, type Key } from '../i18n'
import { effectiveSidebarWidth, listedPanels, resolvePanel, useStore } from '../store'
import { guestIconKey, Icon, panelIconKey } from './Icon'

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

function PanelButton({
  panel,
  nested,
  collapsed
}: {
  panel: Panel
  nested?: boolean
  collapsed?: boolean
}): React.JSX.Element {
  const activeId = useStore((s) => s.activeId)
  const page = useStore((s) => s.page)
  const selectPanel = useStore((s) => s.selectPanel)
  const closeTab = useStore((s) => s.closeTab)
  const guest = useStore((s) => (panel.vmid ? s.snapshot.guests.find((g) => g.vmid === panel.vmid) : undefined))
  const active = page === 'view' && panel.id === activeId
  return (
    <div className={`panel-row${active ? ' active' : ''}${nested ? ' nested' : ''}`}>
      <button className="panel-item" onClick={() => selectPanel(panel.id)} title={`${panel.name} — ${panel.url}`}>
        <span className="panel-icon">
          <Icon k={panelIconKey(panel, guest)} />
        </span>
        {!collapsed && <span className="panel-name">{panel.name}</span>}
      </button>
      {panel.kind === 'tab' && !collapsed && (
        <button className="tab-close" title={t('closeTab')} aria-label={t('closeTab')} onClick={() => closeTab(panel.id)}>
          <Icon k="ui:x" size={14} />
        </button>
      )}
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
        {!collapsed && <div className="sidebar-section">{t('proxmox')}</div>}
        <Tree collapsed={collapsed} />

        {!collapsed && <div className="sidebar-section">{t('panels')}</div>}
        <div className="panel-list">
          {listed.length === 0 && !collapsed && <div className="empty">{t('noPanels')}</div>}
          {listed.map((p) => (
            <PanelButton key={p.id} panel={p} collapsed={collapsed} />
          ))}
        </div>

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
          onClick={status === 'unconfigured' || needsAction ? openWizard : openSettings}
        >
          <span className={`dot ${level === 'ok' ? 'running' : level === 'warn' ? 'unknown' : 'bad'}`} />
          {!collapsed && <span className="status-text">{statusText}</span>}
        </button>
        <button
          className={`panel-item${page === 'settings' ? ' active' : ''}`}
          onClick={page === 'settings' ? closeSettings : openSettings}
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
