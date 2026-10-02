import { useEffect, useMemo, useRef, useState } from 'react'
import { t } from '../i18n'
import { listedPanels, useStore } from '../store'
import { guestIconKey, Icon, panelIconKey } from './Icon'

// ---- Menú contextual de un invitado ----

export function GuestMenu(): React.JSX.Element | null {
  const menu = useStore((s) => s.menu)
  const canPower = useStore((s) => s.snapshot.canPower)
  const closeMenu = useStore((s) => s.closeMenu)
  const askConfirm = useStore((s) => s.askConfirm)
  const runAction = useStore((s) => s.runAction)
  const openConsole = useStore((s) => s.openConsole)
  const openInPve = useStore((s) => s.openInPve)
  const openSshForGuest = useStore((s) => s.openSshForGuest)
  const showToast = useStore((s) => s.showToast)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menu) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeMenu()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', closeMenu)
    ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', closeMenu)
    }
  }, [menu, closeMenu])

  if (!menu) return null
  const { guest } = menu
  const running = guest.status === 'running'
  const powerOk = canPower && !guest.template && !guest.busy
  const label = `${guest.vmid} ${guest.name}`

  const confirmed = (action: 'shutdown' | 'reboot' | 'stop', actionKey: 'actShutdown' | 'actReboot' | 'actStop', bodyKey: 'confirmShutdown' | 'confirmReboot' | 'confirmStop'): void =>
    askConfirm({
      title: t('confirmTitle', { action: t(actionKey), guest: label }),
      body: t(bodyKey),
      confirmLabel: t(actionKey),
      danger: action !== 'reboot',
      onConfirm: () => runAction(guest, action)
    })

  const permTip = canPower ? undefined : t('noPowerPermission')
  const left = Math.min(menu.x, window.innerWidth - 216)
  const top = Math.min(menu.y, window.innerHeight - 300)

  return (
    <div className="menu-backdrop" onMouseDown={closeMenu} onContextMenu={(e) => { e.preventDefault(); closeMenu() }}>
      <div
        ref={ref}
        className="menu"
        role="menu"
        style={{ left, top }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="menu-title">{label}</div>
        <button role="menuitem" disabled={!powerOk || running} title={permTip} onClick={() => runAction(guest, 'start')}>
          {t('actStart')}
        </button>
        <button role="menuitem" disabled={!powerOk || !running} title={permTip} onClick={() => confirmed('shutdown', 'actShutdown', 'confirmShutdown')}>
          {t('actShutdown')}
        </button>
        <button role="menuitem" disabled={!powerOk || !running} title={permTip} onClick={() => confirmed('reboot', 'actReboot', 'confirmReboot')}>
          {t('actReboot')}
        </button>
        <button role="menuitem" className="danger" disabled={!powerOk || !running} title={permTip} onClick={() => confirmed('stop', 'actStop', 'confirmStop')}>
          {t('actStop')}
        </button>
        <hr />
        <button role="menuitem" disabled={!running || guest.template} onClick={() => void openConsole(guest)}>
          {t('actConsole')}
        </button>
        <button role="menuitem" disabled={!running || guest.template} onClick={() => void openSshForGuest(guest)}>
          {t('actSsh')}
        </button>
        <button role="menuitem" onClick={() => void openInPve(guest)}>
          {t('actOpenInPve')}
        </button>
        <button
          role="menuitem"
          onClick={() => {
            closeMenu()
            if (guest.ips[0]) {
              void window.api.copyText(guest.ips[0])
              showToast('ok', t('copied', { ip: guest.ips[0] }))
            } else showToast('error', t('noIp'))
          }}
        >
          {t('actCopyIp')}
        </button>
        <button
          role="menuitem"
          onClick={() => {
            closeMenu()
            void window.api.pveRefresh()
          }}
        >
          {t('actRefresh')}
        </button>
      </div>
    </div>
  )
}

// ---- Confirmación ----

