import { useEffect, useRef, useState } from 'react'
import type { Timeframe } from '../../shared/types'
import { fmtClock, fmtDay, niceMax } from '../homeFormat'
import { t } from '../i18n'
import { Icon } from './Icon'

// Gráficas del panel de inicio en SVG propio. Siguen la guía de visualización: líneas de 2 px, relleno al
// 10 %, cuadrícula discreta de 1 px, texto en tokens de texto (nunca con el color de la serie), leyenda si
// hay 2 o más series, cruz con tooltip al pasar el ratón y vista de tabla.

export interface Series {
  name: string
  color: string // variable CSS, p. ej. 'var(--series-1)'
  values: (number | undefined)[]
}

function useWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null)
  const [w, setW] = useState(560)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setW(Math.max(220, Math.round(el.clientWidth))))
    ro.observe(el)
    setW(Math.max(220, Math.round(el.clientWidth)))
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

// Camino con cortes donde faltan datos
function path(xs: number[], ys: (number | undefined)[], y: (v: number) => number): string {
  let d = ''
  let pen = false
  xs.forEach((x, i) => {
    const v = ys[i]
    if (v === undefined) {
      pen = false
      return
    }
    d += `${pen ? 'L' : 'M'}${x.toFixed(1)} ${y(v).toFixed(1)}`
    pen = true
  })
  return d
}

function areaPath(xs: number[], ys: (number | undefined)[], y: (v: number) => number, base: number): string {
  let d = ''
  let start = -1
  const close = (end: number): void => {
    if (start >= 0) d += `L${xs[end].toFixed(1)} ${base}L${xs[start].toFixed(1)} ${base}Z`
    start = -1
  }
  xs.forEach((x, i) => {
    const v = ys[i]
    if (v === undefined) return close(i - 1)
    d += `${start < 0 ? 'M' : 'L'}${x.toFixed(1)} ${y(v).toFixed(1)}`
    if (start < 0) start = i
  })
  close(xs.length - 1)
  return d
}

interface ChartProps {
  title: string
  subtitle?: string
  times: number[]
  series: Series[]
  format: (v: number) => string
  yMax?: number // fija el techo del eje (p. ej. la memoria total)
  area?: boolean // relleno suave de la primera serie
  timeframe: Timeframe
}

