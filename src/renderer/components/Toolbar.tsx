import { t, type Key } from '../i18n'
import { useStore } from '../store'
import type { NavAction } from '../../shared/types'
import { Icon } from './Icon'

export function Toolbar(): React.JSX.Element {
  const viewState = useStore((s) => s.viewState)
  const activeId = useStore((s) => s.activeId)
  const page = useStore((s) => s.page)
  const toast = useStore((s) => s.toast)
  const dismissToast = useStore((s) => s.dismissToast)
  const enabled = !!activeId && page === 'view'

  const button = (action: NavAction, label: React.ReactNode, title: Key, disabled = false): React.JSX.Element => (
    <button
      className="tool"
      title={t(title)}
      aria-label={t(title)}
      disabled={!enabled || disabled}
      onClick={() => void window.api.nav(action)}
    >
      {label}
    </button>
  )

  return (
    <header className="toolbar">
      {button('back', <Icon k="ui:back" />, 'back', !viewState?.canGoBack)}
      {button('forward', <Icon k="ui:forward" />, 'forward', !viewState?.canGoForward)}
      {button('reload', <Icon k={viewState?.loading ? 'ui:loader' : 'ui:reload'} className={viewState?.loading ? 'spin' : undefined} />, 'reload')}
      {/* Los avisos viven aquí: la zona de contenido la ocupa la vista nativa y taparía cualquier toast flotante */}
      {toast ? (
        <button className={`url toast ${toast.kind}`} role="status" onClick={dismissToast} title={toast.text}>
          {toast.text}
        </button>
      ) : (
        <div className="url" title={viewState?.title}>
          {enabled ? viewState?.url : ''}
        </div>
      )}
      {button('zoomOut', <Icon k="ui:minus" />, 'zoomOut')}
      {button('zoomIn', <Icon k="ui:plus" />, 'zoomIn')}
      {button('copyUrl', <Icon k="ui:copy" />, 'copyUrl')}
      {button('openExternal', <Icon k="ui:external" />, 'openExternal')}
    </header>
  )
}
