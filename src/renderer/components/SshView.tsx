import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { useEffect, useRef } from 'react'
import type { SshSession } from '../../shared/types'
import { t } from '../i18n'
import { attach, detach } from '../sshBus'
import { useStore } from '../store'
import { Icon } from './Icon'

// Colores del terminal tomados del tema activo (variables CSS de la app)
function terminalTheme(): Record<string, string> {
  const css = getComputedStyle(document.documentElement)
  const v = (name: string, fallback: string): string => css.getPropertyValue(name).trim() || fallback
  return {
    background: v('--bg', '#0d1117'),
    foreground: v('--text', '#f0f6fc'),
    cursor: v('--accent', '#238636'),
    cursorAccent: v('--bg', '#0d1117'),
    selectionBackground: v('--active', '#264f78')
  }
}

function SshTerminal({ session, visible }: { session: SshSession; visible: boolean }): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const term = useRef<Terminal | null>(null)
  const fit = useRef<FitAddon | null>(null)

  useEffect(() => {
    const el = host.current
    if (!el) return
    const terminal = new Terminal({
      fontFamily: '"Cascadia Mono", Consolas, monospace',
      fontSize: 13,
      cursorBlink: true,
      scrollback: 5000,
      minimumContrastRatio: 4.5, // legible también en los temas claros
      theme: terminalTheme()
    })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(el)
    term.current = terminal
    fit.current = fitAddon
    attach(session.id, terminal)

    const id = session.id
    terminal.onData((d) => void window.api.sshInput(id, d))
    terminal.onResize(({ cols, rows }) => void window.api.resizeSsh(id, cols, rows))
    // Como PuTTY: seleccionar copia, clic derecho pega
    terminal.onSelectionChange(() => {
      const sel = terminal.getSelection()
      if (sel) void window.api.copyText(sel)
    })
    const onContext = (e: MouseEvent): void => {
      e.preventDefault()
      void window.api.readClipboard().then((text) => text && terminal.paste(text))
    }
    el.addEventListener('contextmenu', onContext)

    let frame = 0
    const refit = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (el.offsetParent !== null) fitAddon.fit()
      })
    }
    const observer = new ResizeObserver(refit)
    observer.observe(el)
    const onTheme = (): void => {
      terminal.options.theme = terminalTheme()
    }
    window.addEventListener('app-theme', onTheme)
    refit()

    return () => {
      window.removeEventListener('app-theme', onTheme)
      observer.disconnect()
      el.removeEventListener('contextmenu', onContext)
      cancelAnimationFrame(frame)
      detach(id)
      terminal.dispose()
    }
  }, [session.id])

  useEffect(() => {
    if (!visible) return
    const frame = requestAnimationFrame(() => {
      fit.current?.fit()
      term.current?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [visible])

  return <div ref={host} className="term" style={{ display: visible ? 'block' : 'none' }} />
}

function stateLabel(s: SshSession): string {
  if (s.state === 'connecting') return t('sshConnecting')
  if (s.state === 'open') return t('sshConnected')
  if (s.state === 'closed') return t('sshClosed')
  return s.message ?? t('sshError')
}

// Todos los terminales viven montados (ocultos si no son el activo) para conservar su contenido
export function SshView(): React.JSX.Element {
  const sessions = useStore((s) => s.sshSessions)
  const activeId = useStore((s) => s.activeSshId)
  const page = useStore((s) => s.page)
  const closeSsh = useStore((s) => s.closeSsh)
  const reconnect = useStore((s) => s.reconnectSsh)
  const current = sessions.find((s) => s.id === activeId)

  return (
    <div className="ssh-view" style={{ display: page === 'ssh' ? 'flex' : 'none' }}>
      {current && (
        <div className={`ssh-bar ${current.state}`}>
          <Icon k="ui:terminal" size={15} />
          <strong>{current.name}</strong>
          <span className="ssh-state">{stateLabel(current)}</span>
          <span className="push" />
          {(current.state === 'closed' || current.state === 'error') && (
            <button className="btn small" onClick={() => void reconnect(current)}>
              {t('sshReconnect')}
            </button>
          )}
          <button className="btn small" onClick={() => closeSsh(current.id)}>
            {t('sshClose')}
          </button>
        </div>
      )}
      <div className="ssh-terminals">
        {sessions.map((s) => (
          <SshTerminal key={s.id} session={s} visible={page === 'ssh' && s.id === activeId} />
        ))}
      </div>
    </div>
  )
}