export function TimeChart({ title, subtitle, times, series, format, yMax, area, timeframe }: ChartProps): React.JSX.Element {
  const [ref, width] = useWidth()
  const [hover, setHover] = useState<number | null>(null)
  const height = 168
  const pad = { l: 56, r: 22, t: 10, b: 24 }
  const iw = width - pad.l - pad.r
  const ih = height - pad.t - pad.b

  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== undefined))
  const has = times.length > 1 && all.length > 0
  const top = yMax ?? niceMax(Math.max(...all, 0))
  const t0 = times[0] ?? 0
  const t1 = times[times.length - 1] ?? 1
  const x = (tt: number): number => pad.l + ((tt - t0) / Math.max(1, t1 - t0)) * iw
  const y = (v: number): number => pad.t + ih - (Math.min(v, top) / top) * ih
  const xs = times.map(x)
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * top)
  const xTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => t0 + f * (t1 - t0))
  const tl = (tt: number): string => (timeframe === 'week' ? fmtDay(tt) : fmtClock(tt))

  const onMove = (e: React.PointerEvent<SVGSVGElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - rect.left
    let best = 0
    let bd = Infinity
    xs.forEach((xx, i) => {
      const d = Math.abs(xx - px)
      if (d < bd) {
        bd = d
        best = i
      }
    })
    setHover(best)
  }

  const summary = has
    ? series
        .map((s) => {
          const vals = s.values.filter((v): v is number => v !== undefined)
          return `${s.name}: mínimo ${format(Math.min(...vals))}, máximo ${format(Math.max(...vals))}, último ${format(vals[vals.length - 1])}`
        })
        .join('; ')
    : 'sin datos'

  // Vista de tabla: ~12 filas repartidas por el periodo
  const step = Math.max(1, Math.ceil(times.length / 12))
  const rows = times.map((tt, i) => ({ tt, i })).filter(({ i }) => i % step === 0 || i === times.length - 1)

  return (
    <figure className="viz" ref={ref}>
      <figcaption>
        <span className="viz-title">{title}</span>
        {subtitle && <span className="viz-sub">{subtitle}</span>}
      </figcaption>
      {series.length >= 2 && (
        <div className="viz-legend">
          {series.map((s) => (
            <span key={s.name}>
              <i style={{ background: s.color }} />
              {s.name}
            </span>
          ))}
        </div>
      )}
      {!has ? (
        <div className="viz-empty">{t('homeNoData')}</div>
      ) : (
        <div className="viz-plot">
          <svg width={width} height={height} role="img" aria-label={`${title}. ${summary}`} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
            {ticks.map((v) => (
              <g key={v}>
                <line x1={pad.l} x2={width - pad.r} y1={y(v)} y2={y(v)} className="viz-grid" />
                <text x={pad.l - 8} y={y(v) + 4} textAnchor="end" className="viz-axis">
                  {format(v)}
                </text>
              </g>
            ))}
            {xTicks.map((tt, i) => (
              <text key={i} x={x(tt)} y={height - 6} textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'} className="viz-axis">
                {tl(tt)}
              </text>
            ))}
            {area && series[0] && <path d={areaPath(xs, series[0].values, y, pad.t + ih)} fill={series[0].color} opacity={0.1} />}
            {series.map((s) => (
              <path key={s.name} d={path(xs, s.values, y)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            ))}
            {hover !== null && (
              <g>
                <line x1={xs[hover]} x2={xs[hover]} y1={pad.t} y2={pad.t + ih} className="viz-cross" />
                {series.map((s) =>
                  s.values[hover] === undefined ? null : (
                    <circle key={s.name} cx={xs[hover]} cy={y(s.values[hover]!)} r={4} fill={s.color} className="viz-dot" />
                  )
                )}
              </g>
            )}
          </svg>
          {hover !== null && (
            <div className="viz-tip" style={{ left: Math.min(Math.max(xs[hover] + 12, 8), width - 190), top: 6 }}>
              <div className="viz-tip-time">{fmtClock(times[hover], timeframe !== 'hour')}</div>
              {series.map((s) => (
                <div key={s.name} className="viz-tip-row">
                  <i style={{ background: s.color }} />
                  <span>{s.name}</span>
                  <b>{s.values[hover] === undefined ? '—' : format(s.values[hover]!)}</b>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {has && (
        <details className="viz-table">
          <summary>{t('homeViewData')}</summary>
          <table>
            <thead>
              <tr>
                <th>{t('homeTime')}</th>
                {series.map((s) => (
                  <th key={s.name}>{s.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ tt, i }) => (
                <tr key={tt}>
                  <td>{fmtClock(tt, true)}</td>
                  {series.map((s) => (
                    <td key={s.name}>{s.values[i] === undefined ? '—' : format(s.values[i]!)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </figure>
  )
}

// Minigráfica de las tarjetas de cifras: una línea de 2 px con punto final y anillo del color de la superficie
export function Sparkline({ values, color = 'var(--series-1)' }: { values: (number | undefined)[]; color?: string }): React.JSX.Element | null {
  const pts = values.filter((v): v is number => v !== undefined)
  if (pts.length < 2) return null
  const w = 96
  const h = 28
  const max = Math.max(...pts)
  const min = Math.min(...pts)
  const span = max - min || 1
  const xs = values.map((_, i) => 4 + (i / Math.max(1, values.length - 1)) * (w - 8))
  const y = (v: number): number => h - 4 - ((v - min) / span) * (h - 8)
  const lastI = values.length - 1 - [...values].reverse().findIndex((v) => v !== undefined)
  return (
    <svg className="spark" width={w} height={h} aria-hidden="true">
      <path d={path(xs, values, y)} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={xs[lastI]} cy={y(values[lastI]!)} r={3.5} fill={color} className="viz-dot" />
    </svg>
  )
}

// Medidor de uso frente a un límite. Los estados alto/crítico llevan icono y texto, no solo color.
export function Meter({ value, label }: { value: number; label?: string }): React.JSX.Element {
  const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
  const level = v >= 0.9 ? 'crit' : v >= 0.8 ? 'warn' : 'ok'
  return (
    <div className="meter-wrap">
      <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)} aria-label={label}>
        <span className={`meter-fill ${level}`} style={{ width: `${Math.max(v * 100, v > 0 ? 1.5 : 0)}%` }} />
      </div>
      {level !== 'ok' && (
        <span className={`meter-flag ${level}`}>
          <Icon k="ui:alert" size={12} />
          {level === 'crit' ? t('homeCritical') : t('homeHigh')}
        </span>
      )}
    </div>
  )
}
