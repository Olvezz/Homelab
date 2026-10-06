// Markdown mínimo para mostrar los documentos legales dentro de la aplicación: títulos, párrafos, listas,
// citas, tablas, bloques de código y negritas/código en línea. No ejecuta HTML: todo se pinta como texto.

export type Block =
  | { t: 'h1' | 'h2' | 'h3' | 'p' | 'quote' | 'code'; text: string }
  | { t: 'ul'; items: string[] }
  | { t: 'table'; head: string[]; rows: string[][] }

const cells = (line: string): string[] =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim())

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n/g, '\n').split('\n')
  const out: Block[] = []
  let para: string[] = []
  const flush = (): void => {
    if (para.length) out.push({ t: 'p', text: para.join(' ') })
    para = []
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.trimStart().startsWith('```')) {
      flush()
      const code: string[] = []
      for (i++; i < lines.length && !lines[i].trimStart().startsWith('```'); i++) code.push(lines[i])
      out.push({ t: 'code', text: code.join('\n') })
      continue
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line)
    if (h) {
      flush()
      out.push({ t: (['h1', 'h2', 'h3'] as const)[h[1].length - 1], text: h[2] })
    } else if (line.startsWith('>')) {
      flush()
      out.push({ t: 'quote', text: line.replace(/^>\s?/, '') })
    } else if (/^\s*[-*]\s+/.test(line)) {
      flush()
      const last = out[out.length - 1]
      const item = line.replace(/^\s*[-*]\s+/, '')
      if (last?.t === 'ul') last.items.push(item)
      else out.push({ t: 'ul', items: [item] })
    } else if (line.includes('|') && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1] ?? '')) {
      flush()
      const head = cells(line)
      const rows: string[][] = []
      for (i += 2; i < lines.length && lines[i].includes('|'); i++) rows.push(cells(lines[i]))
      i--
      out.push({ t: 'table', head, rows })
    } else if (line.trim() === '') flush()
    else para.push(line.trim())
  }
  flush()
  return out
}

export interface Span {
  text: string
  bold?: boolean
  code?: boolean
}

// **negrita** y `código` en línea
export function inline(text: string): Span[] {
  const spans: Span[] = []
  const re = /\*\*(.+?)\*\*|`([^`]+)`/g
  let last = 0
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) spans.push({ text: text.slice(last, m.index) })
    spans.push(m[1] !== undefined ? { text: m[1], bold: true } : { text: m[2], code: true })
    last = m.index + m[0].length
  }
  if (last < text.length) spans.push({ text: text.slice(last) })
  return spans
}
