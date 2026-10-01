import { useEffect, useState } from 'react'
import type { Panel, SshAuth } from '../../shared/types'
import { errMsg, t, type Key } from '../i18n'
import { useStore } from '../store'
import { resolveTheme, THEMES } from '../theme'
import { Icon, ICON_CHOICES, isKnownIcon, panelIconKey } from './Icon'

interface Draft {
  id: string | null // null = panel nuevo
  name: string
  url: string
  icon: string // clave de icono o '' = automático
}

const emptyDraft: Draft = { id: null, name: '', url: '', icon: '' }

function validUrl(raw: string): boolean {
  try {
    const { protocol } = new URL(raw)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

const STATUS_KEY: Record<string, Key> = {
  unconfigured: 'statusUnconfigured',
  'needs-secret': 'statusNeedsSecret',
  connecting: 'statusConnecting',
  connected: 'statusConnected',
  offline: 'statusOffline',
  unauthorized: 'statusUnauthorized',
  'cert-changed': 'statusCertChanged',
  error: 'statusError'
}

function Toggle({
  checked,
  label,
  onChange
}: {
  checked: boolean
  label: string
  onChange: (v: boolean) => void
}): React.JSX.Element {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

function Connection(): React.JSX.Element {
  const pve = useStore((s) => s.pve)
  const snapshot = useStore((s) => s.snapshot)
  const openWizard = useStore((s) => s.openWizard)
  const askConfirm = useStore((s) => s.askConfirm)

  return (
    <>
      <h2>{t('connection')}</h2>
      {!pve ? (
        <>
          <p className="hint">{t('connectionNone')}</p>
          <button className="btn primary" onClick={openWizard}>
            {t('connectionConfigure')}
          </button>
        </>
      ) : (
        <div className="card">
          <dl className="kv">
            <dt>{t('proxmox')}</dt>
            <dd>
              {pve.host}:{pve.port}
            </dd>
            <dt>{t('wizardTokenId')}</dt>
            <dd>{pve.tokenId}</dd>
            <dt>{t('certFingerprint')}</dt>
            <dd className="mono">{pve.fingerprint}</dd>
            <dt>{t('wizardInterval')}</dt>
            <dd>{pve.pollIntervalSec} s</dd>
            <dt>Estado</dt>
            <dd>{snapshot.message ?? t(STATUS_KEY[snapshot.status])}</dd>
          </dl>
          {!pve.secretStored && <div className="error">{t('secretNotStored')}</div>}
          <div className="form-actions spaced">
            <button className="btn danger" onClick={() =>
              askConfirm({
                title: t('confirmForgetTitle'),
                body: t('confirmForget'),
                confirmLabel: t('connectionForget'),
                danger: true,
                onConfirm: () => void window.api.pveForget()
              })
            }>
              {t('connectionForget')}
            </button>
            <button className="btn" onClick={() => void window.api.pveRefresh()}>
              {t('connectionRefresh')}
            </button>
            <button className="btn primary" onClick={openWizard}>
              {t('connectionReconfigure')}
            </button>
          </div>
        </div>
      )}
    </>
  )
}

interface SshForm {
  id?: string
  name: string
  host: string
  port: string
  username: string
  auth: SshAuth
  keyPath: string
  secret: string
  clearSecret: boolean
  hasSecret: boolean
}

const emptySsh: SshForm = {
  name: '',
  host: '',
  port: '22',
  username: 'root',
  auth: 'password',
  keyPath: '',
  secret: '',
  clearSecret: false,
  hasSecret: false
}

function SshConnections(): React.JSX.Element {
  const connections = useStore((s) => s.sshConnections)
  const setConnections = useStore((s) => s.setSshConnections)
  const openSsh = useStore((s) => s.openSsh)
  const askConfirm = useStore((s) => s.askConfirm)
  const showToast = useStore((s) => s.showToast)
  const draft = useStore((s) => s.sshDraft)
  const [form, setForm] = useState<SshForm>(emptySsh)
  const [error, setError] = useState('')

  // Conexión nueva con los datos de un guest (menú contextual → Abrir SSH)
  useEffect(() => {
    if (!draft) return
    setForm({ ...emptySsh, ...draft, port: String(draft.port ?? 22), keyPath: draft.keyPath ?? '', secret: '' } as SshForm)
    useStore.setState({ sshDraft: null })
  }, [draft])

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    const port = Number(form.port)
    if (!form.name.trim()) return setError(t('errName'))
    if (!/^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/.test(form.host.trim())) return setError(t('errHost'))
    if (!Number.isInteger(port) || port < 1 || port > 65535) return setError(t('errPort'))
    if (!/^[A-Za-z0-9._$@-]{1,64}$/.test(form.username)) return setError(t('errUser'))
    if (form.auth === 'key' && !form.keyPath) return setError(t('errKey'))
    try {
      const saved = await window.api.saveSsh({
        id: form.id,
        name: form.name.trim(),
        host: form.host.trim(),
        port,
        username: form.username,
        auth: form.auth,
        keyPath: form.auth === 'key' ? form.keyPath : undefined,
        secret: form.auth === 'agent' || form.clearSecret ? '' : form.secret || undefined
      })
      setConnections(saved)
      setForm(emptySsh)
      setError('')
    } catch (err) {
      setError(errMsg(err))
    }
  }

  const remove = (id: string, name: string): void =>
    askConfirm({
      title: t('sshDeleteTitle', { name }),
      body: t('sshDeleteBody'),
      confirmLabel: t('remove'),
      danger: true,
      onConfirm: () => void window.api.deleteSsh(id).then(setConnections)
    })

  const importFromPutty = async (): Promise<void> => {
    try {
      const r = await window.api.importPutty()
      setConnections(r.connections)
      showToast(r.added > 0 ? 'ok' : 'info', r.added > 0 ? t('sshImported', { n: r.added }) : t('sshImportNone'))
    } catch (err) {
      setError(errMsg(err))
    }
  }

  const authLabel: Record<SshAuth, string> = {
    password: t('sshAuthPassword'),
    key: t('sshAuthKey'),
    agent: t('sshAuthAgent')
  }

  return (
    <>
      <h2 id="ssh-section">{t('sshConnections')}</h2>
      <p className="hint">{t('sshHint')}</p>
      <div className="form-actions spaced wrap left">
        <button className="btn" onClick={() => void importFromPutty()}>
          {t('sshImport')}
        </button>
      </div>
      {connections.length > 0 && (
        <ul className="settings-list">
          {connections.map((c) => (
            <li key={c.id}>
              <span className="panel-icon">
                <Icon k="ui:terminal" />
              </span>
              <span className="settings-name">{c.name}</span>
              <span className="settings-url">
                {c.username}@{c.host}:{c.port} · {authLabel[c.auth]}
              </span>
              <button className="btn small" onClick={() => void openSsh(c.id)}>
                {t('sshConnect')}
              </button>
              <button
                className="btn small"
                onClick={() => {
                  setForm({
                    id: c.id,
                    name: c.name,
                    host: c.host,
                    port: String(c.port),
                    username: c.username,
                    auth: c.auth,
                    keyPath: c.keyPath ?? '',
                    secret: '',
                    clearSecret: false,
                    hasSecret: c.hasSecret
                  })
                  setError('')
                }}
              >
                {t('edit')}
              </button>
              <button className="btn small danger" onClick={() => remove(c.id, c.name)}>
                {t('remove')}
              </button>
            </li>
          ))}
        </ul>
      )}

      <form className="panel-form" onSubmit={(e) => void submit(e)}>
        <h3>{form.id ? t('sshEdit') : t('sshNew')}</h3>
        <div className="row">
          <label className="field grow">
            <span>{t('name')}</span>
            <input value={form.name} maxLength={60} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
        </div>
        <div className="row">
          <label className="field grow">
            <span>{t('sshFieldHost')}</span>
            <input value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} />
          </label>
          <label className="field port">
            <span>{t('wizardPort')}</span>
            <input value={form.port} inputMode="numeric" onChange={(e) => setForm({ ...form, port: e.target.value })} />
          </label>
          <label className="field grow">
            <span>{t('sshFieldUser')}</span>
            <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          </label>
        </div>
        <label className="field">
          <span>{t('sshAuth')}</span>
          <select value={form.auth} onChange={(e) => setForm({ ...form, auth: e.target.value as SshAuth, secret: '' })}>
            <option value="password">{t('sshAuthPassword')}</option>
            <option value="key">{t('sshAuthKey')}</option>
            <option value="agent">{t('sshAuthAgent')}</option>
          </select>
        </label>
        {form.auth === 'key' && (
          <label className="field">
            <span>{t('sshKeyFile')}</span>
            <div className="icon-pick">
              <input value={form.keyPath} onChange={(e) => setForm({ ...form, keyPath: e.target.value })} spellCheck={false} />
              <button
                type="button"
                className="btn"
                onClick={() => void window.api.pickSshKey().then((p) => p && setForm({ ...form, keyPath: p }))}
              >
                {t('sshKeyChoose')}
              </button>
            </div>
          </label>
        )}
        {form.auth !== 'agent' ? (
          <>
            <label className="field">
              <span>{form.auth === 'key' ? t('sshPassphrase') : t('sshSecretOptional')}</span>
              <input
                type="password"
                value={form.secret}
                autoComplete="off"
                placeholder={form.hasSecret && !form.clearSecret ? t('sshSecretStored') : ''}
                onChange={(e) => setForm({ ...form, secret: e.target.value })}
              />
            </label>
            {form.hasSecret && (
              <label className="check">
                <input
                  type="checkbox"
                  checked={form.clearSecret}
                  onChange={(e) => setForm({ ...form, clearSecret: e.target.checked })}
                />
                <span>{t('sshClearSecret')}</span>
              </label>
            )}
            <p className="hint">{t('wizardSecretNote')}</p>
          </>
        ) : (
          <p className="hint">{t('sshAgentHint')}</p>
        )}
        {error && <div className="error">{error}</div>}
        <div className="form-actions">
          {(form.id || form.name || form.host) && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                setForm(emptySsh)
                setError('')
              }}
            >
              {t('cancel')}
            </button>
          )}
          <button type="submit" className="btn primary">
            {t('save')}
          </button>
        </div>
      </form>
    </>
  )
}

