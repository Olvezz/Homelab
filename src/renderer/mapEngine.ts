// Motor del mapa de red: disposiciones fijas (árbol, araña, vertical y bloques) + canvas. Sin física: cada nodo
// tiene su sitio calculado y solo se desliza hasta él con una animación suave (sin rebote).
// Sin React: la pantalla le pasa los nodos y recibe eventos.
import type { MapNode, MapNodeType } from '../shared/map'

export type ViewMode = 'tree' | 'web' | 'vertical' | 'blocks'
export const VIEW_MODES: ViewMode[] = ['tree', 'web', 'vertical', 'blocks']

interface Box {
  x: number
  y: number
  w: number
  h: number
}

export interface SimNode extends MapNode {
  x: number
  y: number
  tx: number // sitio calculado por la disposición
  ty: number
  ox: number // desplazamiento manual (al arrastrar el nodo)
  oy: number
  ang: number // ángulo en la vista de araña
  vx: number // velocidad del resorte (solo en la vista de araña)
  vy: number
  box?: Box // recuadro de la carpeta en la vista de bloques
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

const COL = 215 // árbol: separación entre niveles
const ROW = 54 // árbol: separación entre filas
const V_COL = 150 // vertical: separación entre hojas
const V_ROW = 120 // vertical: separación entre niveles
const RING = 115 // araña: separación entre anillos
const CELL_W = 210 // bloques: tamaño de una celda
const CELL_H = 56
const SPRING_K = 0.09 // araña: rigidez del resorte
const SPRING_DAMP = 0.72 // araña: amortiguación (rebote de ~10 %, leve; se asienta en ~0,45 s)
const SPRING_FOLLOW = 0.5 // araña: cuánto arrastra un nodo a sus ramas
const PAD = 14
const GAP = 12

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
  mode: ViewMode = 'tree'
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
  private rings: number[] = [] // radios de la vista de araña

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

  // Color de un nodo: el propio (carpeta del usuario, tag) o el de su tipo
  private col(n: SimNode): string {
    return n.color ?? NODE_COLORS[n.type]
  }


