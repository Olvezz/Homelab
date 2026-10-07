import { useEffect, useMemo, useRef, useState } from 'react'
import type { Guest, NodeInfo, Panel } from '../../shared/types'
import { buildMap, linkTargets, MAP_KINDS, type MapKind, type MapNodeType } from '../../shared/map'
import { errMsg, t, type Key } from '../i18n'
import { fmtBytes, fmtRate, fmtUptime } from '../homeFormat'
import { mapInputOf, resolvePanel, useStore } from '../store'
import { MapEngine, NODE_COLORS, VIEW_MODES, type SimNode, type ViewMode } from '../mapEngine'

const TYPE_KEY: Record<MapNodeType, Key> = {
  root: 'mapTypeRoot',
  net: 'mapTypeNet',
  folder: 'mapTypeFolder',
  node: 'mapTypeNode',
  vm: 'mapTypeVm',
  lxc: 'mapTypeLxc',
  device: 'mapTypeDevice',
  service: 'mapTypeService',
  ext: 'mapTypeExt'
}

export const KIND_KEY: Record<MapKind, Key> = {
  service: 'mapKindService',
  router: 'mapKindRouter',
  switch: 'mapKindSwitch',
  ap: 'mapKindAp',
  nas: 'mapKindNas',
  other: 'mapKindOther'
}

const VIEW_KEY: Record<ViewMode, { label: Key; hint: Key }> = {
  tree: { label: 'mapViewTree', hint: 'mapViewTreeHint' },
  web: { label: 'mapViewWeb', hint: 'mapViewWebHint' },
  vertical: { label: 'mapViewVertical', hint: 'mapViewVerticalHint' },
  blocks: { label: 'mapViewBlocks', hint: 'mapViewBlocksHint' }
}

interface Grouping {
  tags: boolean
  folders: boolean
}
const GROUP_KEY = 'homelab.map.grouping'
const MODE_KEY = 'homelab.map.view'

function loadGrouping(): Grouping {
  try {
    const raw = JSON.parse(localStorage.getItem(GROUP_KEY) ?? '')
    return { tags: raw.tags !== false, folders: raw.folders !== false }
  } catch {
    return { tags: true, folders: true }
  }
}

function loadMode(): ViewMode {
  try {
    const v = localStorage.getItem(MODE_KEY)
    return VIEW_MODES.includes(v as ViewMode) ? (v as ViewMode) : 'tree'
  } catch {
    return 'tree'
  }
}

// Entrada del mapa a partir del estado de la app (se recalcula solo cuando cambia algo relevante)
function useMapInput(group: Grouping = { tags: false, folders: false }): ReturnType<typeof mapInputOf> {
  const pve = useStore((s) => s.pve)
  const snapshot = useStore((s) => s.snapshot)
  const panels = useStore((s) => s.panels)
  const layout = useStore((s) => s.layout)
  const ui = useStore((s) => s.ui)
  return useMemo(() => mapInputOf({ pve, snapshot, panels, layout, ui }, group), [pve, snapshot, panels, layout, ui, group.tags, group.folders])
}