function Provisioning(): React.JSX.Element {
  const showToast = useStore((s) => s.showToast)
  const selectPanel = useStore((s) => s.selectPanel)
  const [saved, setSaved] = useState('')
  const [draft, setDraft] = useState('')
  const [isDefault, setIsDefault] = useState(true)
  const [uninstall, setUninstall] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    void window.api.getProvision().then((p) => {
      setSaved(p.script)
      setDraft(p.script)
      setIsDefault(p.isDefault)
      setUninstall(p.uninstall)
    })
  }, [])

  const dirty = draft !== saved
  const fail = (e: unknown): void => setError(errMsg(e))

  const save = async (script: string | null): Promise<void> => {
    setError('')
    try {
      await window.api.saveProvision(script)
      const p = await window.api.getProvision()
      setSaved(p.script)
      setDraft(p.script)
      setIsDefault(p.isDefault)
      showToast('ok', t('provisionSaved'))
    } catch (e) {
      fail(e)
    }
  }

  return (
    <>
      <h2>{t('provision')}</h2>
      <p className="hint">{t('provisionIntro')}</p>
      <ol className="steps">
        <li>{t('provisionStep1')}</li>
        <li>{t('provisionStep2')}</li>
        <li>{t('provisionStep3')}</li>
      </ol>
      <label className="field">
        <span>{t('provisionScriptLabel')}</span>
        <textarea
          className="code"
          value={draft}
          rows={14}
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
        />
      </label>
      {error && <div className="error">{error}</div>}
      <div className="form-actions spaced wrap">
        <button className="btn" disabled={isDefault && !dirty} onClick={() => void save(null)}>
          {t('provisionRestore')}
        </button>
        <button className="btn" disabled={!dirty} onClick={() => void save(draft)}>
          {t('provisionSave')}
        </button>
      </div>
      <div className="form-actions spaced wrap">
        <button
          className="btn"
          onClick={() =>
            void window.api
              .copyProvisionInstaller()
              .then(() => showToast('ok', t('provisionCopied')))
              .catch(fail)
          }
        >
          {t('provisionCopy')}
        </button>
        <button
          className="btn"
          onClick={() =>
            void window.api
              .copyText(uninstall)
              .then(() => showToast('ok', t('provisionCopied')))
              .catch(fail)
          }
        >
          {t('provisionCopyUninstall')}
        </button>
        <button
          className="btn primary"
          disabled={dirty}
          onClick={() =>
            void window.api
              .openProvisionShell()
              .then((id) => {
                if (id) {
                  selectPanel(id)
                  showToast('info', t('provisionPasteHint'))
                }
              })
              .catch(fail)
          }
        >
          {t('provisionOpenShell')}
        </button>
      </div>
      <p className="hint">{t('provisionNotes')}</p>
    </>
  )
}

