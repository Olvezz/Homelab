import { describe, expect, it } from 'vitest'
import { iconCandidates, normalizeDataIcon } from '../src/main/iconParse'

// Como pulserelay.pro: <link> en varias líneas con un SVG dentro del data: URI (con `>` sin escapar)
const pulseHtml = `<head>
    <link rel="icon" type="image/svg+xml"
        href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><circle cx=%2250%22 cy=%2250%22 r=%2245%22 fill=%22%232563eb%22/></svg>">
    <link rel="stylesheet" href="index.css">
    <link rel="icon" type="image/svg+xml"
        href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 256 256'%3E%3Ccircle fill='%233b82f6' cx='128' cy='128' r='122'/%3E%3C/svg%3E">
</head>`

describe('iconCandidates', () => {
  it('lee links multilínea con data: URI que contienen > y toma el último declarado', () => {
    const c = iconCandidates(pulseHtml, 'https://pulserelay.pro/')
    expect(c).toHaveLength(2)
    expect(c[0]).toContain('%3Csvg') // el segundo (último) primero
  })
  it('apple-touch-icon y tamaños mayores van antes; resuelve rutas relativas', () => {
    const html = `<link rel="icon" href="/a.ico" sizes="16x16"><link rel="apple-touch-icon" href="touch.png"><link rel="icon" href="/b.png" sizes="192x192">`
    expect(iconCandidates(html, 'https://x.test/app/')).toEqual(['https://x.test/app/touch.png', 'https://x.test/b.png', 'https://x.test/a.ico'])
  })
  it('ignora links que no son iconos y protocolos raros', () => {
    expect(iconCandidates(`<link rel="stylesheet" href="a.css"><link rel="icon" href="javascript:alert(1)">`, 'https://x.test/')).toEqual([])
  })
  it("acepta comillas simples y atributos sin comillas", () => {
    expect(iconCandidates(`<link rel='shortcut icon' href=/f.ico>`, 'https://x.test/')).toEqual(['https://x.test/f.ico'])
  })
})

describe('normalizeDataIcon', () => {
  it('convierte un SVG URL-encoded en base64', () => {
    const c = iconCandidates(pulseHtml, 'https://pulserelay.pro/')
    const out = normalizeDataIcon(c[0])!
    expect(out.startsWith('data:image/svg+xml;base64,')).toBe(true)
    expect(Buffer.from(out.split(',')[1], 'base64').toString()).toContain('<svg')
  })
  it('respeta base64 y rechaza tipos no permitidos', () => {
    expect(normalizeDataIcon('data:image/png;base64,iVBORw0KGgo=')).toBe('data:image/png;base64,iVBORw0KGgo=')
    expect(normalizeDataIcon('data:text/html,<script>alert(1)</script>')).toBeNull()
  })
  it('lo que supera el límite se descarta', () => {
    expect(normalizeDataIcon(`data:image/svg+xml,${'a'.repeat(90_000)}`)).toBeNull()
  })
})
