import { useState } from 'react'
import { t } from '../i18n'
import { useStore } from '../store'

// Huella del servidor SSH: confianza en el primer uso, con aviso fuerte si cambió
export function SshHostPrompt(): React.JSX.Element | null {
  const info = useStore((s) => s.sshHostQueue[0])
  const answer = useStore((s) => s.answerSshHost)
  if (!info) return null
  const changed = !!info.previous
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className={`modal${changed ? ' danger' : ''}`}>
        <h2>{changed ? t('sshHostChangedTitle') : t('sshHostTitle')}</h2>
        <p>
          {t(changed ? 'sshHostChangedBody' : 'sshHostBody', { host: `${info.host}:${info.port}` })}
        </p>
        <div className="label">
          {t('sshHostFingerprint')} ({info.keyType})
        </div>
        <code className="fingerprint">{info.fingerprint}</code>
        {info.previous && (
          <>
            <div className="label">{t('certPrevious')}</div>
            <code className="fingerprint">{info.previous}</code>
          </>
        )}
        <div className="modal-actions">
          <button className="btn" autoFocus onClick={() => answer(false)}>
            {t('certReject')}
          </button>
          <button className={`btn ${changed ? 'danger-fill' : 'primary'}`} onClick={() => answer(true)}>
            {t('sshHostTrust')}
          </button>
        </div>
      </div>
    </div>
  )
}

// Contraseña pedida al conectar cuando la conexión no la tiene guardada
export function SshSecretPrompt(): React.JSX.Element | null {
  const prompt = useStore((s) => s.sshSecretPrompt)
  const cancel = useStore((s) => s.cancelSshSecret)
  const submit = useStore((s) => s.submitSshSecret)
  const [value, setValue] = useState('')
  if (!prompt) return null
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <form
        className="modal"
        onSubmit={(e) => {
          e.preventDefault()
          const v = value
          setValue('')
          submit(v)
        }}
      >
        <h2>{t('sshSecretTitle', { name: prompt.name })}</h2>
        <label className="field">
          <span>{t('sshPassword')}</span>
          <input type="password" autoFocus value={value} onChange={(e) => setValue(e.target.value)} autoComplete="off" />
        </label>
        <div className="modal-actions">
          <button
            type="button"
            className="btn"
            onClick={() => {
              setValue('')
              cancel()
            }}
          >
            {t('cancel')}
          </button>
          <button type="submit" className="btn primary" disabled={!value}>
            {t('sshConnect')}
          </button>
        </div>
      </form>
    </div>
  )
}
