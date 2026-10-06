// Motor del mapa de red: disposición fija en árbol (de izquierda a derecha) + canvas. Sin física: cada nodo
// tiene su sitio calculado y solo se desliza hasta él con una animación suave (sin rebote).
// Sin React: la pantalla le pasa los nodos y recibe eventos.
import type { MapNode, MapNodeType } from '../shared/map'

export interface SimNode extends MapNode {
  x: number
  y: number
  tx: number // sitio calculado por la disposición
  ty: number
  ox: number // desplazamiento manual (al arrastrar el nodo)
  oy: number
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
const RADIUS: Record<MapNodeType, number> = { root: 22, net: 18, folder: 14, node: 20, vm: 16, lxc: 16, device: 16, service: 11, ext: 11 }
const GLYPH: Partial<Record<MapNodeType, string>> = { net: 'LAN', node: 'PVE', vm: 'VM', lxc: 'CT', device: '◈' }

const COL = 215 // separación entre niveles
const ROW = 54 // separación entre filas

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
  private matchSet: Set<SimNode> | null = null
  private raf = 0
  private frame = 0
  private pal: Palette = { bg: '#0b0e14', grid: '#161b26', text: '#e6e6f2', dim: '#8c8cab' }
  private ro: ResizeObserver
  private ctx: CanvasRenderingContext2D
  private fitted = false
  private dirty = true // hay que recalcular la disposición

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

