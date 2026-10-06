// Motor del grafo del mapa de red: fuerzas + canvas. Sin React: la pantalla le pasa los nodos y recibe eventos.
import type { MapNode, MapNodeType } from '../shared/map'

export interface SimNode extends MapNode {
  x: number
  y: number
  vx: number
  vy: number
  children: SimNode[]
  expanded: boolean
  matched?: boolean
}

// Colores de neón por tipo (el fondo y los textos salen del tema de la app)
export const NODE_COLORS: Record<MapNodeType, string> = {
  root: '#c084fc',
  net: '#38bdf8',
  folder: '#818cf8',
  node: '#f97316',
  vm: '#38bdf8',
  lxc: '#10b981',
  device: '#eab308',
  service: '#60a5fa',
  ext: '#fb7185'
}
const RADIUS: Record<MapNodeType, number> = { root: 24, net: 19, folder: 15, node: 21, vm: 17, lxc: 17, device: 17, service: 11, ext: 11 }
const GLYPH: Partial<Record<MapNodeType, string>> = { root: '⌂', net: 'LAN', node: 'PVE', vm: 'VM', lxc: 'CT', device: '◈' }

export interface EngineHooks {
  onSelect: (n: SimNode | null) => void
  onActivate: (n: SimNode) => void // clic en algo que se abre (servicio, dispositivo)
  onHover: (n: SimNode | null, x: number, y: number) => void
  onChange: () => void // cambió lo visible (abrir/cerrar carpetas)
}

interface Palette {
  bg: string
  grid: string
  text: string
  dim: string
}

export class MapEngine {
  nodes: SimNode[] = []
  private byId = new Map<string, SimNode>()
  private view = { k: 1, x: 0, y: 0 }
  private W = 0
  private H = 0
  private dpr = 1
  private hover: SimNode | null = null
  private selected: SimNode | null = null
  private dragNode: SimNode | null = null
  private panning = false
  private moved = false
  private last = { x: 0, y: 0 }
  private heat = 1
  private matchSet: Set<SimNode> | null = null
  private raf = 0
  private frame = 0
  private pal: Palette = { bg: '#0b0e14', grid: '#161b26', text: '#e6e6f2', dim: '#8c8cab' }
  private ro: ResizeObserver
  private ctx: CanvasRenderingContext2D
  private fitted = false

  constructor(
    private cv: HTMLCanvasElement,
    private hooks: EngineHooks
  ) {
    this.ctx = cv.getContext('2d')!
    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(cv.parentElement ?? cv)
    cv.addEventListener('pointerdown', this.onDown)
    cv.addEventListener('pointermove', this.onMove)
    cv.addEventListener('pointerup', this.onUp)
    cv.addEventListener('pointerleave', this.onLeave)
    cv.addEventListener('wheel', this.onWheel, { passive: false })
    cv.addEventListener('dblclick', this.onDbl)
    this.resize()
    this.loop()
  }

  destroy(): void {
    cancelAnimationFrame(this.raf)
    this.ro.disconnect()
    this.cv.removeEventListener('pointerdown', this.onDown)
    this.cv.removeEventListener('pointermove', this.onMove)
    this.cv.removeEventListener('pointerup', this.onUp)
    this.cv.removeEventListener('pointerleave', this.onLeave)
    this.cv.removeEventListener('wheel', this.onWheel)
    this.cv.removeEventListener('dblclick', this.onDbl)
  }

  // ---- datos ----

