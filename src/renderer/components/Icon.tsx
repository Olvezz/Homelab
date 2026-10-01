import {
  AppWindow,
  Box,
  ChevronDown,
  ChevronRight,
  Check,
  Copy,
  Download,
  ExternalLink,
  Globe,
  Loader,
  Lock,
  Menu,
  Minus,
  Monitor,
  Plus,
  RotateCw,
  LayoutDashboard,
  Search,
  Sparkles,
  Server,
  Settings,
  SquareTerminal,
  TriangleAlert,
  X,
  ArrowLeft,
  ArrowRight,
  type LucideIcon
} from 'lucide-react'
import brandsJson from '../brands.json'
import { iconForGuest, iconForPanel, type IconKey } from '../../shared/icons'
import type { Guest, Panel } from '../../shared/types'

const BRANDS = brandsJson as Record<string, { title: string; path: string }>

// Iconos genéricos de interfaz (Lucide). Se piden como `ui:<nombre>`
const UI: Record<string, LucideIcon> = {
  server: Server,
  box: Box,
  monitor: Monitor,
  globe: Globe,
  terminal: SquareTerminal,
  windows: AppWindow,
  menu: Menu,
  search: Search,
  sparkles: Sparkles,
  settings: Settings,
  'chevron-right': ChevronRight,
  'chevron-down': ChevronDown,
  x: X,
  back: ArrowLeft,
  forward: ArrowRight,
  reload: RotateCw,
  minus: Minus,
  plus: Plus,
  copy: Copy,
  check: Check,
  home: LayoutDashboard,
  alert: TriangleAlert,
  download: Download,
  external: ExternalLink,
  loader: Loader,
  lock: Lock
}

export const isKnownIcon = (key: string): boolean =>
  key.startsWith('ui:') ? key.slice(3) in UI : key in BRANDS

// Opciones para elegir un icono a mano: logos de marca por nombre + genéricos
export const ICON_CHOICES: { key: IconKey; label: string }[] = [
  ...['server', 'box', 'monitor', 'globe', 'terminal', 'windows'].map((n) => ({
    key: `ui:${n}`,
    label: { server: 'Servidor', box: 'Contenedor', monitor: 'Equipo', globe: 'Web', terminal: 'Terminal', windows: 'Windows' }[n]!
  })),
  ...Object.entries(BRANDS)
    .map(([key, v]) => ({ key, label: v.title }))
    .sort((a, b) => a.label.localeCompare(b.label))
]

export function Icon({ k, size = 16, className }: { k: IconKey; size?: number; className?: string }): React.JSX.Element {
  const cls = `ico${className ? ` ${className}` : ''}`
  if (k.startsWith('ui:')) {
    const Glyph = UI[k.slice(3)] ?? Globe
    return <Glyph className={cls} size={size} strokeWidth={1.75} aria-hidden="true" />
  }
  const brand = BRANDS[k]
  if (!brand) return <Globe className={cls} size={size} strokeWidth={1.75} aria-hidden="true" />
  // Logo de marca monocromo: hereda el color del texto, así sigue al tema
  return (
    <svg className={cls} width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={brand.path} />
    </svg>
  )
}

// Función del guest: lo que sirve (iconos de sus paneles descubiertos) antes que el nombre o el SO
export function guestIconKey(g: Guest): IconKey {
  const panelIcons = g.panels.map((p) => iconForPanel(p, undefined, isKnownIcon))
  return iconForGuest({ ...g, panelIcons })
}

export function panelIconKey(p: Panel, guest: Guest | undefined): IconKey {
  return iconForPanel(p, guest, isKnownIcon)
}