function Updates(): React.JSX.Element {
  const update = useStore((s) => s.update)
  const autoUpdate = useStore((s) => s.ui.autoUpdate)
  const setUi = useStore((s) => s.setUi)

  const line = ((): string => {
    switch (update.state) {
      case 'disabled':
        return t('updateDisabled')
      case 'checking':
        return t('updateChecking')
      case 'none':
        return t('updateNone')
      case 'downloading':
        return t('updateDownloading', { version: update.version ?? '', percent: update.percent ?? 0 })
      case 'ready':
        return t('updateReady', { version: update.version ?? '' })
      case 'error':
        return update.message ?? ''
      default:
        return t('updateIdle')
    }
  })()
  const busy = update.state === 'checking' || update.state === 'downloading'

  return (
    <>
      <h2>{t('updates')}</h2>
      <Toggle checked={autoUpdate} label={t('autoUpdate')} onChange={(v) => setUi({ autoUpdate: v })} />
      <p className={update.state === 'error' ? 'error' : 'hint'}>{line}</p>
      <div className="form-actions spaced">
        <button
          className="btn"
          disabled={update.state === 'disabled' || busy || update.state === 'ready'}
          onClick={() => void window.api.checkUpdate()}
        >
          {t('updateCheck')}
        </button>
        {update.state === 'ready' && (
          <button className="btn primary" onClick={() => void window.api.installUpdate()}>
            {t('updateInstall')}
          </button>
        )}
      </div>
      <p className="hint">{t('updateDataSafe')}</p>
    </>
  )
}

