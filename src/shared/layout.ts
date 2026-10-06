// Organización de la barra lateral: orden (A-Z, Z-A o a mano), carpetas con color y elementos fijados.
// Lógica pura (sin Electron ni React) para poder probarla.

export type SortMode = 'az' | 'za' | 'custom'
export type LayoutSection = 'panels' | 'ssh'
export type SidebarSection = 'proxmox' | 'panels' | 'ssh' // secciones de la barra lateral que se pueden plegar

export interface SidebarFolder {
  id: string
  name: string
  color: string // #rrggbb
  section: LayoutSection
  collapsed?: boolean
}

export interface SidebarLayout {
  sort: Record<LayoutSection, SortMode>
  order: string[] // orden a mano: ids de paneles y de conexiones SSH
  pins: string[] // fijados, en el orden en que se muestran
  folders: SidebarFolder[]
  folderOf: Record<string, string> // id de elemento -> id de carpeta
  collapsedSections: SidebarSection[] // secciones plegadas
}

export const FOLDER_COLORS = ['#e5484d', '#f76b15', '#f5b800', '#30a46c', '#12a594', '#3e63dd', '#8e4ec6', '#d6409f', '#8b8d98']

export const defaultLayout = (): SidebarLayout => ({
  sort: { panels: 'az', ssh: 'az' },
  order: [],
  pins: [],
  folders: [],
  folderOf: {},
  collapsedSections: []
})

export interface Named {
  id: string
  name: string
}

const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true })

// Ordena según el modo. En `custom` los elementos nuevos (sin sitio en `order`) van al final, por nombre.
export function sortItems<T extends Named>(items: readonly T[], mode: SortMode, order: readonly string[]): T[] {
  const byName = [...items].sort((a, b) => collator.compare(a.name, b.name))
  if (mode === 'az') return byName
  if (mode === 'za') return byName.reverse()
  const pos = new Map(order.map((id, i) => [id, i]))
  const known = byName.filter((x) => pos.has(x.id)).sort((a, b) => pos.get(a.id)! - pos.get(b.id)!)
  return [...known, ...byName.filter((x) => !pos.has(x.id))]
}

export interface Organized<T> {
  pinned: T[]
  groups: { folder: SidebarFolder; items: T[] }[]
  loose: T[]
}

// Reparte los elementos de una sección en fijados, carpetas y sueltos (cada uno ya ordenado)
export function organize<T extends Named>(items: readonly T[], layout: SidebarLayout, section: LayoutSection): Organized<T> {
  const pinSet = new Set(layout.pins)
  const pinned = layout.pins.map((id) => items.find((x) => x.id === id)).filter((x): x is T => !!x)
  const rest = sortItems(
    items.filter((x) => !pinSet.has(x.id)),
    layout.sort[section],
    layout.order
  )
  const folders = layout.folders.filter((f) => f.section === section)
  const folderIdOf = (x: T): string | undefined => folders.find((f) => f.id === layout.folderOf[x.id])?.id
  return {
    pinned,
    groups: folders.map((folder) => ({ folder, items: rest.filter((x) => folderIdOf(x) === folder.id) })),
    loose: rest.filter((x) => !folderIdOf(x))
  }
}

// Orden en que se ven los elementos de la sección (carpetas primero, luego los sueltos), sin fijados
export function flatOrder<T extends Named>(items: readonly T[], layout: SidebarLayout, section: LayoutSection): string[] {
  const o = organize(items, layout, section)
  return [...o.groups.flatMap((g) => g.items), ...o.loose].map((x) => x.id)
}

function insertAt(list: string[], id: string, beforeId: string | null): string[] {
  if (beforeId === id) return list.includes(id) ? list : [...list, id] // soltado en su propio sitio
  const out = list.filter((x) => x !== id)
  const i = beforeId ? out.indexOf(beforeId) : -1
  if (i < 0) out.push(id)
  else out.splice(i, 0, id)
  return out
}

// Mueve un elemento a una carpeta (o fuera de ellas con `folderId` null) y lo coloca antes de `beforeId`
// (null = al final). Deja la sección en orden «a mano» partiendo de lo que se veía.
export function moveItem<T extends Named>(
  layout: SidebarLayout,
  items: readonly T[],
  section: LayoutSection,
  id: string,
  folderId: string | null,
  beforeId: string | null
): SidebarLayout {
  const sectionIds = new Set(items.map((x) => x.id))
  const next = insertAt(flatOrder(items, layout, section), id, beforeId)
  const folderOf = { ...layout.folderOf }
  if (folderId) folderOf[id] = folderId
  else delete folderOf[id]
  return {
    ...layout,
    sort: { ...layout.sort, [section]: 'custom' },
    order: [...layout.order.filter((x) => !sectionIds.has(x) && x !== id), ...next],
    pins: layout.pins.filter((p) => p !== id),
    folderOf
  }
}

// Cambia la carpeta de un elemento sin tocar el orden (menú «Mover a…»)
export function assignFolder(layout: SidebarLayout, id: string, folderId: string | null): SidebarLayout {
  const folderOf = { ...layout.folderOf }
  if (folderId) folderOf[id] = folderId
  else delete folderOf[id]
  return { ...layout, folderOf }
}

export function togglePin(layout: SidebarLayout, id: string): SidebarLayout {
  return { ...layout, pins: layout.pins.includes(id) ? layout.pins.filter((p) => p !== id) : [...layout.pins, id] }
}

// Reordena los fijados: `id` pasa a estar antes de `beforeId` (null = al final)
export function movePin(layout: SidebarLayout, id: string, beforeId: string | null): SidebarLayout {
  return layout.pins.includes(id) ? { ...layout, pins: insertAt(layout.pins, id, beforeId) } : layout
}

export function removeFolder(layout: SidebarLayout, folderId: string): SidebarLayout {
  const folderOf = Object.fromEntries(Object.entries(layout.folderOf).filter(([, f]) => f !== folderId))
  return { ...layout, folders: layout.folders.filter((f) => f.id !== folderId), folderOf }
}