  // Carga un árbol nuevo conservando posición y carpetas abiertas de los nodos que ya estaban
  setNodes(list: MapNode[]): void {
    const old = this.byId
    const next: SimNode[] = []
    const map = new Map<string, SimNode>()
    for (const m of list) {
      const prev = old.get(m.id)
      const n: SimNode = {
        ...m,
        children: [],
        x: prev?.x ?? 0,
        y: prev?.y ?? 0,
        vx: 0,
        vy: 0,
        expanded: prev ? prev.expanded : defaultExpanded(m)
      }
      next.push(n)
      map.set(n.id, n)
    }
    for (const n of next) {
      const p = n.parent ? map.get(n.parent) : undefined
      if (p) p.children.push(n)
      if (!old.has(n.id)) {
        n.x = (p?.x ?? 0) + (Math.random() - 0.5) * 160
        n.y = (p?.y ?? 0) + (Math.random() - 0.5) * 160
      }
    }
    this.nodes = next
    this.byId = map
    this.selected = this.selected ? (map.get(this.selected.id) ?? null) : null
    this.hover = null
    this.matchSet = null
    this.heat = old.size === 0 ? 1 : 0.6
    if (old.size === 0) {
      for (let i = 0; i < 400; i++) this.step() // asienta el grafo antes de mostrarlo
      this.fit()
    }
    this.hooks.onChange()
  }

  get(id: string): SimNode | undefined {
    return this.byId.get(id)
  }

  visibleCount(): number {
    return this.visible().length
  }

  ancestors(n: SimNode): SimNode[] {
    const a: SimNode[] = []
    for (let p = n.parent ? this.byId.get(n.parent) : undefined; p; p = p.parent ? this.byId.get(p.parent) : undefined) a.push(p)
    return a
  }

  private visible(): SimNode[] {
    return this.nodes.filter((n) => this.ancestors(n).every((a) => a.expanded))
  }

  // ---- acciones de la barra ----

  search(q: string): void {
    const query = q.trim().toLowerCase()
    for (const n of this.nodes) n.matched = false
    if (!query) {
      this.matchSet = null
      return
    }
    const set = new Set<SimNode>()
    for (const n of this.nodes) {
      if (`${n.label} ${n.ip ?? ''} ${n.port ?? ''} ${n.url ?? ''}`.toLowerCase().includes(query)) {
        n.matched = true
        set.add(n)
        for (const a of this.ancestors(n)) {
          set.add(a)
          a.expanded = true
        }
      }
    }
    this.matchSet = set
    this.heat = 1
    this.hooks.onChange()
  }

  expandAll(): void {
    for (const n of this.nodes) n.expanded = true
    this.afterToggle()
  }

  collapse(): void {
    for (const n of this.nodes) n.expanded = n.type === 'root' || n.type === 'net' || n.type === 'node'
    this.afterToggle()
  }

  private afterToggle(): void {
    this.heat = 1
    this.hooks.onChange()
    setTimeout(() => this.fit(), 700)
  }

  toggle(n: SimNode, force?: boolean): void {
    n.expanded = force === undefined ? !n.expanded : force
    if (n.expanded) for (const c of n.children) {
      c.x = n.x + (Math.random() - 0.5) * 60
      c.y = n.y + (Math.random() - 0.5) * 60
    }
    this.heat = 1
    this.hooks.onChange()
  }

  select(n: SimNode | null): void {
    this.selected = n
    this.hooks.onSelect(n)
  }

  fit(): void {
    const vs = this.visible()
    if (!vs.length || !this.W) return
    let x0 = 1e9
    let y0 = 1e9
    let x1 = -1e9
    let y1 = -1e9
    for (const n of vs) {
      x0 = Math.min(x0, n.x)
      x1 = Math.max(x1, n.x)
      y0 = Math.min(y0, n.y)
      y1 = Math.max(y1, n.y)
    }
    const pad = 90
    const k = Math.min((this.W - pad * 2) / Math.max(x1 - x0, 1), (this.H - pad * 2) / Math.max(y1 - y0, 1), 1.4)
    this.view.k = k
    this.view.x = this.W / 2 - ((x0 + x1) / 2) * k
    this.view.y = this.H / 2 - ((y0 + y1) / 2) * k
    this.fitted = true
  }

  // ---- simulación ----

