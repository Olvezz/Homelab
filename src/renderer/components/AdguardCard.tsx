import { useState } from 'react'
import type { AdguardSnapshot } from '../../shared/types'
import { fmtClock, fmtPct } from '../homeFormat'
import { t } from '../i18n'
import { useStore } from '../store'
import { Icon } from './Icon'

// «Nombre · IP» cuando se conoce el nombre; si no, solo la IP marcada como sin nombre
function Who({ name, ip }: { name?: string; ip: string }): React.JSX.Element {
  return name ? (
    <span title={ip}>
      {name} <span className="dim">· {ip}</span>
    </span>
  ) : (
    <span title={t('adgNameHint')}>
      {ip} <span className="dim">({t('adgNoName')})</span>
    </span>
  )
}

const n = (v: number): string => v.toLocaleString('es')

export function AdguardCard({ snap }: { snap: AdguardSnapshot | null | undefined }): React.JSX.Element | null {
  const openSettings = useStore((s) => s.openSettings)
  const [filter, setFilter] = useState('')
  if (snap === undefined) return null

  if (snap === null) {
    return (
      <section className="card">
        <header>
          <h2>{t('adgTitle')}</h2>
        </header>
        <p className="note">{t('adgSetupHint')}</p>
        <button className="btn small" onClick={() => openSettings('adguard-form')}>
          {t('homeConfigure')}
        </button>
      </section>
    )
  }

  const q = filter.trim().toLowerCase()
  const recent = snap.recent.filter((e) => !q || `${e.domain} ${e.name ?? ''} ${e.ip}`.toLowerCase().includes(q))
  const maxBlocked = Math.max(1, ...snap.topBlocked.map((d) => d.count))
  const unnamed = snap.clients.some((c) => !c.name)
  const fatal = snap.errors.status ?? (snap.stats === null ? snap.errors.stats : undefined)

  return (
    <section className="card adg">
      <header>
        <h2>{t('adgTitle')}</h2>
        <div className="adg-chips">
          {snap.status && (
            <span className={`chip ${snap.status.protection ? 'ok' : 'warn'}`}>
              <Icon k={snap.status.protection ? 'ui:check' : 'ui:alert'} size={12} />
              {snap.status.protection ? t('adgProtectionOn') : t('adgProtectionOff')}
            </span>
          )}
          {snap.status?.version && <span className="dim small">{snap.status.version}</span>}
        </div>
      </header>

      {fatal && <p className="note">{fatal}</p>}

      {snap.stats && (
        <div className="tiles compact">
          <div className="tile">
            <div className="tile-label">{t('adgQueries', { h: snap.stats.windowHours })}</div>
            <div className="tile-value">{n(snap.stats.queries)}</div>
          </div>
          <div className="tile">
            <div className="tile-label">{t('adgBlocked')}</div>
            <div className="tile-value">{n(snap.stats.blocked)}</div>
            <div className="tile-sub">{fmtPct(snap.stats.blockedPct, 1)}</div>
          </div>
          <div className="tile">
            <div className="tile-label">{t('adgAvg')}</div>
            <div className="tile-value">{snap.stats.avgMs.toFixed(0)} ms</div>
          </div>
          <div className="tile">
            <div className="tile-label">{t('adgClients')}</div>
            <div className="tile-value">{snap.stats.clients}</div>
          </div>
        </div>
      )}

      <div className="cols">
        <div>
          <h3 className="sub">{t('adgTopBlocked')}</h3>
          {snap.topBlocked.length === 0 && <p className="note">{t('homeNothing')}</p>}
          <ul className="blocked">
            {snap.topBlocked.map((d) => (
              <li key={d.domain}>
                <div className="meter-row">
                  <strong className="domain">{d.domain}</strong>
                  <span className="num">{n(d.count)}</span>
                </div>
                <span className="mini-bar">
                  <i style={{ width: `${(d.count / maxBlocked) * 100}%` }} />
                </span>
                {d.clients.length > 0 && (
                  <p className="by">
                    {t('adgBy')}{' '}
                    {d.clients.map((c, i) => (
                      <span key={c.ip}>
                        {i > 0 && ', '}
                        <Who name={c.name} ip={c.ip} />
                        {c.count > 1 && <span className="dim"> ×{c.count}</span>}
                      </span>
                    ))}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="sub">{t('adgClientsTable')}</h3>
          {snap.errors.clients && <p className="note">{snap.errors.clients}</p>}
          <table className="grid">
            <thead>
              <tr>
                <th>{t('adgDevice')}</th>
                <th>{t('adgQueriesShort')}</th>
                <th title={t('adgBlockedHint')}>{t('adgBlocked')}</th>
              </tr>
            </thead>
            <tbody>
              {snap.clients.map((c) => (
                <tr key={c.ip}>
                  <td>
                    <Who name={c.name} ip={c.ip} />
                    {c.nameSource && c.name && <span className="dim small"> · {c.nameSource}</span>}
                  </td>
                  <td className="num">{n(c.queries)}</td>
                  <td className="num">{c.blocked > 0 ? n(c.blocked) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {unnamed && <p className="note">{t('adgUnnamedHint')}</p>}
        </div>
      </div>

      <div className="adg-recent-head">
        <h3 className="sub">{t('adgRecent')}</h3>
        <input value={filter} placeholder={t('homeFilter')} onChange={(e) => setFilter(e.target.value)} />
      </div>
      {snap.errors.querylog && <p className="note">{snap.errors.querylog}</p>}
      <div className="log-scroll">
        <table className="grid logs">
          <tbody>
            {recent.map((e, i) => (
              <tr key={`${e.time}-${i}`}>
                <td className="num nowrap">{e.time ? fmtClock(e.time / 1000, true) : ''}</td>
                <td className="nowrap">
                  <Who name={e.name} ip={e.ip} />
                </td>
                <td className="msg">
                  <strong>{e.domain}</strong>
                  {e.rule && <span className="dim small"> · {e.rule}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {recent.length === 0 && !snap.errors.querylog && <p className="note">{t('homeNothing')}</p>}
      </div>
    </section>
  )
}