function Diagnostics(): React.JSX.Element {
  const diagnostics = useStore((s) => s.snapshot.diagnostics)
  const showToast = useStore((s) => s.showToast)

  return (
    <>
      <h2>{t('diagnostics')}</h2>
      <p className="hint">{t('diagnosticsHint')}</p>
      {diagnostics.length === 0 ? (
        <p className="hint">{t('diagnosticsNone')}</p>
      ) : (
        <ul className="settings-list diag">
          {diagnostics.map((d, i) => (
            <li key={`${d.kind}-${d.vmid ?? 'x'}-${i}`}>
              <span className="diag-guest">{d.vmid ? `${d.vmid} ${d.guest ?? ''}` : '—'}</span>
              <span className="diag-text">{d.text}</span>
              {d.kind === 'external-pending' && d.url && (
                <button
                  className="btn small"
                  onClick={() => {
                    window.api.pveApproveExternal(d.url!).catch((e) => showToast('error', errMsg(e)))
                  }}
                >
                  {t('diagnosticsApprove')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

function Appearance(): React.JSX.Element {
  const theme = useStore((s) => s.ui.theme)
  const themeCookie = useStore((s) => s.themeCookie)
  const setUi = useStore((s) => s.setUi)
  const active = resolveTheme(theme, themeCookie, window.matchMedia('(prefers-color-scheme: dark)').matches)
  const dark = THEMES.filter((x) => x.dark)
  const light = THEMES.filter((x) => !x.dark)

  return (
    <>
      <h2>{t('appearance')}</h2>
      <label className="field inline">
        <span>{t('theme')}</span>
        <select value={theme} onChange={(e) => setUi({ theme: e.target.value })}>
          <option value="proxmox">{t('themeFollowProxmox')}</option>
          <optgroup label={t('themeGroupDark')}>
            {dark.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </optgroup>
          <optgroup label={t('themeGroupLight')}>
            {light.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
            <option value="light">{t('themeLight')}</option>
          </optgroup>
          <option value="system">{t('themeSystem')}</option>
        </select>
      </label>
      <p className="hint">
        {theme === 'proxmox'
          ? t('themeFollowHint', { name: active.label, cookie: themeCookie ?? t('themeNoCookie') })
          : t('themeFixedHint')}
      </p>
    </>
  )
}

export function Settings(): React.JSX.Element {
  const panels = useStore((s) => s.panels)
  const ui = useStore((s) => s.ui)
  const setUi = useStore((s) => s.setUi)
  const saveManualPanels = useStore((s) => s.saveManualPanels)
  const closeSettings = useStore((s) => s.closeSettings)
  const anchor = useStore((s) => s.settingsAnchor)

  // Desplazarse a la sección pedida (p. ej. «Nueva conexión SSH» desde la barra lateral)
  useEffect(() => {
    if (!anchor) return
    const timer = setTimeout(() => document.getElementById(anchor)?.scrollIntoView({ block: 'start' }), 60)
    useStore.setState({ settingsAnchor: null })
    return () => clearTimeout(timer)
  }, [anchor])

  // Solo los manuales son editables: los descubiertos viven en las notas de Proxmox
  const manual = panels.filter((p) => p.source === 'manual' && p.kind !== 'tab')

  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [error, setError] = useState('')

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    const name = draft.name.trim()
    const url = draft.url.trim()
    if (!name) return setError(t('errName'))
    if (!validUrl(url)) return setError(t('errUrl'))

    const icon = draft.icon || undefined
    const next: Panel[] =
      draft.id === null
        ? [...manual, { id: `manual-${crypto.randomUUID()}`, name, url, icon, source: 'manual' }]
        : manual.map((p) => (p.id === draft.id ? { ...p, name, url, icon } : p))
    try {
      await saveManualPanels(next)
      setDraft(emptyDraft)
      setError('')
    } catch (err) {
      setError(errMsg(err))
    }
  }

  const remove = async (panel: Panel): Promise<void> => {
    if (!window.confirm(`${t('confirmRemove')}\n\n${panel.name}`)) return
    try {
      await saveManualPanels(manual.filter((p) => p.id !== panel.id))
      if (draft.id === panel.id) setDraft(emptyDraft)
    } catch (err) {
      setError(errMsg(err))
    }
  }

  return (
    <section className="settings">
      <div className="settings-head">
        <h1>{t('settingsTitle')}</h1>
        <button className="btn" onClick={closeSettings}>
          {t('close')}
        </button>
      </div>

      <Connection />

      <Appearance />

      <h2>{t('general')}</h2>
      <Toggle checked={ui.closeToTray} label={t('closeToTray')} onChange={(v) => setUi({ closeToTray: v })} />
      <Toggle checked={ui.startWithWindows} label={t('startWithWindows')} onChange={(v) => setUi({ startWithWindows: v })} />
      <Toggle checked={ui.showTemplates} label={t('showTemplates')} onChange={(v) => setUi({ showTemplates: v })} />

      <Updates />

      <SshConnections />

      <Provisioning />

      <h2>{t('manualPanels')}</h2>
      <p className="hint">{t('manualPanelsHint')}</p>

      <ul className="settings-list">
        {manual.map((p) => (
          <li key={p.id}>
            <span className="panel-icon">
              <Icon k={panelIconKey(p, undefined)} />
            </span>
            <span className="settings-name">{p.name}</span>
            <span className="settings-url">{p.url}</span>
            <button
              className="btn small"
              onClick={() => {
                setDraft({ id: p.id, name: p.name, url: p.url, icon: isKnownIcon(p.icon ?? '') ? (p.icon ?? '') : '' })
                setError('')
              }}
            >
              {t('edit')}
            </button>
            <button className="btn small danger" onClick={() => void remove(p)}>
              {t('remove')}
            </button>
          </li>
        ))}
      </ul>

      <form className="panel-form" onSubmit={(e) => void submit(e)}>
        <h3>{draft.id === null ? t('addPanel') : t('editPanel')}</h3>
        <label className="field">
          <span>{t('name')}</span>
          <input value={draft.name} maxLength={60} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </label>
        <label className="field">
          <span>{t('url')}</span>
          <input value={draft.url} maxLength={2048} onChange={(e) => setDraft({ ...draft, url: e.target.value })} />
        </label>
        <label className="field">
          <span>{t('icon')}</span>
          <div className="icon-pick">
            <Icon
              k={panelIconKey({ id: 'x', name: draft.name, url: draft.url || 'http://x', icon: draft.icon || undefined, source: 'manual' }, undefined)}
              size={20}
            />
            <select value={draft.icon} onChange={(e) => setDraft({ ...draft, icon: e.target.value })}>
              <option value="">{t('iconAuto')}</option>
              {ICON_CHOICES.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
        </label>
        {error && <div className="error">{error}</div>}
        <div className="form-actions">
          {draft.id !== null && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                setDraft(emptyDraft)
                setError('')
              }}
            >
              {t('cancel')}
            </button>
          )}
          <button type="submit" className="btn primary">
            {t('save')}
          </button>
        </div>
      </form>

      <Diagnostics />

      <p className="about">
        {t('aboutBuild', { version: __APP_VERSION__, date: new Date(__BUILD_TIME__).toLocaleString('es') })}
      </p>
    </section>
  )
}
