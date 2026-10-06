import { describe, expect, it } from 'vitest'
import { inline, parseMarkdown } from '../src/renderer/markdownLite'

describe('parseMarkdown', () => {
  it('títulos, párrafos (las líneas seguidas se unen) y citas', () => {
    const b = parseMarkdown('# Título\n\nprimera línea\nsegunda línea\n\n## Sección\n> aviso')
    expect(b).toEqual([
      { t: 'h1', text: 'Título' },
      { t: 'p', text: 'primera línea segunda línea' },
      { t: 'h2', text: 'Sección' },
      { t: 'quote', text: 'aviso' }
    ])
  })
  it('agrupa las viñetas en una lista', () => {
    expect(parseMarkdown('- uno\n- dos\n* tres')).toEqual([{ t: 'ul', items: ['uno', 'dos', 'tres'] }])
  })
  it('lee tablas', () => {
    const b = parseMarkdown('| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n\nfin')
    expect(b[0]).toEqual({ t: 'table', head: ['A', 'B'], rows: [['1', '2'], ['3', '4']] })
    expect(b[1]).toEqual({ t: 'p', text: 'fin' })
  })
  it('un bloque de código conserva sus líneas y no se interpreta', () => {
    const b = parseMarkdown('```\n# no es título\n- ni lista\n```\ntexto')
    expect(b[0]).toEqual({ t: 'code', text: '# no es título\n- ni lista' })
    expect(b[1]).toEqual({ t: 'p', text: 'texto' })
  })
  it('un | suelto en un párrafo no lo convierte en tabla', () => {
    expect(parseMarkdown('a | b')).toEqual([{ t: 'p', text: 'a | b' }])
  })
})

describe('inline', () => {
  it('separa negrita y código', () => {
    expect(inline('hola **mundo** y `x`')).toEqual([{ text: 'hola ' }, { text: 'mundo', bold: true }, { text: ' y ' }, { text: 'x', code: true }])
  })
  it('el HTML queda como texto', () => {
    expect(inline('<b>x</b>')).toEqual([{ text: '<b>x</b>' }])
  })
})
