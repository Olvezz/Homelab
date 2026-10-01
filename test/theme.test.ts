import { describe, expect, it } from 'vitest'
import { extractTheme, luminance, mix, parseColor, themeTokens } from '../src/shared/proxmorph'
import { resolveTheme, THEMES } from '../src/renderer/theme'

const css = `/*!Mi Tema*/
:root {
  /* comentario */
  --base: #0d1117;
  --txt: #f0f6fc;
  --acc: rgb(31, 111, 235);
  --ok-success: #3fb950;
  --pwt-panel-background: var(--base);
  --pwt-text-color: var(--txt);
  --pwt-gauge-default: var(--acc);
  --pwt-gauge-back: #21262d;
  --pwt-gauge-warn: var(--missing, #d29922);
  --pwt-gauge-crit: #da3633;
  --pwt-chart-primary: var(--acc);
  --pwt-chart-grid-stroke: #3d444d;
}
.x-body { color: red; }`

describe('extractTheme', () => {
  it('resuelve var(), comentarios y valores de reserva', () => {
    const t = extractTheme('mi-tema', css)!
    expect(t.name).toBe('Mi Tema')
    expect(t.dark).toBe(true)
    expect(t.colors).toMatchObject({
      bg: '#0d1117',
      text: '#f0f6fc',
      accent: 'rgb(31, 111, 235)',
      warn: '#d29922',
      crit: '#da3633',
      success: '#3fb950'
    })
  })
  it('devuelve null si falta alguna variable base', () => {
    expect(extractTheme('x', ':root { --pwt-panel-background: #000; }')).toBeNull()
  })
})

describe('colores', () => {
  it('parsea hex corto/largo y rgb', () => {
    expect(parseColor('#fff')).toEqual([255, 255, 255])
    expect(parseColor('#0d1117')).toEqual([13, 17, 23])
    expect(parseColor('rgba(1, 2, 3, 0.5)')).toEqual([1, 2, 3])
    expect(parseColor('nada')).toBeNull()
  })
  it('mezcla y luminancia', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080')
    expect(luminance('#000000')).toBe(0)
    expect(luminance('#ffffff')).toBeCloseTo(1)
  })
})

describe('temas de ProxMorph incluidos', () => {
  it('trae los temas del repo, entre ellos github-dark', () => {
    expect(THEMES.length).toBeGreaterThanOrEqual(20)
    expect(THEMES.find((t) => t.id === 'github-dark')?.colors.bg).toBe('#0d1117')
  })
  it('todos generan tokens con colores válidos y texto legible', () => {
    for (const t of THEMES) {
      const tokens = themeTokens(t)
      for (const [name, value] of Object.entries(tokens)) {
        if (name === 'color-scheme' || name === '--backdrop') continue
        expect(parseColor(value), `${t.id} ${name}=${value}`).not.toBeNull()
      }
      // contraste texto/fondo mínimo razonable
      const l1 = luminance(tokens['--text'])
      const l2 = luminance(tokens['--bg'])
      const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
      expect(ratio, `${t.id} contraste`).toBeGreaterThan(4.5)
    }
  })
})

describe('resolveTheme', () => {
  it('sigue la cookie de Proxmox', () => {
    expect(resolveTheme('proxmox', 'dracula', false).theme?.id).toBe('dracula')
    expect(resolveTheme('proxmox', 'nord-light', true)).toMatchObject({ mode: 'light' })
  })
  it('sin cookie o con un tema desconocido usa github-dark', () => {
    expect(resolveTheme('proxmox', null, false).theme?.id).toBe('github-dark')
    expect(resolveTheme('proxmox', 'inventado', false).theme?.id).toBe('github-dark')
  })
  it('el claro de fábrica de Proxmox (crisp) usa la paleta clara básica', () => {
    expect(resolveTheme('proxmox', 'crisp', true)).toMatchObject({ mode: 'light', theme: null })
  })
  it('un tema fijo ignora la cookie', () => {
    expect(resolveTheme('tokyo-night', 'dracula', false).theme?.id).toBe('tokyo-night')
  })
  it('system alterna según el SO', () => {
    expect(resolveTheme('system', null, true).mode).toBe('dark')
    expect(resolveTheme('system', null, false).mode).toBe('light')
  })
})
