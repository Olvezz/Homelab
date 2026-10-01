import { useEffect, useMemo, useState } from 'react'
import type { Guest, LogLine, MonitorSnapshot, TaskInfo, Timeframe } from '../../shared/types'
import { fmtAgo, fmtBytes, fmtClock, fmtPct, fmtRate, fmtUptime, TASK_LABEL } from '../homeFormat'
import { errMsg, t } from '../i18n'
import { useStore } from '../store'
import { Meter, Sparkline, TimeChart } from './Charts'
import { guestIconKey, Icon } from './Icon'

const POLL_MS = 10_000

function Tile({ label, value, sub, spark, title }: { label: string; value: string; sub?: string; spark?: (number | undefined)[]; title?: string }): React.JSX.Element {
  return (
    <div className="tile" title={title}>
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      <div className="tile-foot">
        <span className="tile-sub">{sub}</span>
        {spark && <Sparkline values={spark} />}
      </div>
    </div>
  )
}

function Card({ title, aside, children, id }: { title: string; aside?: React.ReactNode; children: React.ReactNode; id?: string }): React.JSX.Element {
  return (
    <section className="card" id={id}>
      <header>
        <h2>{title}</h2>
        {aside}
      </header>
      {children}
    </section>
  )
}

const Note = ({ children }: { children: React.ReactNode }): React.JSX.Element => <p className="note">{children}</p>

// ---- Guests: mayores consumidores ----

type SortKey = 'cpu' | 'mem' | 'net' | 'disk'