  private step(): void {
    const vs = this.visible()
    for (let i = 0; i < vs.length; i++) {
      const a = vs[i]
      for (let j = i + 1; j < vs.length; j++) {
        const b = vs[j]
        const dx = a.x - b.x
        const dy = a.y - b.y
        const d2 = dx * dx + dy * dy + 0.01
        const d = Math.sqrt(d2)
        const f = 11000 / d2
        const fx = (dx / d) * f
        const fy = (dy / d) * f
        a.vx += fx
        a.vy += fy
        b.vx -= fx
        b.vy -= fy
      }
      a.vx -= a.x * 0.0025 // gravedad suave
      a.vy -= a.y * 0.0025
    }
    for (const n of vs) {
      const p = n.parent ? this.byId.get(n.parent) : undefined
      if (!p) continue
      const len = n.type === 'service' || n.type === 'ext' ? 85 : n.type === 'folder' ? 120 : 150
      const dx = n.x - p.x
      const dy = n.y - p.y
      const d = Math.sqrt(dx * dx + dy * dy) || 1
      const f = (d - len) * 0.035
      n.vx -= (dx / d) * f
      n.vy -= (dy / d) * f
      p.vx += (dx / d) * f
      p.vy += (dy / d) * f
    }
    for (const n of vs) {
      if (n === this.dragNode) {
        n.vx = n.vy = 0
        continue
      }
      n.vx *= 0.82
      n.vy *= 0.82
      n.x += n.vx * this.heat
      n.y += n.vy * this.heat
    }
    this.heat = Math.max(0.12, this.heat * 0.995)
  }

  // ---- dibujo ----

  private loop = (): void => {
    this.step()
    this.draw()
    this.raf = requestAnimationFrame(this.loop)
  }

  private readPalette(): void {
    const cs = getComputedStyle(this.cv)
    const v = (name: string, fallback: string): string => cs.getPropertyValue(name).trim() || fallback
    this.pal = { bg: v('--bg', '#0b0e14'), grid: v('--border-muted', '#161b26'), text: v('--text', '#e6e6f2'), dim: v('--text-dim', '#8c8cab') }
  }

  private resize(): void {
    const r = (this.cv.parentElement ?? this.cv).getBoundingClientRect()
    this.dpr = window.devicePixelRatio || 1
    this.W = r.width
    this.H = r.height
    this.cv.width = Math.max(1, Math.round(this.W * this.dpr))
    this.cv.height = Math.max(1, Math.round(this.H * this.dpr))
    if (!this.fitted && this.nodes.length) this.fit()
  }

  private focusSet(): Set<SimNode> {
    const s = new Set<SimNode>()
    const f = this.hover ?? this.selected
    if (f) {
      s.add(f)
      for (const a of this.ancestors(f)) s.add(a)
      for (const c of f.children) s.add(c)
    }
    return s
  }