export function ConfirmDialog(): React.JSX.Element | null {
  const confirm = useStore((s) => s.confirm)
  const close = useStore((s) => s.closeConfirm)

  useEffect(() => {
    if (!confirm) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [confirm, close])

  if (!confirm) return null
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className={`modal${confirm.danger ? ' danger' : ''}`}>
        <h2>{confirm.title}</h2>
        <p>{confirm.body}</p>
        <div className="modal-actions">
          <button className="btn" autoFocus onClick={close}>
            {t('cancel')}
          </button>
          <button
            className={`btn ${confirm.danger ? 'danger-fill' : 'primary'}`}
            onClick={() => {
              close()
              confirm.onConfirm()
            }}
          >
            {confirm.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---- Búsqueda rápida (Ctrl+K) ----

interface Hit {
  id: string
  icon: string
  label: string
  detail: string
  kind: 'panel' | 'guest'
  run: () => void
}

export function SearchPalette(): React.JSX.Element | null {
  const open = useStore((s) => s.searchOpen)
  const setSearch = useStore((s) => s.setSearch)
  const panels = useStore((s) => s.panels)
  const guests = useStore((s) => s.snapshot.guests)
  const showTemplates = useStore((s) => s.ui.showTemplates)
  const selectPanel = useStore((s) => s.selectPanel)
  const openInPve = useStore((s) => s.openInPve)
  const sshConnections = useStore((s) => s.sshConnections)
  const openSsh = useStore((s) => s.openSsh)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)

  useEffect(() => {
    if (open) {
      setQuery('')
      setIndex(0)
    }
  }, [open])

  const hits = useMemo<Hit[]>(() => {
    const q = query.trim().toLowerCase()
    const all: Hit[] = [
      ...listedPanels(panels).map((p) => ({
        id: `p-${p.id}`,
        icon: panelIconKey(p, p.vmid ? guests.find((g) => g.vmid === p.vmid) : undefined),
        label: p.name,
        detail: `${t('searchPanel')} · ${p.url}`,
        kind: 'panel' as const,
        haystack: `${p.name} ${p.url}`,
        run: () => selectPanel(p.id)
      })),
      ...guests
        .filter((g) => showTemplates || !g.template)
        .map((g) => ({
          id: `g-${g.key}`,
          icon: guestIconKey(g),
          label: `${g.vmid} ${g.name}`,
          detail: `${t('searchGuest')} · ${g.ips[0] ?? '—'}`,
          kind: 'guest' as const,
          haystack: `${g.vmid} ${g.name} ${g.ips.join(' ')} ${g.tags.join(' ')} ${g.panels.map((p) => p.name).join(' ')}`,
          run: () => (g.panels[0] ? selectPanel(g.panels[0].id) : void openInPve(g))
        })),
      ...sshConnections.map((c) => ({
        id: `s-${c.id}`,
        icon: 'ui:terminal',
        label: c.name,
        detail: `SSH · ${c.username}@${c.host}:${c.port}`,
        kind: 'guest' as const,
        haystack: `ssh ${c.name} ${c.host} ${c.username}`,
        run: () => void openSsh(c.id)
      }))
    ]
    return all
      .filter((h) => !q || (h as Hit & { haystack: string }).haystack.toLowerCase().includes(q))
      .slice(0, 30)
  }, [query, panels, guests, showTemplates, selectPanel, openInPve, sshConnections, openSsh])

  if (!open) return null

  const choose = (h: Hit | undefined): void => {
    if (!h) return
    setSearch(false)
    h.run()
  }

  return (
    <div className="modal-backdrop top" role="dialog" aria-modal="true" onMouseDown={() => setSearch(false)}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          autoFocus
          value={query}
          placeholder={t('searchPlaceholder')}
          onChange={(e) => {
            setQuery(e.target.value)
            setIndex(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setSearch(false)
            else if (e.key === 'ArrowDown') {
              e.preventDefault()
              setIndex((i) => Math.min(hits.length - 1, i + 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setIndex((i) => Math.max(0, i - 1))
            } else if (e.key === 'Enter') choose(hits[index])
          }}
        />
        <ul>
          {hits.length === 0 && <li className="empty">{t('searchNone')}</li>}
          {hits.map((h, i) => (
            <li key={h.id}>
              <button className={i === index ? 'sel' : ''} onMouseEnter={() => setIndex(i)} onClick={() => choose(h)}>
                <span className="hit-label">
                  <Icon k={h.icon} />
                  {h.label}
                </span>
                <span className="detail">{h.detail}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

// ---- Menú contextual de paneles, conexiones y sesiones SSH (clic derecho en la barra lateral) ----

interface MenuEntry {
  label: string
  run: () => void
  danger?: boolean
  disabled?: boolean
  separator?: boolean // línea separadora encima
}

export function ItemMenu(): React.JSX.Element | null {
  const menu = useStore((s) => s.itemMenu)
  const panels = useStore((s) => s.panels)
  const panelStatus = useStore((s) => s.panelStatus)
  const guests = useStore((s) => s.snapshot.guests)
  const connections = useStore((s) => s.sshConnections)
  const sessions = useStore((s) => s.sshSessions)
  const closeItemMenu = useStore((s) => s.closeItemMenu)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menu) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeItemMenu()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', closeItemMenu)
    ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', closeItemMenu)
    }
  }, [menu, closeItemMenu])

  if (!menu) return null
  const s = useStore.getState()
  const entries: MenuEntry[] = []
  let title = ''

  if (menu.kind === 'panel') {
    const p = panels.find((x) => x.id === menu.id)
    if (!p) return null
    title = p.name
    const manual = p.source === 'manual' && p.kind !== 'tab'
    entries.push(
      { label: t('menuOpen'), run: () => s.selectPanel(p.id) },
      {
        label: t('menuReload'),
        run: () => {
          s.selectPanel(p.id)
          void window.api.nav('reload')
        }
      },
      { label: t('menuOpenBrowser'), run: () => void window.api.openPanelUrl(p.url) },
      { label: t('copyUrl'), run: () => void window.api.copyText(p.url).then(() => s.showToast('ok', t('menuCopied'))) }
    )
    if (manual) {
      entries.push(
        {
          label: t('menuEdit'),
          separator: true,
          run: () => {
            s.requestEdit('panel', p.id)
            s.openSettings('panels-form')
          }
        },
        {
          label: t('menuRemove'),
          danger: true,
          run: () =>
            s.askConfirm({
              title: t('menuRemoveTitle', { name: p.name }),
              body: t('confirmRemove'),
              confirmLabel: t('remove'),
              danger: true,
              onConfirm: () =>
                void s.saveManualPanels(panels.filter((x) => x.source === 'manual' && x.kind !== 'tab' && x.id !== p.id))
            })
        }
      )
    }
    const guest = p.source !== 'manual' ? guests.find((g) => g.vmid === p.vmid) : undefined
    if (guest) entries.push({ label: t('menuEditNotes'), separator: true, run: () => void s.openInPve(guest) })
    if (p.kind === 'tab') entries.push({ label: t('menuCloseTab'), separator: true, run: () => s.closeTab(p.id) })
    else {
      entries.push({
        label: t('menuStopView'),
        separator: true,
        disabled: (panelStatus[p.id]?.state ?? 'off') === 'off',
        run: () => {
          void window.api.stopPanel(p.id)
          if (s.page === 'view' && s.activeId === p.id) s.openHome()
        }
      })
      entries.push({
        label: t('menuClearData'),
        run: () =>
          s.askConfirm({
            title: t('menuClearTitle', { name: p.name }),
            body: t('menuClearBody'),
            confirmLabel: t('menuClearData').replace('…', ''),
            danger: true,
            onConfirm: () => void window.api.clearPanelData(p.id).then(() => s.showToast('ok', t('menuCleared')))
          })
      })
    }
  } else if (menu.kind === 'ssh') {
    const c = connections.find((x) => x.id === menu.id)
    if (!c) return null
    title = c.name
    entries.push(
      { label: t('menuConnect'), run: () => void s.openSsh(c.id) },
      {
        label: t('menuEdit'),
        run: () => {
          s.requestEdit('ssh', c.id)
          s.openSettings('ssh-form')
        }
      },
      {
        label: t('menuCopyUserHost'),
        run: () => void window.api.copyText(`${c.username}@${c.host}`).then(() => s.showToast('ok', t('menuCopied')))
      },
      {
        label: t('menuRemove'),
        danger: true,
        separator: true,
        run: () =>
          s.askConfirm({
            title: t('sshDeleteTitle', { name: c.name }),
            body: t('sshDeleteBody'),
            confirmLabel: t('remove'),
            danger: true,
            onConfirm: () => void window.api.deleteSsh(c.id).then(s.setSshConnections)
          })
      }
    )
  } else {
    const sess = sessions.find((x) => x.id === menu.id)
    if (!sess) return null
    title = sess.name
    entries.push(
      { label: t('menuGoSession'), run: () => s.selectSsh(sess.id) },
      {
        label: t('menuReconnect'),
        disabled: sess.state === 'open' || sess.state === 'connecting',
        run: () => void s.reconnectSsh(sess)
      },
      { label: t('sshClose'), danger: true, separator: true, run: () => s.closeSsh(sess.id) }
    )
  }

  const left = Math.min(menu.x, window.innerWidth - 224)
  const top = Math.min(menu.y, window.innerHeight - (entries.length * 32 + 56))

  return (
    <div
      className="menu-backdrop"
      onMouseDown={closeItemMenu}
      onContextMenu={(e) => {
        e.preventDefault()
        closeItemMenu()
      }}
    >
      <div ref={ref} className="menu" role="menu" style={{ left, top }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="menu-title">{title}</div>
        {entries.map((e) => (
          <div key={e.label}>
            {e.separator && <hr />}
            <button
              role="menuitem"
              className={e.danger ? 'danger' : undefined}
              disabled={e.disabled}
              onClick={() => {
                closeItemMenu()
                e.run()
              }}
            >
              {e.label}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