function GuestsTable({ guests }: { guests: Guest[] }): React.JSX.Element {
  const [sort, setSort] = useState<SortKey>('cpu')
  const [all, setAll] = useState(false)
  const running = guests.filter((g) => g.status === 'running' && !g.template)
  const value = (g: Guest): number =>
    sort === 'cpu' ? g.cpu : sort === 'mem' ? (g.maxmem ? g.mem / g.maxmem : 0) : sort === 'net' ? g.netInRate + g.netOutRate : g.diskReadRate + g.diskWriteRate
  const sorted = [...running].sort((a, b) => value(b) - value(a))
  const shown = all ? sorted : sorted.slice(0, 8)
  const head = (key: SortKey, label: string): React.JSX.Element => (
    <th className={sort === key ? 'sorted' : ''} aria-sort={sort === key ? 'descending' : 'none'}>
      <button onClick={() => setSort(key)}>{label}</button>
    </th>
  )
  if (running.length === 0) return <Note>{t('homeNoRunning')}</Note>
  return (
    <>
      <table className="grid">
        <thead>
          <tr>
            <th>{t('homeGuest')}</th>
            {head('cpu', 'CPU')}
            {head('mem', 'RAM')}
            {head('net', t('homeNetwork'))}
            {head('disk', t('homeDiskIo'))}
          </tr>
        </thead>
        <tbody>
          {shown.map((g) => (
            <tr key={g.key}>
              <td className="who">
                <Icon k={guestIconKey(g)} size={15} />
                <span>
                  <span className="dim">{g.vmid}</span> {g.name}
                </span>
              </td>
              <td className="bar">
                <span className="num">{fmtPct(g.cpu, 1)}</span>
                <span className="mini-bar"><i style={{ width: `${Math.min(100, g.cpu * 100)}%` }} /></span>
              </td>
              <td className="bar">
                <span className="num">{fmtBytes(g.mem)}</span>
                <span className="mini-bar"><i style={{ width: `${g.maxmem ? Math.min(100, (g.mem / g.maxmem) * 100) : 0}%` }} /></span>
              </td>
              <td className="num" title={`↓ ${fmtRate(g.netInRate)} · ↑ ${fmtRate(g.netOutRate)}`}>
                ↓ {fmtRate(g.netInRate)}
                <br />
                ↑ {fmtRate(g.netOutRate)}
              </td>
              <td className="num" title={`${t('homeRead')} ${fmtRate(g.diskReadRate)} · ${t('homeWrite')} ${fmtRate(g.diskWriteRate)}`}>
                {t('homeRead')} {fmtRate(g.diskReadRate)}
                <br />
                {t('homeWrite')} {fmtRate(g.diskWriteRate)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {running.length > 8 && (
        <button className="link" onClick={() => setAll(!all)}>
          {all ? t('homeShowLess') : t('homeShowAll', { n: running.length })}
        </button>
      )}
    </>
  )
}

// ---- Registros ----

type LogTab = 'tasks' | 'cluster' | 'syslog'

function TaskResult({ task }: { task: TaskInfo }): React.JSX.Element {
  if (task.state === 'running') {
    return (
      <span className="chip run">
        <Icon k="ui:loader" size={12} className="spin" />
        {t('homeRunning')}
      </span>
    )
  }
  if (task.state === 'ok') {
    return (
      <span className="chip ok">
        <Icon k="ui:check" size={12} />
        {t('homeOk')}
      </span>
    )
  }
  return (
    <span className={`chip ${task.state === 'warn' ? 'warn' : 'bad'}`} title={task.status}>
      <Icon k="ui:alert" size={12} />
      {task.state === 'warn' ? t('homeWarning') : t('homeFailed')}
    </span>
  )
}

function Logs({ data, guests }: { data: MonitorSnapshot; guests: Guest[] }): React.JSX.Element {
  const [tab, setTab] = useState<LogTab>('tasks')
  const [filter, setFilter] = useState('')
  const [level, setLevel] = useState<'all' | 'warn' | 'error'>('all')
  const q = filter.trim().toLowerCase()
  const guestName = (id?: string): string => {
    const g = id ? guests.find((x) => String(x.vmid) === id) : undefined
    return g ? `${g.vmid} ${g.name}` : (id ?? '')
  }
  const levelOk = (l: LogLine['level']): boolean => level === 'all' || (level === 'warn' ? l !== 'info' : l === 'error')
  const lines = (tab === 'cluster' ? data.clusterLog : data.syslog).filter((l) => levelOk(l.level) && (!q || `${l.source} ${l.text}`.toLowerCase().includes(q)))
  const tasks = data.tasks.filter((x) => {
    const lvl = x.state === 'error' ? 'error' : x.state === 'warn' ? 'warn' : 'info'
    return levelOk(lvl) && (!q || `${x.type} ${TASK_LABEL[x.type] ?? ''} ${guestName(x.id)} ${x.user} ${x.status}`.toLowerCase().includes(q))
  })
  const err = tab === 'tasks' ? data.errors.tasks : tab === 'cluster' ? data.errors.clusterLog : data.errors.syslog

  return (
    <Card
      title={t('homeLogs')}
      id="home-logs"
      aside={
        <div className="log-tools">
          <div className="seg" role="tablist">
            {(['tasks', 'cluster', 'syslog'] as LogTab[]).map((k) => (
              <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
                {t(k === 'tasks' ? 'homeTasks' : k === 'cluster' ? 'homeClusterLog' : 'homeSyslog')}
              </button>
            ))}
          </div>
          <select value={level} onChange={(e) => setLevel(e.target.value as typeof level)} aria-label={t('homeLevel')}>
            <option value="all">{t('homeLevelAll')}</option>
            <option value="warn">{t('homeLevelWarn')}</option>
            <option value="error">{t('homeLevelError')}</option>
          </select>
          <input value={filter} placeholder={t('homeFilter')} onChange={(e) => setFilter(e.target.value)} />
        </div>
      }
    >
      {err && <Note>{err}</Note>}
      {tab === 'tasks' ? (
        <div className="log-scroll">
          <table className="grid logs">
            <tbody>
              {tasks.map((x) => (
                <tr key={x.upid}>
                  <td className="num nowrap">{fmtClock(x.start, true)}</td>
                  <td>{TASK_LABEL[x.type] ?? x.type}</td>
                  <td>{guestName(x.id)}</td>
                  <td className="dim">{x.user}</td>
                  <td>
                    <TaskResult task={x} />
                  </td>
                  <td className="num dim">{x.end ? `${Math.max(0, x.end - x.start)} s` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {tasks.length === 0 && !err && <Note>{t('homeNothing')}</Note>}
        </div>
      ) : (
        <div className="log-scroll">
          <table className="grid logs">
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} className={`lvl-${l.level}`}>
                  <td className="num nowrap">{l.time ? fmtClock(l.time, true) : ''}</td>
                  <td className="dim nowrap">{l.source}</td>
                  <td className="msg">
                    {l.level !== 'info' && <Icon k="ui:alert" size={12} />} {l.text}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {lines.length === 0 && !err && <Note>{t('homeNothing')}</Note>}
        </div>
      )}
    </Card>
  )
}

// ---- Página ----

export function Home(): React.JSX.Element {
  const snap = useStore((s) => s.snapshot)
  const pve = useStore((s) => s.pve)
  const openSettings = useStore((s) => s.openSettings)
  const openWizard = useStore((s) => s.openWizard)
  const showToast = useStore((s) => s.showToast)
  const [tf, setTf] = useState<Timeframe>('hour')
  const [nodeName, setNodeName] = useState<string>()
  const [data, setData] = useState<MonitorSnapshot | null>(null)
  const [, tick] = useState(0)

  const connected = snap.status === 'connected'
  const node = nodeName && snap.nodes.some((n) => n.name === nodeName) ? nodeName : snap.nodes[0]?.name

  const load = async (): Promise<void> => {
    if (!node) return
    try {
      setData(await window.api.getMonitor(node, tf))
    } catch (e) {
      showToast('error', errMsg(e))
    }
  }

  useEffect(() => {
    if (!node || !connected) return
    let alive = true
    const run = async (): Promise<void> => {
      if (document.hidden) return
      try {
        const d = await window.api.getMonitor(node, tf)
        if (alive) setData(d)
      } catch {
        // el siguiente ciclo lo reintenta
      }
    }
    void run()
    const id = setInterval(() => {
      void run()
      tick((n) => n + 1) // refresca el «hace X s»
    }, POLL_MS)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [node, tf, connected])

  const snapNode = snap.nodes.find((n) => n.name === node)
  const status = data?.status ?? null
  const hist = useMemo(() => data?.history ?? [], [data])
  const times = hist.map((p) => p.t)
  const last = hist[hist.length - 1]

  // Sin permiso para el estado del nodo no se inventan cifras del host: la CPU queda en «—» y la memoria
  // se resume con lo que usan los guests en ejecución
  const guestMem = snap.guests.filter((g) => g.status === 'running' && !g.template)
  const hostMem = status?.mem.total || snapNode?.maxmem || 0
  const cpu = status?.cpu ?? snapNode?.cpu
  const memUsed = hostMem ? (status?.mem.used ?? snapNode?.mem ?? 0) : guestMem.reduce((a, g) => a + g.mem, 0)
  const memTotal = hostMem || guestMem.reduce((a, g) => a + g.maxmem, 0)
  const memIsGuests = !hostMem && memTotal > 0
  const uptime = status?.uptime ?? snapNode?.uptime ?? 0
  const rootUsed = status?.rootfs.used ?? snapNode?.disk ?? 0
  const rootTotal = status?.rootfs.total ?? snapNode?.maxdisk ?? 0
  const guests = snap.guests.filter((g) => !g.template)
  const running = guests.filter((g) => g.status === 'running').length

  const needsPerm = data ? Object.values(data.errors).some((e) => e.includes('PVEAuditor')) : false
  const user = pve?.tokenId.split('!')[0] ?? 'usuario@pve'
  const permCmd = `pveum acl modify / --users ${user} --roles PVEAuditor`

  if (!connected && snap.status !== 'connecting') {
    return (
      <section className="home">
        <div className="ai-empty">
          <Icon k="ui:home" size={28} />
          <h2>{t('homeTitle')}</h2>
          <p>{snap.status === 'unconfigured' ? t('homeConnectHint') : (snap.message ?? t('statusOffline'))}</p>
          {snap.status === 'unconfigured' && (
            <button className="btn primary" onClick={openWizard}>
              {t('connectCta')}
            </button>
          )}
        </div>
      </section>
    )
  }

  const series = (name: string, color: string, pick: (p: (typeof hist)[number]) => number | undefined): { name: string; color: string; values: (number | undefined)[] } => ({
    name,
    color,
    values: hist.map(pick)
  })

  return (
    <section className="home">
      <div className="home-head">
        <div>
          <h1>{t('homeTitle')}</h1>
          <span className="dim">
            {node ? `${t('nodeLabel', { name: node })}` : ''} {data ? `· ${t('homeUpdated')} ${fmtAgo(data.updatedAt)}` : ''}
          </span>
        </div>
        <div className="home-tools">
          {snap.nodes.length > 1 && (
            <select value={node} onChange={(e) => setNodeName(e.target.value)} aria-label={t('homeNode')}>
              {snap.nodes.map((n) => (
                <option key={n.name} value={n.name}>
                  {n.name}
                </option>
              ))}
            </select>
          )}
          <div className="seg" role="tablist" aria-label={t('homePeriod')}>
            {([['hour', '1 h'], ['day', '24 h'], ['week', '7 d']] as [Timeframe, string][]).map(([k, label]) => (
              <button key={k} role="tab" aria-selected={tf === k} className={tf === k ? 'on' : ''} onClick={() => setTf(k)}>
                {label}
              </button>
            ))}
          </div>
          <button className="btn small" onClick={() => void load()}>
            {t('actRefresh')}
          </button>
        </div>
      </div>

      {needsPerm && (
        <div className="banner">
          <Icon k="ui:alert" size={16} />
          <div>
            <strong>{t('homePermTitle')}</strong>
            <p>{t('homePermBody')}</p>
            <code>{permCmd}</code>
          </div>
          <button className="btn small" onClick={() => void window.api.copyText(permCmd).then(() => showToast('ok', t('menuCopied')))}>
            {t('homeCopy')}
          </button>
        </div>
      )}

      <div className="tiles">
        <Tile label={t('homeUptime')} value={uptime ? fmtUptime(uptime) : '—'} sub={status ? `Proxmox ${status.pveVersion ?? ''}` : snapNode ? t('statusConnected') : ''} title={status?.kernel} />
        <Tile
          label="CPU"
          value={cpu !== undefined ? fmtPct(cpu, 1) : '—'}
          sub={status?.cores ? `${status.cores} ${t('homeCores')}${status.cpuModel ? ` · ${status.cpuModel.replace(/\(R\)|\(TM\)|CPU /g, '').trim()}` : ''}` : snapNode ? `${snapNode.maxcpu} ${t('homeCores')}` : ''}
          spark={hist.map((p) => p.cpu)}
          title={status?.cpuModel}
        />
        <Tile label={memIsGuests ? t('homeMemoryGuests') : t('homeMemory')} value={memTotal ? fmtPct(memUsed / memTotal, 1) : '—'} sub={memTotal ? `${fmtBytes(memUsed)} / ${fmtBytes(memTotal)}` : ''} spark={hist.map((p) => (p.memUsed !== undefined && p.memTotal ? p.memUsed / p.memTotal : undefined))} />
        <Tile
          label={t('homeLoad')}
          value={status ? status.load[0].toFixed(2) : last?.load !== undefined ? last.load.toFixed(2) : '—'}
          sub={status ? `5 min ${status.load[1].toFixed(2)} · 15 min ${status.load[2].toFixed(2)}` : '1 min'}
          spark={hist.map((p) => p.load)}
        />
        <Tile label={t('homeRootDisk')} value={rootTotal ? fmtPct(rootUsed / rootTotal) : '—'} sub={rootTotal ? `${fmtBytes(rootUsed)} / ${fmtBytes(rootTotal)}` : ''} />
        <Tile
          label={t('homeNetwork')}
          value={last?.netIn !== undefined ? `↓ ${fmtRate(last.netIn)}` : '—'}
          sub={last?.netOut !== undefined ? `↑ ${fmtRate(last.netOut)}` : ''}
          spark={hist.map((p) => p.netIn)}
          title={t('homeNodeTraffic')}
        />
        <Tile label={t('homeGuests')} value={`${running}/${guests.length}`} sub={`${guests.length - running} ${t('homeStopped')}`} />
      </div>

      <div className="charts">
        <TimeChart
          title={t('homeCpuUse')}
          timeframe={tf}
          times={times}
          format={(v) => fmtPct(v, v < 0.1 ? 1 : 0)}
          series={[series('CPU', 'var(--series-1)', (p) => p.cpu), series(t('homeIoWait'), 'var(--series-2)', (p) => p.ioWait)]}
        />
        <TimeChart
          title={t('homeMemory')}
          subtitle={memTotal ? `${t('homeTotal')} ${fmtBytes(memTotal)}` : undefined}
          timeframe={tf}
          times={times}
          format={fmtBytes}
          yMax={memTotal || undefined}
          area
          series={[series(t('homeUsed'), 'var(--series-1)', (p) => p.memUsed)]}
        />
        <TimeChart
          title={t('homeNetworkTraffic')}
          timeframe={tf}
          times={times}
          format={fmtRate}
          series={[series(t('homeIn'), 'var(--series-1)', (p) => p.netIn), series(t('homeOut'), 'var(--series-2)', (p) => p.netOut)]}
        />
        <TimeChart title={t('homeLoadAvg')} timeframe={tf} times={times} format={(v) => v.toFixed(2)} series={[series(t('homeLoad'), 'var(--series-1)', (p) => p.load)]} area />
      </div>

      <div className="cols">
        <Card title={t('homeTopGuests')}>
          <GuestsTable guests={snap.guests} />
        </Card>
        <Card title={t('homeStorage')}>
          {data?.errors.storage && <Note>{data.errors.storage}</Note>}
          <ul className="meters">
            {(data?.storage ?? []).filter((s) => s.active && s.total > 0).map((s) => (
              <li key={s.id}>
                <div className="meter-row">
                  <span>
                    <strong>{s.id}</strong> <span className="dim">{s.type}</span>
                  </span>
                  <span className="num">{fmtBytes(s.used)} / {fmtBytes(s.total)} · {fmtPct(s.used / s.total)}</span>
                </div>
                <Meter value={s.used / s.total} label={s.id} />
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="cols three">
        <Card title={t('homeServices')}>
          {data?.errors.services ? (
            <Note>{data.errors.services}</Note>
          ) : (
            <>
              <p className="big">
                {data?.services.filter((s) => s.running).length ?? 0}/{data?.services.length ?? 0} <span className="dim">{t('homeActive')}</span>
              </p>
              <ul className="plain">
                {(data?.services ?? []).filter((s) => !s.running).slice(0, 8).map((s) => (
                  <li key={s.name} className="bad">
                    <Icon k="ui:alert" size={13} /> {s.name} <span className="dim">{t('homeDown')}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
        <Card title={t('homeUpdates')}>
          {data?.errors.updates ? (
            <Note>{data.errors.updates}</Note>
          ) : data?.updates ? (
            <>
              <p className="big">
                {data.updates.count} <span className="dim">{t('homePending')}</span>
              </p>
              {data.updates.count > 0 && (
                <details>
                  <summary>{t('homeViewList')}</summary>
                  <p className="pkgs">{data.updates.packages.join(', ')}</p>
                </details>
              )}
            </>
          ) : null}
        </Card>
        <Card title={t('homeDisks')}>
          {data?.errors.disks ? (
            <Note>{data.errors.disks}</Note>
          ) : (
            <ul className="plain">
              {(data?.disks ?? []).map((d) => (
                <li key={d.dev} className={d.health === 'PASSED' || d.health === 'OK' ? '' : 'warn'}>
                  <Icon k={d.health === 'PASSED' || d.health === 'OK' ? 'ui:check' : 'ui:alert'} size={13} /> {d.dev.replace('/dev/', '')} <span className="dim">{d.model || d.type} · {fmtBytes(d.size)}</span>
                  <span className="dim"> · {d.health === 'PASSED' || d.health === 'OK' ? 'SMART OK' : d.health}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {snap.diagnostics.length > 0 && (
        <Card title={t('homeWarnings')}>
          <ul className="plain">
            {snap.diagnostics.slice(0, 6).map((d, i) => (
              <li key={i} className="warn">
                <Icon k="ui:alert" size={13} /> {d.vmid ? `${d.vmid} ${d.guest ?? ''}: ` : ''}
                {d.text}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title={t('homeProcesses')} aside={<span className="dim small">{t('homeProcessesHint')}</span>}>
        {data?.errors.processes === 'no-configurado' ? (
          <>
            <Note>{t('homeProcessesSetup')}</Note>
            <button className="btn small" onClick={() => openSettings('monitor-section')}>
              {t('homeConfigure')}
            </button>
          </>
        ) : data?.errors.processes ? (
          <Note>{data.errors.processes}</Note>
        ) : (
          <table className="grid">
            <thead>
              <tr>
                <th>PID</th>
                <th>{t('homeUser')}</th>
                <th>{t('homeCommand')}</th>
                <th>CPU</th>
                <th>RAM</th>
                <th>{t('homeActiveFor')}</th>
              </tr>
            </thead>
            <tbody>
              {(data?.processes ?? []).map((p) => (
                <tr key={p.pid}>
                  <td className="num dim">{p.pid}</td>
                  <td className="dim">{p.user}</td>
                  <td>{p.command}</td>
                  <td className="bar">
                    <span className="num">{p.cpu.toFixed(1)} %</span>
                    <span className="mini-bar"><i style={{ width: `${Math.min(100, p.cpu)}%` }} /></span>
                  </td>
                  <td className="bar">
                    <span className="num">{p.mem.toFixed(1)} %</span>
                    <span className="mini-bar"><i style={{ width: `${Math.min(100, p.mem)}%` }} /></span>
                  </td>
                  <td className="num dim">{p.elapsed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {data && <Logs data={data} guests={snap.guests} />}
    </section>
  )
}