// Selector «Conectado a»: red, nodo, máquina, dispositivo o carpeta (se usa al crear un panel y en el panel lateral del mapa)
export function LinkSelect({ value, onChange, selfId }: { value: string; onChange: (v: string) => void; selfId?: string }): React.JSX.Element {
  const input = useMapInput()
  const targets = useMemo(() => linkTargets(input, selfId), [input, selfId])
  const groups = [...new Set(targets.map((x) => x.group))]
  const known = !value || targets.some((x) => x.value === value)
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{t('mapLinkAuto')}</option>
      {!known && <option value={value}>{t('mapLinkMissing')}</option>}
      {groups.map((g) => (
        <optgroup key={g} label={g}>
          {targets
            .filter((x) => x.group === g)
            .map((x) => (
              <option key={x.value} value={x.value}>
                {x.label}
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  )
}

export function KindSelect({ value, onChange }: { value: MapKind; onChange: (v: MapKind) => void }): React.JSX.Element {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as MapKind)}>
      {MAP_KINDS.map((k) => (
        <option key={k} value={k}>
          {t(KIND_KEY[k])}
        </option>
      ))}
    </select>
  )
}

// Abre lo que representa un nodo: su panel, o la máquina (su único panel o su ficha en Proxmox)
function openNode(n: SimNode): void {
  const s = useStore.getState()
  if (n.panelId) {
    s.selectPanel(n.panelId)
    return
  }
  const g = n.guestKey ? s.snapshot.guests.find((x) => x.key === n.guestKey) : undefined
  if (!g) return
  if (g.panels.length === 1) s.selectPanel(resolvePanel(s.panels, g.panels[0]).id)
  else void s.openInPve(g)
}

// ---- Consumo y estado de lo seleccionado ----

const isLeaf = (n: { url?: string; type: MapNodeType }): boolean => !!n.url && (n.type === 'service' || n.type === 'ext' || n.type === 'device')

type Host = { kind: 'guest'; guest: Guest } | { kind: 'node'; info: NodeInfo }

// Dónde se ejecuta cada servicio: la máquina (VM/LXC) o el nodo de Proxmox de que cuelga
function hostOf(engine: MapEngine, n: SimNode, guests: Guest[], nodes: NodeInfo[]): Host | null {
  for (const a of engine.ancestors(n)) {
    if (a.guestKey) {
      const g = guests.find((x) => x.key === a.guestKey)
      if (g) return { kind: 'guest', guest: g }
    }
    if (a.type === 'node') {
      const info = nodes.find((x) => `n:${x.name}` === a.id)
      if (info) return { kind: 'node', info }
    }
  }
  // Un servicio dentro de una carpeta del usuario no cuelga de su máquina: se busca por su IP
  if (n.ip) {
    const g = guests.find((x) => x.ips.includes(n.ip!))
    if (g) return { kind: 'guest', guest: g }
  }
  return null
}

function level(f: number): string {
  return f > 0.85 ? 'bad' : f > 0.65 ? 'warn' : 'ok'
}

function Meter({ label, fraction, text }: { label: string; fraction: number; text: string }): React.JSX.Element {
  const f = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0))
  return (
    <div className="res-meter">
      <span className="res-meter-label">{label}</span>
      <div className="res-meter-bar">
        <span className={level(f)} style={{ width: `${Math.round(f * 100)}%` }} />
      </div>
      <span className="res-meter-text">{text}</span>
    </div>
  )
}

// Ficha de recursos de una máquina o nodo (al estilo de la vista de Pulse): estado, CPU, RAM, disco y red
function ResourceCard({ host, serves }: { host: Host; serves?: number }): React.JSX.Element {
  if (host.kind === 'node') {
    const n = host.info
    return (
      <div className="res-card">
        <div className="res-head">
          <span className={`dot ${n.online ? 'running' : 'stopped'}`} />
          <b>{t('mapNodeCard', { name: n.name })}</b>
          <small>{n.online ? t('mapOn') : t('mapOff')}</small>
        </div>
        {n.online ? (
          <>
            <Meter label={t('mapCpu')} fraction={n.cpu} text={`${Math.round(n.cpu * 100)} %`} />
            <Meter label={t('mapRam')} fraction={n.maxmem ? n.mem / n.maxmem : 0} text={`${fmtBytes(n.mem)} / ${fmtBytes(n.maxmem)}`} />
            <Meter label={t('mapDisk')} fraction={n.maxdisk ? n.disk / n.maxdisk : 0} text={`${fmtBytes(n.disk)} / ${fmtBytes(n.maxdisk)}`} />
            <div className="res-foot">
              {t('mapUptimeLabel')} {fmtUptime(n.uptime)}
            </div>
          </>
        ) : null}
      </div>
    )
  }
  const g = host.guest
  const running = g.status === 'running'
  return (
    <div className="res-card">
      <div className="res-head">
        <span className={`dot ${running ? 'running' : g.status === 'stopped' ? 'stopped' : 'unknown'}`} />
        <b>
          {g.vmid} {g.name}
        </b>
        <small>{g.type === 'lxc' ? 'LXC' : 'VM'}</small>
      </div>
      {serves !== undefined && serves > 0 && <div className="res-foot">{t('mapServes', { n: serves })}</div>}
      {running ? (
        <>
          <Meter label={t('mapCpu')} fraction={g.cpu} text={`${Math.round(g.cpu * 100)} % · ${g.maxcpu} vCPU`} />
          <Meter label={t('mapRam')} fraction={g.maxmem ? g.mem / g.maxmem : 0} text={`${fmtBytes(g.mem)} / ${fmtBytes(g.maxmem)}`} />
          {g.maxdisk > 0 && <Meter label={t('mapDisk')} fraction={g.disk / g.maxdisk} text={`${fmtBytes(g.disk)} / ${fmtBytes(g.maxdisk)}`} />}
          <div className="res-foot">
            ↓ {fmtRate(g.netInRate)} · ↑ {fmtRate(g.netOutRate)} · {t('mapUptimeLabel')} {fmtUptime(g.uptime)}
          </div>
        </>
      ) : (
        <div className="res-foot">{g.status === 'stopped' ? t('mapOff') : t('mapUnknown')}</div>
      )}
    </div>
  )
}

