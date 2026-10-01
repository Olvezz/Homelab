import { useEffect } from 'react'
import { CertPrompt } from './components/CertPrompt'
import { ConfirmDialog, GuestMenu, SearchPalette } from './components/Dialogs'
import { Settings } from './components/Settings'
import { SshHostPrompt, SshSecretPrompt } from './components/SshDialogs'
import { SshView } from './components/SshView'
import { Sidebar } from './components/Sidebar'
import { Toolbar } from './components/Toolbar'
import { Wizard } from './components/Wizard'
import { t } from './i18n'
import { effectiveSidebarWidth, useStore } from './store'
import { applyTheme, resolveTheme } from './theme'

export function App(): React.JSX.Element {
  const ready = useStore((s) => s.ready)
  const ui = useStore((s) => s.ui)
  const activeId = useStore((s) => s.activeId)
  const page = useStore((s) => s.page)
  const certQueue = useStore((s) => s.certQueue)
  const menuOpen = useStore((s) => !!s.menu)
  const confirmOpen = useStore((s) => !!s.confirm)
  const searchOpen = useStore((s) => s.searchOpen)
  const sshModal = useStore((s) => s.sshHostQueue.length > 0 || !!s.sshSecretPrompt)
  const activeSshId = useStore((s) => s.activeSshId)
  const themeCookie = useStore((s) => s.themeCookie)
  const init = useStore((s) => s.init)

  useEffect(() => {
    void init()
  }, [init])

  // Tema: por defecto sigue al que Proxmox/ProxMorph tenga elegido (cookie PVEThemeCookie)
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (): void => {
      const resolved = resolveTheme(ui.theme, themeCookie, media.matches)
      applyTheme(resolved)
      // Las vistas web (Portainer, AdGuard…) siguen el claro/oscuro vía prefers-color-scheme
      void window.api.setNativeTheme(resolved.mode)
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [ui.theme, themeCookie])

  // Los modales y menús quedan tapados por la vista nativa: se oculta mientras estén abiertos
  const certOpen = certQueue.length > 0
  const overlay = certOpen || menuOpen || confirmOpen || searchOpen || sshModal
  useEffect(() => {
    void window.api.setOverlay(overlay)
  }, [overlay])

  // Con un terminal SSH delante, los atajos de la app (Ctrl+R, Ctrl+K…) se dejan pasar al shell
  const terminalFocus = page === 'ssh' && !!activeSshId && !overlay
  useEffect(() => {
    void window.api.setTerminalFocus(terminalFocus)
  }, [terminalFocus])

  if (!ready) return <div className="boot">{t('loading')}</div>

  return (
    <div className="shell" style={{ gridTemplateColumns: `${effectiveSidebarWidth(ui)}px 1fr` }}>
      <Sidebar />
      <main className="content">
        <Toolbar />
        {page === 'settings' && <Settings />}
        {page === 'wizard' && <Wizard />}
        <SshView />
        {page === 'view' && !activeId && <div className="placeholder">{t('selectPanel')}</div>}
      </main>
      <GuestMenu />
      <ConfirmDialog />
      <SearchPalette />
      <SshHostPrompt />
      <SshSecretPrompt />
      {certOpen && <CertPrompt info={certQueue[0]} />}
    </div>
  )
}
