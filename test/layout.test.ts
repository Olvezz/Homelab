import { describe, expect, it } from 'vitest'
import { assignFolder, defaultLayout, flatOrder, moveItem, movePin, organize, removeFolder, sortItems, togglePin } from '../src/shared/layout'

const items = [
  { id: 'c', name: 'Cloud' },
  { id: 'a', name: 'adguard' },
  { id: 'b', name: 'Bitwarden' },
  { id: 'n10', name: 'Nodo 10' },
  { id: 'n2', name: 'Nodo 2' }
]
const ids = (l: { id: string }[]): string[] => l.map((x) => x.id)
const folder = (id: string, section: 'panels' | 'ssh' = 'panels') => ({ id, name: 'F', color: '#e5484d', section })

describe('sortItems', () => {
  it('A-Z ignora mayúsculas y ordena los números como números', () => {
    expect(ids(sortItems(items, 'az', []))).toEqual(['a', 'b', 'c', 'n2', 'n10'])
  })
  it('Z-A es el inverso', () => {
    expect(ids(sortItems(items, 'za', []))).toEqual(['n10', 'n2', 'c', 'b', 'a'])
  })
  it('a mano respeta el orden y deja los nuevos al final', () => {
    expect(ids(sortItems(items, 'custom', ['c', 'a']))).toEqual(['c', 'a', 'b', 'n2', 'n10'])
  })
})

describe('organize', () => {
  it('separa fijados, carpetas y sueltos', () => {
    const l = { ...defaultLayout(), folders: [folder('f1')], folderOf: { a: 'f1', c: 'f1' }, pins: ['b'] }
    const o = organize(items, l, 'panels')
    expect(ids(o.pinned)).toEqual(['b'])
    expect(ids(o.groups[0].items)).toEqual(['a', 'c'])
    expect(ids(o.loose)).toEqual(['n2', 'n10'])
  })
  it('una carpeta de otra sección no afecta', () => {
    const l = { ...defaultLayout(), folders: [folder('f1', 'ssh')], folderOf: { a: 'f1' } }
    expect(organize(items, l, 'panels').loose).toHaveLength(5)
  })
})

describe('moveItem', () => {
  it('coloca antes de otro, entra en la carpeta y pasa la sección a «a mano»', () => {
    const l = moveItem(defaultLayout(), items, 'panels', 'n10', 'f1', 'a')
    expect(l.sort.panels).toBe('custom')
    expect(l.folderOf.n10).toBe('f1')
    expect(flatOrder(items, { ...l, folders: [folder('f1')] }, 'panels')).toEqual(['n10', 'a', 'b', 'c', 'n2'])
  })
  it('sin destino va al final y sale de su carpeta', () => {
    const l = moveItem({ ...defaultLayout(), folderOf: { a: 'f1' } }, items, 'panels', 'a', null, null)
    expect(l.folderOf.a).toBeUndefined()
    expect(l.order[l.order.length - 1]).toBe('a')
  })
  it('soltar un elemento sobre su propia posición no lo manda al final', () => {
    const l = moveItem(defaultLayout(), items, 'panels', 'b', 'f1', 'b')
    expect(flatOrder(items, { ...l, folders: [folder('f1')] }, 'panels')).toEqual(['b', 'a', 'c', 'n2', 'n10'])
  })
  it('mover un fijado lo desfija', () => {
    expect(moveItem({ ...defaultLayout(), pins: ['a'] }, items, 'panels', 'a', null, null).pins).toEqual([])
  })
})

describe('pins, carpetas y limpieza', () => {
  it('fija, desfija y reordena fijados', () => {
    let l = togglePin(togglePin(togglePin(defaultLayout(), 'a'), 'b'), 'c')
    expect(l.pins).toEqual(['a', 'b', 'c'])
    l = movePin(l, 'c', 'a')
    expect(l.pins).toEqual(['c', 'a', 'b'])
    expect(togglePin(l, 'a').pins).toEqual(['c', 'b'])
  })
  it('assignFolder cambia de carpeta sin tocar el orden', () => {
    const start = { ...defaultLayout(), order: ['a', 'b'] }
    const l = assignFolder(start, 'a', 'f1')
    expect(l.folderOf.a).toBe('f1')
    expect(l.order).toEqual(['a', 'b'])
    expect(assignFolder(l, 'a', null).folderOf).toEqual({})
  })
  it('borrar una carpeta suelta sus elementos', () => {
    const l = removeFolder({ ...defaultLayout(), folders: [folder('f1')], folderOf: { a: 'f1' } }, 'f1')
    expect(l.folders).toEqual([])
    expect(l.folderOf).toEqual({})
  })
})
