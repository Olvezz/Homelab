import { t } from '../i18n'
import { useStore } from '../store'
import type { CertPromptInfo } from '../../shared/types'

export function CertPrompt({ info }: { info: CertPromptInfo }): React.JSX.Element {
  const decideCert = useStore((s) => s.decideCert)
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className={`modal${info.changed ? ' danger' : ''}`}>
        <h2>{info.changed ? t('certChangedTitle') : t('certTitle')}</h2>
        <p>{t(info.changed ? 'certChangedBody' : 'certBody', { host: info.hostname })}</p>
        <div className="label">{t('certFingerprint')}</div>
        <code className="fingerprint">{info.fingerprint}</code>
        {info.changed && info.previous && (
          <>
            <div className="label">{t('certPrevious')}</div>
            <code className="fingerprint">{info.previous}</code>
          </>
        )}
        <div className="modal-actions">
          <button className="btn" onClick={() => decideCert(false)}>
            {t('certReject')}
          </button>
          <button className="btn primary" onClick={() => decideCert(true)}>
            {t('certTrust')}
          </button>
        </div>
      </div>
    </div>
  )
}