  // Carga un árbol nuevo conservando posición, desplazamientos y carpetas abiertas de los nodos que ya estaban
  setNodes(list: MapNode[]): void {
    const old = this.byId
    const map = new Map<string, SimNode>()
    const next: SimNode[] = list.map((m) => {
      const prev = old.get(m.id)
      const n: SimNode = {
        ...m,
        // el estado medido (sondeo) sobrevive a los refrescos de Proxmox
        status: prev && (m.type === 'service' || m.type === 'ext' || m.type === 'device') ? prev.status : m.status,
        children: [],
        x: prev?.x ?? 0,
        y: prev?.y ?? 0,
        tx: 0,
        ty: 0,
        ox: prev?.ox ?? 0,
        oy: prev?.oy ?? 0,
        ang: 0,
        vx: 0,
        vy: 0,
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
      this.snap()
      this.fit()
    }
    this.hooks.onChange()
  }

  // Estado medido de los servicios (url -> encendido): colorea el nodo y lo marca con el punto verde
  setProbe(result: Record<string, boolean>): void {
    for (const n of this.nodes) {
      if (!n.url || (n.type !== 'service' && n.type !== 'ext' && n.type !== 'device')) continue
      const up = result[n.url]
      if (up !== undefined) n.status = up ? 'running' : 'stopped'
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

  descendants(n: SimNode): SimNode[] {
    const out: SimNode[] = []
    const walk = (x: SimNode): void => {
      for (const c of x.children) {
        out.push(c)
        walk(c)
      }
    }
    walk(n)
    return out
  }

  private visible(): SimNode[] {
    return this.nodes.filter((n) => this.ancestors(n).every((a) => a.expanded))
  }

  // ---- acciones de la barra ----

  setMode(mode: ViewMode): void {
    if (mode === this.mode) return
    this.mode = mode
    for (const n of this.nodes) {
      n.ox = n.oy = 0
      n.vx = n.vy = 0
    }
    this.dirty = true
    this.hooks.onChange()
    setTimeout(() => this.fit(), 350)
  }

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

  // Reinicia la vista: cada nodo vuelve a su sitio (se descarta lo arrastrado a mano) y se reencuadra
  reset(): void {
    for (const n of this.nodes) n.ox = n.oy = 0
    this.dirty = true
    this.layout()
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

  private snap(): void {
    for (const n of this.nodes) {
      n.x = n.tx + n.ox
      n.y = n.ty + n.oy
    }
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
      x0 = Math.min(x0, n.box ? n.box.x : gx)
      x1 = Math.max(x1, n.box ? n.box.x + n.box.w : gx)
      y0 = Math.min(y0, n.box ? n.box.y : gy)
      y1 = Math.max(y1, n.box ? n.box.y + n.box.h : gy)
    }
    // lo que ocupan los nombres que sobresalen de los nodos
    const lx = this.mode === 'tree' ? 150 : this.mode === 'web' ? 300 : this.mode === 'blocks' ? 0 : 70
    const ly = this.mode === 'vertical' ? 60 : 24
    const w = Math.max(x1 - x0 + lx, 1)
    const h = Math.max(y1 - y0 + ly, 1)
    const k = Math.min((this.W - 100) / w, (this.H - 120) / h, 1.3)
    this.view.k = Math.max(k, 0.25)
    const cx = this.mode === 'web' ? (x0 + x1) / 2 : (x0 + x1 + lx) / 2
    this.view.x = this.W / 2 - cx * this.view.k
    this.view.y = this.H / 2 - ((y0 + y1) / 2 + ly / 2 - 10) * this.view.k
    this.fitted = true
  }

  // ---- disposición ----

  private layout(): void {
    for (const n of this.nodes) n.box = undefined
    const roots = this.nodes.filter((n) => !n.parent)
    if (this.mode === 'tree') this.layoutTree(roots, false)
    else if (this.mode === 'vertical') this.layoutTree(roots, true)
    else if (this.mode === 'web') this.layoutWeb(roots)
    else this.layoutBlocks(roots)
    this.dirty = false
  }

  private kids(n: SimNode): SimNode[] {
    return n.expanded ? n.children : []
  }

  // Árbol: una fila (o columna) por hoja visible y cada padre centrado sobre sus hijos
  private layoutTree(roots: SimNode[], vertical: boolean): void {
    let slot = 0
    const place = (n: SimNode, depth: number): void => {
      const kids = this.kids(n)
      let along: number
      if (kids.length === 0) along = slot++
      else {
        for (const c of kids) place(c, depth + 1)
        const a = vertical ? kids[0].tx / V_COL : kids[0].ty / ROW
        const b = vertical ? kids[kids.length - 1].tx / V_COL : kids[kids.length - 1].ty / ROW
        along = (a + b) / 2
      }
      if (vertical) {
        n.tx = along * V_COL
        n.ty = depth * V_ROW
      } else {
        n.tx = depth * COL
        n.ty = along * ROW
      }
    }
    for (const r of roots) place(r, 0)
  }

  // Araña: la raíz en el centro y cada rama reparte su ángulo según las hojas que tiene
  private layoutWeb(roots: SimNode[]): void {
    const leaves = (n: SimNode): number => {
      const kids = this.kids(n)
      return kids.length === 0 ? 1 : kids.reduce((s, c) => s + leaves(c), 0)
    }
    // radio de cada anillo: lo bastante grande para que quepan sus nodos sin pisarse
    const perDepth: number[] = []
    const count = (n: SimNode, d: number): void => {
      perDepth[d] = (perDepth[d] ?? 0) + 1
      for (const c of this.kids(n)) count(c, d + 1)
    }
    for (const r of roots) count(r, 0)
    this.rings = perDepth.map((cnt, d) => (d === 0 ? 0 : Math.max(d * RING, (cnt * 56) / (2 * Math.PI))))
    for (let d = 1; d < this.rings.length; d++) this.rings[d] = Math.max(this.rings[d], this.rings[d - 1] + 90)

    const place = (n: SimNode, depth: number, a0: number, a1: number): void => {
      const mid = (a0 + a1) / 2
      const r = this.rings[depth] ?? 0
      n.ang = mid
      n.tx = Math.cos(mid) * r
      n.ty = Math.sin(mid) * r
      const kids = this.kids(n)
      const total = kids.reduce((s, c) => s + leaves(c), 0)
      let a = a0
      for (const c of kids) {
        const span = ((a1 - a0) * leaves(c)) / total
        place(c, depth + 1, a, a + span)
        a += span
      }
    }
    for (const r of roots) place(r, 0, -Math.PI / 2, (3 * Math.PI) / 2)
  }

  // Bloques: cada nodo abierto es un recuadro que contiene a sus hijos en cuadrícula (la jerarquía se ve por contención)
  private layoutBlocks(roots: SimNode[]): void {
    interface Size {
      w: number
      h: number
      cols: number
      colW: number[]
      rowH: number[]
    }
    const sizes = new Map<SimNode, Size>()
    const measure = (n: SimNode): Size => {
      const kids = this.kids(n)
      if (kids.length === 0) {
        const s = { w: CELL_W, h: CELL_H, cols: 0, colW: [], rowH: [] }
        sizes.set(n, s)
        return s
      }
      const cols = kids.length <= 3 ? kids.length : Math.min(3, Math.ceil(Math.sqrt(kids.length)))
      const rows = Math.ceil(kids.length / cols)
      const colW = Array<number>(cols).fill(0)
      const rowH = Array<number>(rows).fill(0)
      kids.forEach((c, i) => {
        const s = measure(c)
        colW[i % cols] = Math.max(colW[i % cols], s.w)
        rowH[Math.floor(i / cols)] = Math.max(rowH[Math.floor(i / cols)], s.h)
      })
      const innerW = colW.reduce((a, b) => a + b, 0) + GAP * (cols - 1)
      const innerH = rowH.reduce((a, b) => a + b, 0) + GAP * (rows - 1)
      const s = { w: Math.max(CELL_W, innerW) + PAD * 2, h: CELL_H + innerH + PAD * 2, cols, colW, rowH }
      sizes.set(n, s)
      return s
    }
    const place = (n: SimNode, x: number, y: number): void => {
      const s = sizes.get(n)!
      const kids = this.kids(n)
      n.tx = x + (kids.length ? PAD + 14 : 28)
      n.ty = y + CELL_H / 2 + (kids.length ? PAD / 2 : 0)
      if (kids.length === 0) return
      n.box = { x, y, w: s.w, h: s.h }
      let cy = y + CELL_H + PAD
      kids.forEach((c, i) => {
        const col = i % s.cols
        if (col === 0 && i > 0) cy += s.rowH[Math.floor(i / s.cols) - 1] + GAP
        const cx = x + PAD + s.colW.slice(0, col).reduce((a, b) => a + b, 0) + GAP * col
        place(c, cx, cy)
      })
    }
    let x = 0
    for (const r of roots) {
      const s = measure(r)
      place(r, x, 0)
      x += s.w + 40
    }
  }

  // Lo que arrastra a un nodo el desplazamiento de sus ancestros (solo en la araña): las ramas siguen al nodo que se mueve
  private pull(n: SimNode): { x: number; y: number } {
    let x = 0
    let y = 0
    let w = SPRING_FOLLOW
    for (let p = n.parent ? this.byId.get(n.parent) : undefined; p; p = p.parent ? this.byId.get(p.parent) : undefined) {
      x += p.ox * w
      y += p.oy * w
      w *= SPRING_FOLLOW
    }
    return { x, y }
  }

  // Un paso de la animación. Árbol y vertical: cada nodo se acerca a su sitio sin pasarse. Araña: resorte leve
  // (un pequeño rebote al acomodarse). Bloques: sin animación, para que los recuadros y los nodos no se separen.
  private tick(): void {
    if (this.dirty) this.layout()
    const instant = this.mode === 'blocks'
    const spring = this.mode === 'web'
    for (const n of this.visible()) {
      if (n === this.dragNode) continue
      const pl = spring ? this.pull(n) : { x: 0, y: 0 }
      const gx = n.tx + n.ox + pl.x
      const gy = n.ty + n.oy + pl.y
      if (instant) {
        n.x = gx
        n.y = gy
        continue
      }
      if (spring) {
        n.vx = (n.vx + (gx - n.x) * SPRING_K) * SPRING_DAMP
        n.vy = (n.vy + (gy - n.y) * SPRING_K) * SPRING_DAMP
        n.x += n.vx
        n.y += n.vy
        if (Math.abs(gx - n.x) < 0.1 && Math.abs(n.vx) < 0.05) {
          n.x = gx
          n.vx = 0
        }
        if (Math.abs(gy - n.y) < 0.1 && Math.abs(n.vy) < 0.05) {
          n.y = gy
          n.vy = 0
        }
        continue
      }
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

  // Dónde y cómo se escribe el nombre de un nodo según la vista
  private labelAt(n: SimNode, r: number): { x: number; y: number; align: CanvasTextAlign; sub: number } {
    if (this.mode === 'vertical') return { x: n.x, y: n.y + r + 13, align: 'center', sub: 14 }
    if (this.mode === 'web') {
      if (n.type === 'root') return { x: n.x, y: n.y + r + 13, align: 'center', sub: 14 }
      const right = Math.cos(n.ang) >= -0.01
      return { x: n.x + (right ? r + 9 : -(r + 9)), y: n.y - 7, align: right ? 'left' : 'right', sub: 15 }
    }
    return { x: n.x + r + 9, y: n.y - 7, align: 'left', sub: 15 }
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

    // anillos de la araña
    if (this.mode === 'web') {
      ctx.strokeStyle = pal.grid
      ctx.lineWidth = 1.2
      ctx.globalAlpha = 0.9
      ctx.setLineDash([2, 6])
      const root = vs.find((n) => !n.parent)
      for (const r of this.rings.slice(1)) {
        ctx.beginPath()
        ctx.arc(root?.tx ?? 0, root?.ty ?? 0, r, 0, Math.PI * 2)
        ctx.stroke()
      }
      ctx.setLineDash([])
    }

    // recuadros de la vista de bloques (los más externos primero)
    if (this.mode === 'blocks') {
      const boxed = vs.filter((n) => n.box).sort((a, b) => this.ancestors(a).length - this.ancestors(b).length)
      for (const n of boxed) {
        const b = n.box!
        ctx.globalAlpha = dim(n) ? 0.25 : 1
        roundRect(ctx, b.x, b.y, b.w, b.h, 14)
        ctx.fillStyle = hexA(this.col(n), n.color ? 0.1 : 0.055)
        ctx.fill()
        ctx.setLineDash([5, 5])
        ctx.strokeStyle = hexA(this.col(n), n === focus ? 0.8 : n.color ? 0.55 : 0.3)
        ctx.lineWidth = n === focus ? 2 : 1.3
        ctx.stroke()
        ctx.setLineDash([])
      }
    } else {
      // aristas con degradado del color del padre al del hijo
      for (const n of vs) {
        const p = n.parent ? this.byId.get(n.parent) : undefined
        if (!p) continue
        const on = !!focus && hl.has(n) && hl.has(p)
        ctx.globalAlpha = dim(n) ? 0.07 : on ? 1 : 0.75
        const g = ctx.createLinearGradient(p.x, p.y, n.x, n.y)
        g.addColorStop(0, hexA(this.col(p), on ? 0.95 : 0.5))
        g.addColorStop(1, hexA(this.col(n), on ? 0.95 : 0.5))
        ctx.strokeStyle = g
        ctx.lineWidth = (on ? 2.6 : 1.5) / Math.max(view.k, 0.6)
        ctx.beginPath()
        ctx.moveTo(p.x, p.y)
        if (this.mode === 'tree') {
          const mx = (p.x + n.x) / 2
          ctx.bezierCurveTo(mx, p.y, mx, n.y, n.x, n.y)
        } else if (this.mode === 'vertical') {
          const my = (p.y + n.y) / 2
          ctx.bezierCurveTo(p.x, my, n.x, my, n.x, n.y)
        } else ctx.lineTo(n.x, n.y)
        ctx.stroke()
      }
    }

    // nodos: orbe translúcido con borde y núcleo brillante
    for (const n of vs) {
      const r = RADIUS[n.type]
      const col = n.status === 'stopped' ? '#6b7280' : this.col(n)
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
      const lp = this.labelAt(n, r)
      ctx.textAlign = lp.align
      ctx.textBaseline = 'middle'
      ctx.fillStyle = pal.text
      ctx.font = `${n.type === 'root' ? 700 : 600} 12.5px system-ui`
      ctx.fillText(n.label, lp.x, lp.y)
      if (sub) {
        ctx.fillStyle = pal.dim
        ctx.font = '10.5px ui-monospace, Consolas, monospace'
        ctx.fillText(sub, lp.x, lp.y + lp.sub)
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
      if (this.moved && this.mode !== 'blocks') {
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
    this.view.k = Math.min(3, Math.max(0.2, this.view.k * f))
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

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

// '#rrggbb' + alfa -> rgba()
function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}
