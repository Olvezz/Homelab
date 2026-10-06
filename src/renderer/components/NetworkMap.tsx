import { useEffect, useMemo, useRef, useState } from 'react'
import type { Panel } from '../../shared/types'
import { buildMap, linkTargets, MAP_KINDS, type MapKind, type MapNodeType } from '../../shared/map'
import { errMsg, t, type Key } from '../i18n'
import { mapInputOf, resolvePanel, useStore } from '../store'
import { MapEngine, NODE_COLORS, type SimNode } from '../mapEngine'

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

// Entrada del mapa a partir del estado de la app (se recalcula solo cuando cambia algo relevante)
function useMapInput(): ReturnType<typeof mapInputOf> {
  const pve = useStore((s) => s.pve)
  const snapshot = useStore((s) => s.snapshot)
  const panels = useStore((s) => s.panels)
  const layout = useStore((s) => s.layout)
  const ui = useStore((s) => s.ui)
  return useMemo(() => mapInputOf({ pve, snapshot, panels, layout, ui }), [pve, snapshot, panels, layout, ui])
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

export function NetworkMap(): React.JSX.Element {
  const input = useMapInput()
  const nodes = useMemo(() => buildMap(input), [input])
  // Solo se recarga el grafo si el contenido cambió de verdad (los sondeos de Proxmox renuevan el estado cada pocos segundos)
  const sig = useMemo(() => JSON.stringify(nodes), [nodes])
  const panels = useStore((s) => s.panels)
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

  useEffect(() => {
    const engine = new MapEngine(canvasRef.current!, {
      onSelect: setSelected,
      onActivate: openNode,
      onHover: (n, x, y) => setTip(n ? { n, x, y } : null),
      onChange: () => redraw((v) => v + 1)
    })
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

  const engine = engineRef.current
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
              <span>{n.status === 'running' ? t('mapOn') : t('mapOff')}</span>
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
        {n.children.length > 0 && (
          <>
            <h3 className="map-sub">
              {t('mapContains')} ({n.children.length})
            </h3>
            <div className="kids">
              {n.children.map((c) => (
                <button
                  key={c.id}
                  className="kid"
                  onClick={() => {
                    engine.toggle(n, true)
                    engine.select(c)
                  }}
                >
                  <span className="dot" style={{ background: NODE_COLORS[c.type] }} />
                  <span className="kid-name">{c.label}</span>
                  <small>{c.port ? `:${c.port}` : c.children.length ? `${c.children.length} ›` : ''}</small>
                </button>
              ))}
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
          value={query}
          placeholder={t('mapSearch')}
          aria-label={t('mapSearch')}
          onChange={(e) => {
            setQuery(e.target.value)
            engine?.search(e.target.value)
          }}
        />
        <button className="btn small" onClick={() => engine?.expandAll()}>
          {t('mapExpandAll')}
        </button>
        <button className="btn small" onClick={() => engine?.collapse()}>
          {t('mapCollapse')}
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
