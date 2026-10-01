import { useState } from 'react'
import type { ProbeResult } from '../../shared/types'
import { errMsg, t } from '../i18n'
import { useStore } from '../store'

const TOKEN_ID = /^[^@\s!]{1,64}@[A-Za-z0-9._-]{1,32}![A-Za-z0-9._-]{2,64}$/
const SECRET = /^[A-Za-z0-9-]{8,128}$/
const HOST = /^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/

const HOWTO = `pveum user add olvezz@pve --comment "HomeLab Desktop"
pveum acl modify / --users olvezz@pve --roles PVEVMUser
pveum user token add olvezz@pve desktop --privsep 0`

// Primer uso / reconfiguración: host -> huella del certificado (TOFU) -> token
export function Wizard(): React.JSX.Element {
  const pve = useStore((s) => s.pve)
  const closeWizard = useStore((s) => s.closeWizard)

  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [host, setHost] = useState(pve?.host ?? '10.0.0.50')
  const [port, setPort] = useState(String(pve?.port ?? 8006))
  const [probe, setProbe] = useState<ProbeResult | null>(null)
  const [tokenId, setTokenId] = useState(pve?.tokenId ?? 'olvezz@pve!desktop')
  const [secret, setSecret] = useState('')
  const [interval, setInterval] = useState(pve?.pollIntervalSec ?? 10)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [tested, setTested] = useState('')

  const portNum = Number(port)

  const doProbe = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!HOST.test(host.trim()) || !Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      return setError(t('errHost'))
    }
    setBusy(true)
    setError('')
    try {
      setProbe(await window.api.pveProbe(host.trim(), portNum))
      setStep(2)
    } catch (err) {
      setError(errMsg(err))
    } finally {
      setBusy(false)
    }
  }

  const input = (): Parameters<typeof window.api.pveTest>[0] => ({
    host: host.trim(),
    port: portNum,
    tokenId: tokenId.trim(),
    secret: secret.trim(),
    fingerprint: probe?.fingerprint ?? '',
    pollIntervalSec: interval
  })

  const validToken = (): boolean => {
    if (!TOKEN_ID.test(tokenId.trim())) {
      setError(t('errTokenId'))
      return false
    }
    if (!SECRET.test(secret.trim())) {
      setError(t('errSecret'))
      return false
    }
    return true
  }

  const doTest = async (): Promise<void> => {
    if (!validToken()) return
    setBusy(true)
    setError('')
    setTested('')
    try {
      setTested(await window.api.pveTest(input()))
    } catch (err) {
      setError(errMsg(err))
    } finally {
      setBusy(false)
    }
  }

  const doSave = async (): Promise<void> => {
    if (!validToken()) return
    setBusy(true)
    try {
      await window.api.pveSave(input())
      setSecret('')
      closeWizard()
    } catch (err) {
      setError(errMsg(err))
      setBusy(false)
    }
  }

  return (
    <section className="settings wizard">
      <div className="settings-head">
        <h1>{t('wizardTitle')}</h1>
        <button className="btn" onClick={closeWizard}>
          {pve ? t('close') : t('wizardSkip')}
        </button>
      </div>
      <p className="hint">{t('wizardStep', { n: step })}</p>

      {step === 1 && (
        <form onSubmit={(e) => void doProbe(e)}>
          <div className="row">
            <label className="field grow">
              <span>{t('wizardHost')}</span>
              <input value={host} onChange={(e) => setHost(e.target.value)} autoFocus />
            </label>
            <label className="field port">
              <span>{t('wizardPort')}</span>
              <input value={port} inputMode="numeric" onChange={(e) => setPort(e.target.value)} />
            </label>
          </div>
          {error && <div className="error">{error}</div>}
          <div className="form-actions">
            <button type="submit" className="btn primary" disabled={busy}>
              {busy ? t('loading') : t('wizardProbe')}
            </button>
          </div>
        </form>
      )}

      {step === 2 && probe && (
        <div>
          <h2>{t('wizardCertTitle')}</h2>
          <p className="hint">{t('wizardCertBody')}</p>
          {probe.previous && <div className="error">{t('wizardCertChanged')}</div>}
          {probe.subject && (
            <>
              <div className="label">{t('wizardCertSubject')}</div>
              <code className="fingerprint">{probe.subject}</code>
            </>
          )}
          <div className="label">{t('certFingerprint')}</div>
          <code className="fingerprint">{probe.fingerprint}</code>
          {probe.previous && (
            <>
              <div className="label">{t('certPrevious')}</div>
              <code className="fingerprint">{probe.previous}</code>
            </>
          )}
          <div className="form-actions spaced">
            <button className="btn" onClick={() => setStep(1)}>
              {t('wizardBack')}
            </button>
            <button className="btn primary" onClick={() => setStep(3)}>
              {t('wizardTrust')}
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div>
          <h2>{t('wizardTokenTitle')}</h2>
          <details className="howto">
            <summary>{t('wizardHowTo')}</summary>
            <p className="hint">{t('wizardHowToBody')}</p>
            <pre>{HOWTO}</pre>
          </details>
          <label className="field">
            <span>{t('wizardTokenId')}</span>
            <input value={tokenId} onChange={(e) => setTokenId(e.target.value)} autoComplete="off" spellCheck={false} />
          </label>
          <label className="field">
            <span>{t('wizardTokenSecret')}</span>
            <input
              type="password"
              value={secret}
              onChange={(e) => {
                setSecret(e.target.value)
                setTested('')
              }}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <p className="hint">{t('wizardSecretNote')}</p>
          <label className="field inline">
            <span>{t('wizardInterval')}</span>
            <select value={interval} onChange={(e) => setInterval(Number(e.target.value))}>
              {[5, 10, 30, 60].map((n) => (
                <option key={n} value={n}>
                  {n} s
                </option>
              ))}
            </select>
          </label>
          {error && <div className="error">{error}</div>}
          {tested && <div className="ok">{t('wizardTestOk', { version: tested })}</div>}
          <div className="form-actions spaced">
            <button className="btn" onClick={() => setStep(2)}>
              {t('wizardBack')}
            </button>
            <button className="btn" disabled={busy || !secret} onClick={() => void doTest()}>
              {t('wizardTest')}
            </button>
            <button className="btn primary" disabled={busy || !tested} onClick={() => void doSave()}>
              {t('wizardSave')}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