  // Carga un árbol nuevo conservando posición, desplazamientos y carpetas abiertas de los nodos que ya estaban
  setNodes(list: MapNode[]): void {
    const old = this.byId
    const map = new Map<string, SimNode>()
    const next: SimNode[] = list.map((m) => {
      const prev = old.get(m.id)
      const n: SimNode = {
        ...m,
        children: [],
        x: prev?.x ?? 0,
        y: prev?.y ?? 0,
        tx: 0,
        ty: 0,
        ox: prev?.ox ?? 0,
        oy: prev?.oy ?? 0,
        expanded: prev ? prev.expanded : !(m.type === 'folder' && m.category)
      }
      map.set(n.id, n)
      return n
    })
    for (const n of next) {
      const p = n.parent ? map.get(n.parent) : undefined
      if (p) p.children.push(n)
    }
    // los nodos nuevos nacen en su padre y se deslizan hasta su sitio
    for (const n of next) {
      if (old.has(n.id)) continue
      const p = n.parent ? map.get(n.parent) : undefined
      n.x = p?.x ?? 0
      n.y = p?.y ?? 0
    }
    this.nodes = next
    this.byId = map
    this.selected = this.selected ? (map.get(this.selected.id) ?? null) : null
    this.hover = null
    this.matchSet = null
    this.layout()
    if (old.size === 0) {
      for (const n of next) {
        n.x = n.tx
        n.y = n.ty
      }
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
    this.dirty = true
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

  // Devuelve cada nodo a su sitio calculado (descarta lo que se arrastró a mano)
  tidy(): void {
    for (const n of this.nodes) n.ox = n.oy = 0
    this.dirty = true
    setTimeout(() => this.fit(), 350)
  }

  private afterToggle(): void {
    this.dirty = true
    this.hooks.onChange()
    setTimeout(() => this.fit(), 350)
  }

  toggle(n: SimNode, force?: boolean): void {
    const open = force === undefined ? !n.expanded : force
    if (open && !n.expanded) {
      for (const c of n.children) {
        c.x = n.x // los hijos salen del padre
        c.y = n.y
      }
    }
    n.expanded = open
    this.dirty = true
    this.hooks.onChange()
  }

  select(n: SimNode | null): void {
    this.selected = n
    this.hooks.onSelect(n)
  }

  fit(): void {
    if (this.dirty) this.layout()
    const vs = this.visible()
    if (!vs.length || !this.W) return
    let x0 = 1e9
    let y0 = 1e9
    let x1 = -1e9
    let y1 = -1e9
    for (const n of vs) {
      const gx = n.tx + n.ox
      const gy = n.ty + n.oy
      x0 = Math.min(x0, gx)
      x1 = Math.max(x1, gx)
      y0 = Math.min(y0, gy)
      y1 = Math.max(y1, gy)
    }
    const label = 150 // lo que ocupa el nombre del último nivel, a la derecha del nodo
    const padX = 50
    const padY = 60
    const k = Math.min((this.W - padX * 2) / Math.max(x1 - x0 + label, 1), (this.H - padY * 2) / Math.max(y1 - y0, 1), 1.3)
    this.view.k = Math.max(k, 0.3)
    this.view.x = this.W / 2 - ((x0 + x1 + label) / 2) * this.view.k
    this.view.y = this.H / 2 - ((y0 + y1) / 2) * this.view.k
    this.fitted = true
  }

  // ---- disposición ----

  // Árbol de izquierda a derecha: una fila por hoja visible y cada padre centrado sobre sus hijos
  private layout(): void {
    let row = 0
    const place = (n: SimNode, depth: number): void => {
      n.tx = depth * COL
      const kids = n.expanded ? n.children : []
      if (kids.length === 0) {
        n.ty = row++ * ROW
        return
      }
      for (const c of kids) place(c, depth + 1)
      n.ty = (kids[0].ty + kids[kids.length - 1].ty) / 2
    }
    for (const r of this.nodes.filter((n) => !n.parent)) place(r, 0)
    this.dirty = false
  }

  // Un paso de la animación: cada nodo se acerca a su sitio sin pasarse (no hay rebote)
  private tick(): void {
    if (this.dirty) this.layout()
    for (const n of this.visible()) {
      if (n === this.dragNode) continue
      const gx = n.tx + n.ox
      const gy = n.ty + n.oy
      n.x += (gx - n.x) * 0.2
      n.y += (gy - n.y) * 0.2
      if (Math.abs(gx - n.x) < 0.1) n.x = gx
      if (Math.abs(gy - n.y) < 0.1) n.y = gy
    }
  }

  // ---- dibujo ----

  private loop = (): void => {
    this.tick()
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

    // aristas: curvas horizontales con degradado del color del padre al del hijo
    for (const n of vs) {
      const p = n.parent ? this.byId.get(n.parent) : undefined
      if (!p) continue
      const on = !!focus && hl.has(n) && hl.has(p)
      ctx.globalAlpha = dim(n) ? 0.07 : on ? 1 : 0.75
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

    // nodos: orbe translúcido con borde y núcleo brillante; el nombre a la derecha
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
      ctx.arc(n.x, n.y, r * (n === this.hover ? 1.1 : 1), 0, Math.PI * 2)
      ctx.fillStyle = hexA(col, 0.2)
      ctx.fill()
      ctx.lineWidth = 2
      ctx.strokeStyle = col
      if (n.type === 'folder') ctx.setLineDash([4, 3])
      ctx.stroke()
      ctx.setLineDash([])
      ctx.shadowBlur = 0
      ctx.beginPath()
      ctx.arc(n.x, n.y, Math.max(3.5, r * 0.34), 0, Math.PI * 2)
      ctx.fillStyle = col
      if (n.type === 'root' || n.type === 'node' || hot) {
        ctx.shadowColor = col
        ctx.shadowBlur = 14
      }
      ctx.fill()
      ctx.shadowBlur = 0
      const glyph = n.type === 'folder' ? (n.expanded ? '−' : `+${n.children.length}`) : GLYPH[n.type]
      if (glyph && r >= 14) {
        ctx.fillStyle = pal.text
        ctx.font = '700 9px system-ui'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(glyph, n.x, n.y + r * 0.7 + 1)
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
      const sub = n.port ? `${n.ip ?? ''}:${n.port}` : (n.ip ?? n.sub ?? '')
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = pal.text
      ctx.font = `${n.type === 'root' ? 700 : 600} 12.5px system-ui`
      ctx.fillText(n.label, n.x + r + 9, n.y - (sub ? 7 : 0))
      if (sub) {
        ctx.fillStyle = pal.dim
        ctx.font = '10.5px ui-monospace, Consolas, monospace'
        ctx.fillText(sub, n.x + r + 9, n.y + 8)
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
      if (this.moved) {
        // el nodo se queda donde se suelta: se guarda como desplazamiento sobre su sitio calculado
        const w = this.world(e.offsetX, e.offsetY)
        this.dragNode.x = w.x
        this.dragNode.y = w.y
        this.dragNode.ox = w.x - this.dragNode.tx
        this.dragNode.oy = w.y - this.dragNode.ty
      }
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

// '#rrggbb' + alfa -> rgba()
function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}