interface Load {
  cpu: number // fracción 0-1
  mem: number
  memText: string
  count: number // máquinas encendidas que suman
}

// Consumo de un elemento: el de su nodo o máquina, o la suma de las máquinas encendidas que contiene (carpeta, tag, red)
function loadOf(engine: MapEngine, n: SimNode, guests: Guest[], nodes: NodeInfo[]): Load | null {
  if (n.type === 'node') {
    const info = nodes.find((x) => `n:${x.name}` === n.id)
    if (!info?.online) return null
    return { cpu: info.cpu, mem: info.maxmem ? info.mem / info.maxmem : 0, memText: `${fmtBytes(info.mem)} / ${fmtBytes(info.maxmem)}`, count: 1 }
  }
  const found = [n, ...engine.descendants(n)]
    .map((x) => (x.guestKey ? guests.find((g) => g.key === x.guestKey) : undefined))
    .filter((g): g is Guest => !!g && g.status === 'running')
  if (found.length === 0) return null
  const cores = found.reduce((s, g) => s + g.maxcpu, 0)
  const mem = found.reduce((s, g) => s + g.mem, 0)
  const maxmem = found.reduce((s, g) => s + g.maxmem, 0)
  return {
    cpu: cores ? found.reduce((s, g) => s + g.cpu * g.maxcpu, 0) / cores : 0,
    mem: maxmem ? mem / maxmem : 0,
    memText: `${fmtBytes(mem)} / ${fmtBytes(maxmem)}`,
    count: found.length
  }
}

const MAX_CARDS = 8

// Lo que se está consumiendo dentro del nodo seleccionado: máquinas que alojan sus servicios, y estado de cada servicio
function Usage({ engine, n, guests, nodes }: { engine: MapEngine; n: SimNode; guests: Guest[]; nodes: NodeInfo[] }): React.JSX.Element | null {
  const all = [n, ...engine.descendants(n)]
  const services = all.filter(isLeaf)
  const hosts = new Map<string, { host: Host; serves: number }>()
  const add = (h: Host | null, serves: number): void => {
    if (!h) return
    const key = h.kind === 'guest' ? `g:${h.guest.key}` : `n:${h.info.name}`
    const cur = hosts.get(key)
    if (cur) cur.serves += serves
    else hosts.set(key, { host: h, serves })
  }
  // la propia máquina o nodo seleccionados, y las máquinas que contiene (tag, nodo)
  for (const x of all) {
    if (x.guestKey) {
      const g = guests.find((y) => y.key === x.guestKey)
      if (g) add({ kind: 'guest', guest: g }, 0)
    } else if (x.type === 'node') {
      const info = nodes.find((y) => `n:${y.name}` === x.id)
      if (info) add({ kind: 'node', info }, 0)
    }
  }
  for (const s of services) add(hostOf(engine, s, guests, nodes), 1)

  const cards = [...hosts.values()]
  const up = services.filter((s) => s.status === 'running').length
  const down = services.filter((s) => s.status === 'stopped').length
  if (cards.length === 0 && services.length === 0) return null
  return (
    <>
      {cards.length > 0 && (
        <>
          <h3 className="map-sub">{t('mapRes')}</h3>
          <div className="res-list">
            {cards.slice(0, MAX_CARDS).map((c) => (
              <ResourceCard key={c.host.kind === 'guest' ? c.host.guest.key : c.host.info.name} host={c.host} serves={c.serves} />
            ))}
            {cards.length > MAX_CARDS && <small className="dim">{t('mapMore', { n: cards.length - MAX_CARDS })}</small>}
          </div>
        </>
      )}
      {services.length > 0 && (
        <>
          <h3 className="map-sub">
            {t('mapServices')} · {t('mapServicesUp', { up, total: services.length })}
            {down > 0 && <span className="down-count"> · {t('mapDownCount', { n: down })}</span>}
          </h3>
          <div className="svc-list">
            {services.slice(0, 40).map((s) => (
              <button key={s.id} className="svc" onClick={() => openNode(s)} title={s.url}>
                <span className={`dot ${s.status === 'running' ? 'running' : s.status === 'stopped' ? 'stopped' : 'unknown'}`} />
                <span className="svc-name">{s.label}</span>
                <small>{s.port ? `:${s.port}` : ''}</small>
                <small className="svc-state">{s.status === 'running' ? t('mapOn') : s.status === 'stopped' ? t('mapOff') : t('mapUnknown')}</small>
              </button>
            ))}
            {services.length > 40 && <small className="dim">{t('mapMore', { n: services.length - 40 })}</small>}
          </div>
        </>
      )}
    </>
  )
}