  private draw(): void {
    if (this.frame++ % 45 === 0) this.readPalette()
    const { ctx, view, pal } = this
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.fillStyle = pal.bg
    ctx.fillRect(0, 0, this.W, this.H)
    this.drawGrid()
    ctx.save()
    ctx.translate(view.x, view.y)
    ctx.scale(view.k, view.k)

    const vs = this.visible()
    const focus = this.hover ?? this.selected
    const hl = this.focusSet()
    const dim = (n: SimNode): boolean => (!!focus && !hl.has(n)) || (!!this.matchSet && !this.matchSet.has(n))

    // halos: las carpetas y máquinas abiertas se rodean de una zona tenue con sus hijos
    for (const n of vs) {
      const kids = n.children.filter((c) => vs.includes(c))
      if (!n.expanded || kids.length < 2 || n.type === 'root' || n.type === 'net') continue
      let r = 0
      for (const c of kids) r = Math.max(r, Math.hypot(c.x - n.x, c.y - n.y))
      ctx.globalAlpha = dim(n) ? 0.04 : 1
      ctx.beginPath()
      ctx.arc(n.x, n.y, r + 44, 0, Math.PI * 2)
      ctx.fillStyle = hexA(NODE_COLORS[n.type], 0.045)
      ctx.fill()
      ctx.setLineDash([5, 5])
      ctx.strokeStyle = hexA(NODE_COLORS[n.type], 0.22)
      ctx.lineWidth = 1.2
      ctx.stroke()
      ctx.setLineDash([])
    }

    // aristas: curvas con degradado del color del padre al del hijo
    for (const n of vs) {
      const p = n.parent ? this.byId.get(n.parent) : undefined
      if (!p) continue
      const on = !!focus && hl.has(n) && hl.has(p)
      ctx.globalAlpha = dim(n) ? 0.07 : on ? 1 : 0.7
      const g = ctx.createLinearGradient(p.x, p.y, n.x, n.y)
      g.addColorStop(0, hexA(NODE_COLORS[p.type], on ? 0.95 : 0.5))
      g.addColorStop(1, hexA(NODE_COLORS[n.type], on ? 0.95 : 0.5))
      ctx.strokeStyle = g
      ctx.lineWidth = (on ? 2.6 : 1.5) / Math.max(view.k, 0.6)
      const mx = (p.x + n.x) / 2
      ctx.beginPath()
      ctx.moveTo(p.x, p.y)
      ctx.bezierCurveTo(mx, p.y, mx, n.y, n.x, n.y)
      ctx.stroke()
    }

    // nodos: orbe translúcido con borde y núcleo brillante
    for (const n of vs) {
      const r = RADIUS[n.type]
      const col = n.status === 'stopped' ? '#6b7280' : NODE_COLORS[n.type]
      const hot = n === this.hover || n === this.selected
      ctx.globalAlpha = dim(n) ? 0.18 : 1
      if (hot) {
        ctx.shadowColor = col
        ctx.shadowBlur = 24
      }
      ctx.beginPath()
      ctx.arc(n.x, n.y, r * (n === this.hover ? 1.12 : 1), 0, Math.PI * 2)
      ctx.fillStyle = hexA(col, 0.2)
      ctx.fill()
      ctx.lineWidth = 2
      ctx.strokeStyle = col
      if (n.type === 'folder') ctx.setLineDash([4, 3])
      ctx.stroke()
      ctx.setLineDash([])
      ctx.shadowBlur = 0
      // núcleo
      ctx.beginPath()
      ctx.arc(n.x, n.y, Math.max(3.5, r * 0.34), 0, Math.PI * 2)
      ctx.fillStyle = col
      if (n.type === 'root' || n.type === 'node' || hot) {
        ctx.shadowColor = col
        ctx.shadowBlur = 14
      }
      ctx.fill()
      ctx.shadowBlur = 0
      // glifo (solo en los tipos grandes)
      const glyph = n.type === 'folder' ? (n.expanded ? '−' : `+${n.children.length}`) : GLYPH[n.type]
      if (glyph && r >= 15 && n.type !== 'root') {
        ctx.fillStyle = pal.text
        ctx.font = '700 9px system-ui'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(glyph, n.x, n.y + r * 0.72 + 1)
      }
      if (n.status === 'running') {
        ctx.beginPath()
        ctx.arc(n.x + r * 0.74, n.y - r * 0.74, 4, 0, Math.PI * 2)
        ctx.fillStyle = '#4ade80'
        ctx.fill()
        ctx.strokeStyle = pal.bg
        ctx.lineWidth = 1.5
        ctx.stroke()
      }
      // etiquetas
      ctx.fillStyle = pal.text
      ctx.font = `${n.type === 'root' ? 700 : 600} 12px system-ui`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillText(n.label, n.x, n.y + r + 5)
      const sub = n.port ? `${n.ip ?? ''}:${n.port}` : (n.ip ?? n.sub ?? '')
      if (sub) {
        ctx.fillStyle = pal.dim
        ctx.font = '10.5px ui-monospace, Consolas, monospace'
        ctx.fillText(sub, n.x, n.y + r + 20)
      }
      if (this.matchSet?.has(n) && n.matched) {
        ctx.globalAlpha = 1
        ctx.strokeStyle = '#ffd166'
        ctx.lineWidth = 2.5
        ctx.beginPath()
        ctx.arc(n.x, n.y, r + 6, 0, Math.PI * 2)
        ctx.stroke()
      }
    }
    ctx.restore()
    ctx.globalAlpha = 1
  }