export function NetworkMap(): React.JSX.Element {
  const [group, setGroup] = useState<Grouping>(loadGrouping)
  const [mode, setModeState] = useState<ViewMode>(loadMode)
  const input = useMapInput(group)
  const nodes = useMemo(() => buildMap(input), [input])
  // Solo se recarga el grafo si el contenido cambió de verdad (los sondeos de Proxmox renuevan el estado cada pocos segundos)
  const sig = useMemo(() => JSON.stringify(nodes), [nodes])
  const panels = useStore((s) => s.panels)
  const snapshot = useStore((s) => s.snapshot)
  const saveManualPanels = useStore((s) => s.saveManualPanels)
  const showToast = useStore((s) => s.showToast)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<MapEngine | null>(null)
  const latest = useRef(nodes)
  latest.current = nodes
  const [selected, setSelected] = useState<SimNode | null>(null)
  const [tip, setTip] = useState<{ n: SimNode; x: number; y: number } | null>(null)
  const [, redraw] = useState(0)
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const refreshTick = useStore((st) => st.refreshTick)

  useEffect(() => {
    const engine = new MapEngine(canvasRef.current!, {
      onSelect: setSelected,
      onActivate: openNode,
      onHover: (n, x, y) => setTip(n ? { n, x, y } : null),
      onChange: () => redraw((v) => v + 1)
    })
    engine.mode = loadMode()
    engineRef.current = engine
    engine.setNodes(latest.current)
    return () => {
      engine.destroy()
      engineRef.current = null
    }
  }, [])

  useEffect(() => {
    engineRef.current?.setNodes(latest.current)
  }, [sig])

  // ¿Están encendidos los servicios? Se comprueba cada 20 s mientras el mapa está abierto
  useEffect(() => {
    let alive = true
    const run = (): void => {
      const urls = [...new Set(latest.current.filter(isLeaf).map((n) => n.url!))].slice(0, 80)
      if (urls.length === 0) return
      window.api
        .probeUrls(urls)
        .then((r) => {
          if (alive) engineRef.current?.setProbe(r)
        })
        .catch(() => undefined)
    }
    run()
    const id = setInterval(run, 20_000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [sig, refreshTick])

  const engine = engineRef.current
  const changeGroup = (g: Grouping): void => {
    setGroup(g)
    try {
      localStorage.setItem(GROUP_KEY, JSON.stringify(g))
    } catch {
      // sin almacenamiento: la opción vale solo en esta sesión
    }
  }
  const changeMode = (m: ViewMode): void => {
    setModeState(m)
    engineRef.current?.setMode(m)
    try {
      localStorage.setItem(MODE_KEY, m)
    } catch {
      // sin almacenamiento: la vista vale solo en esta sesión
    }
  }

  // Teclado del mapa: Esc quita la selección; / o Ctrl+F busca; 0 reencuadra; + y - zoom; 1-4 vistas; R reinicia; E y C expanden y colapsan; Intro abre
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const eng = engineRef.current
      const el = e.target as HTMLElement | null
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
      if (!eng) return
      if (e.key === 'Escape') {
        if (typing && el === searchRef.current && searchRef.current?.value) {
          setQuery('')
          eng.search('')
          return
        }
        if (typing) el?.blur()
        eng.select(null)
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
        return
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return
      const key = e.key.toLowerCase()
      const mode = ['1', '2', '3', '4'].indexOf(key)
      if (key === '/') {
        e.preventDefault()
        searchRef.current?.focus()
      } else if (key === '0' || key === 'home') eng.fit()
      else if (key === '+' || key === '=') eng.zoom(1.2)
      else if (key === '-') eng.zoom(1 / 1.2)
      else if (mode >= 0) changeMode(VIEW_MODES[mode])
      else if (key === 'r') eng.reset()
      else if (key === 'e') eng.expandAll()
      else if (key === 'c') eng.collapse()
      else if (key === 'enter' && eng.current) {
        if (eng.current.panelId || eng.current.guestKey) openNode(eng.current)
        else if (eng.current.children.length) eng.toggle(eng.current)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // changeMode solo usa el motor y un setter: no hace falta recrear el listener
  }, [])

  const manual = panels.filter((p) => p.source === 'manual' && p.kind !== 'tab')
  const editPanel = (id: string, patch: Partial<Pick<Panel, 'mapKind' | 'mapLink'>>): void => {
    void saveManualPanels(manual.map((p) => (p.id === id ? { ...p, ...patch } : p))).catch((e) => showToast('error', errMsg(e)))
  }

  const services = nodes.filter((n) => n.type === 'service' || n.type === 'ext' || n.type === 'device').length
  const machines = nodes.filter((n) => n.type === 'vm' || n.type === 'lxc').length

  const side = ((): React.JSX.Element => {
    if (!selected || !engine) {
      return (
        <>
          <h2>{t('mapTitle')}</h2>
          <div className="crumb">{t('mapSubtitle')}</div>
          <p className="hint">{t('mapIntro')}</p>
          <div className="kv">
            <span>{t('mapCountMachines')}</span>
            <span>{machines}</span>
            <span>{t('mapCountServices')}</span>
            <span>{services}</span>
            <span>{t('mapCountVisible')}</span>
            <span>{engine?.visibleCount() ?? 0}</span>
          </div>
        </>
      )
    }
    const n = selected
    const path = [...engine.ancestors(n).reverse(), n].map((x) => x.label).join('  ›  ')
    const own = n.panelId ? manual.find((p) => p.id === n.panelId) : undefined
    const canOpen = !!n.panelId || !!n.guestKey
    const others = n.children.filter((c) => !isLeaf(c)) // lo que no es servicio (carpetas, máquinas) sigue en «Contiene»
    return (
      <>
        <h2>{n.label}</h2>
        <div className="crumb">{path}</div>
        <div className="kv">
          <span>{t('mapType')}</span>
          <span>{n.deviceKind ? t(KIND_KEY[n.deviceKind]) : t(TYPE_KEY[n.type])}</span>
          {n.vmid !== undefined && (
            <>
              <span>ID</span>
              <span>{n.vmid}</span>
            </>
          )}
          {n.ip && (
            <>
              <span>IP</span>
              <code>{n.ip}</code>
            </>
          )}
          {n.port && (
            <>
              <span>{t('mapPort')}</span>
              <code>{n.port}</code>
            </>
          )}
          {n.status !== 'unknown' && (
            <>
              <span>{t('mapState')}</span>
              <span>{n.status === 'running' ? t('mapOnDot') : t('mapOff')}</span>
            </>
          )}
          {n.url && (
            <>
              <span>URL</span>
              <code className="wrap">{n.url}</code>
            </>
          )}
        </div>
        <div className="map-actions">
          {canOpen && (
            <button className="btn primary small" onClick={() => openNode(n)}>
              {t('mapOpen')}
            </button>
          )}
          {n.children.length > 0 && (
            <button className="btn small" onClick={() => engine.toggle(n)}>
              {n.expanded ? t('mapCollapseOne') : t('mapExpandOne')}
            </button>
          )}
        </div>
        {n.type !== 'root' && n.type !== 'net' && <Usage engine={engine} n={n} guests={snapshot.guests} nodes={snapshot.nodes} />}
        {own && (
          <div className="map-edit">
            <label className="field">
              <span>{t('mapKindLabel')}</span>
              <KindSelect value={own.mapKind ?? 'service'} onChange={(k) => editPanel(own.id, { mapKind: k === 'service' ? undefined : k })} />
            </label>
            <label className="field">
              <span>{t('mapLinkLabel')}</span>
              <LinkSelect value={own.mapLink ?? ''} selfId={own.id} onChange={(v) => editPanel(own.id, { mapLink: v || undefined })} />
            </label>
          </div>
        )}
        {others.length > 0 && (
          <>
            <h3 className="map-sub">
              {t('mapContains')} ({others.length})
            </h3>
            <div className="kids">
              {others.map((c) => {
                const load = loadOf(engine, c, snapshot.guests, snapshot.nodes)
                return (
                  <button
                    key={c.id}
                    className="kid"
                    onClick={() => {
                      engine.toggle(n, true)
                      engine.select(c)
                    }}
                  >
                    <span className="kid-top">
                      <span className="dot" style={{ background: NODE_COLORS[c.type] }} />
                      <span className="kid-name">{c.label}</span>
                      <small>{c.deviceKind ? t(KIND_KEY[c.deviceKind]) : t(TYPE_KEY[c.type])}</small>
                      <small>{c.children.length ? `${c.children.length} ›` : ''}</small>
                    </span>
                    {load && (
                      <>
                        <Meter label={t('mapCpu')} fraction={load.cpu} text={`${Math.round(load.cpu * 100)} %`} />
                        <Meter label={t('mapRam')} fraction={load.mem} text={load.memText} />
                      </>
                    )}
                  </button>
                )
              })}
            </div>
          </>
        )}
      </>
    )
  })()

  const empty = nodes.length <= 1

  return (
    <section className="map">
      <header className="map-bar">
        <h1>{t('mapTitle')}</h1>
        <input
          ref={searchRef}
          value={query}
          placeholder={t('mapSearch')}
          aria-label={t('mapSearch')}
          onChange={(e) => {
            setQuery(e.target.value)
            engine?.search(e.target.value)
          }}
        />
        <div className="seg" role="group" aria-label={t('mapView')}>
          {VIEW_MODES.map((m) => (
            <button key={m} className={mode === m ? 'on' : ''} aria-pressed={mode === m} title={t(VIEW_KEY[m].hint)} onClick={() => changeMode(m)}>
              {t(VIEW_KEY[m].label)}
            </button>
          ))}
        </div>
        <label className="map-check" title={t('mapGroupTagsHint')}>
          <input type="checkbox" checked={group.tags} onChange={(e) => changeGroup({ ...group, tags: e.target.checked })} />
          {t('mapGroupTags')}
        </label>
        <label className="map-check" title={t('mapGroupFoldersHint')}>
          <input type="checkbox" checked={group.folders} onChange={(e) => changeGroup({ ...group, folders: e.target.checked })} />
          {t('mapGroupFolders')}
        </label>
        <button className="btn small" onClick={() => engine?.expandAll()}>
          {t('mapExpandAll')}
        </button>
        <button className="btn small" onClick={() => engine?.collapse()}>
          {t('mapCollapse')}
        </button>
        <button className="btn small" onClick={() => engine?.reset()} title={t('mapResetHint')}>
          {t('mapReset')}
        </button>
        <button className="btn small primary" onClick={() => engine?.fit()}>
          {t('mapFit')}
        </button>
        <span className="map-beta">{t('mapBeta')}</span>
      </header>
      <div className="map-stage">
        <canvas ref={canvasRef} aria-label={t('mapTitle')} />
        {empty && <div className="map-empty">{t('mapEmpty')}</div>}
        {tip && (
          <div className="map-tip" style={{ left: Math.min(tip.x + 14, 9999), top: tip.y + 14 }}>
            <b>{tip.n.label}</b>
            {tip.n.deviceKind ? t(KIND_KEY[tip.n.deviceKind]) : t(TYPE_KEY[tip.n.type])}
            {tip.n.ip && (
              <>
                <br />
                <code>
                  {tip.n.ip}
                  {tip.n.port ? `:${tip.n.port}` : ''}
                </code>
              </>
            )}
            {tip.n.children.length > 0 && (
              <>
                <br />
                {t('mapInside', { n: tip.n.children.length })}
              </>
            )}
          </div>
        )}
        <div className="map-legend">
          {(['node', 'vm', 'lxc', 'device', 'folder', 'service', 'ext'] as MapNodeType[]).map((k) => (
            <div key={k}>
              <i style={{ background: NODE_COLORS[k] }} />
              {t(TYPE_KEY[k])}
            </div>
          ))}
          <div>
            <i style={{ background: '#6b7280' }} />
            {t('mapOff')}
          </div>
        </div>
        <div className="map-hint">{t('mapHint')}</div>
      </div>
      <aside className="map-side">{side}</aside>
    </section>
  )
}