  // Malla de fondo estilo canvas de Obsidian: sigue al zoom y al desplazamiento
  private drawGrid(): void {
    const { ctx, view } = this
    const size = 40 * view.k
    if (size < 8) return
    ctx.strokeStyle = this.pal.grid
    ctx.globalAlpha = 0.5
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let x = ((view.x % size) + size) % size; x < this.W; x += size) {
      ctx.moveTo(x, 0)
      ctx.lineTo(x, this.H)
    }
    for (let y = ((view.y % size) + size) % size; y < this.H; y += size) {
      ctx.moveTo(0, y)
      ctx.lineTo(this.W, y)
    }
    ctx.stroke()
    ctx.globalAlpha = 1
  }

  // ---- entrada ----

  private world(px: number, py: number): { x: number; y: number } {
    return { x: (px - this.view.x) / this.view.k, y: (py - this.view.y) / this.view.k }
  }

  private pick(px: number, py: number): SimNode | null {
    const w = this.world(px, py)
    let best: SimNode | null = null
    let bd = 1e9
    for (const n of this.visible()) {
      const d = Math.hypot(n.x - w.x, n.y - w.y)
      if (d <= RADIUS[n.type] + 6 && d < bd) {
        best = n
        bd = d
      }
    }
    return best
  }

  private onDown = (e: PointerEvent): void => {
    this.cv.setPointerCapture(e.pointerId)
    this.moved = false
    this.last = { x: e.offsetX, y: e.offsetY }
    const n = this.pick(e.offsetX, e.offsetY)
    if (n) this.dragNode = n
    else {
      this.panning = true
      this.cv.style.cursor = 'grabbing'
    }
  }

  private onMove = (e: PointerEvent): void => {
    const dx = e.offsetX - this.last.x
    const dy = e.offsetY - this.last.y
    if (this.dragNode) {
      if (Math.hypot(dx, dy) > 3) this.moved = true
      const w = this.world(e.offsetX, e.offsetY)
      this.dragNode.x = w.x
      this.dragNode.y = w.y
      this.heat = 0.6
    } else if (this.panning) {
      this.moved = true
      this.view.x += dx
      this.view.y += dy
      this.last = { x: e.offsetX, y: e.offsetY }
    } else {
      this.hover = this.pick(e.offsetX, e.offsetY)
      this.cv.style.cursor = this.hover ? 'pointer' : 'grab'
      this.hooks.onHover(this.hover, e.offsetX, e.offsetY)
    }
  }

  private onUp = (): void => {
    const n = this.dragNode
    if (n && !this.moved) this.click(n)
    else if (!n && !this.moved) this.select(null)
    this.dragNode = null
    this.panning = false
    this.cv.style.cursor = 'grab'
  }

  private onLeave = (): void => {
    this.hover = null
    this.hooks.onHover(null, 0, 0)
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault()
    const f = Math.exp(-e.deltaY * 0.0012)
    const w = this.world(e.offsetX, e.offsetY)
    this.view.k = Math.min(3, Math.max(0.25, this.view.k * f))
    this.view.x = e.offsetX - w.x * this.view.k
    this.view.y = e.offsetY - w.y * this.view.k
  }

  private onDbl = (e: MouseEvent): void => {
    const n = this.pick(e.offsetX, e.offsetY)
    if (n && n.children.length) this.toggle(n)
  }

  // Carpetas y redes: abrir/cerrar. Servicios y dispositivos: abrir su panel. Nodos y máquinas: seleccionar y desplegar.
  private click(n: SimNode): void {
    this.select(n)
    if (n.type === 'folder' || n.type === 'root' || n.type === 'net') {
      this.toggle(n)
      return
    }
    if (n.children.length && !n.expanded) this.toggle(n, true)
    if (n.type === 'service' || n.type === 'ext' || n.type === 'device') this.hooks.onActivate(n)
  }
}

function defaultExpanded(n: MapNode): boolean {
  return !(n.type === 'folder' && n.category)
}

// '#rrggbb' + alfa -> rgba()
function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}
