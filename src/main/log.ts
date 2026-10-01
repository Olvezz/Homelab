import { app } from 'electron'
import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

const MAX_BYTES = 1_000_000
const KEEP = 3

let dir = ''

// Nunca se escriben secretos ni cabeceras de autorización
export function redact(text: string): string {
  return text
    .replace(/PVEAPIToken=\S+/gi, 'PVEAPIToken=***')
    .replace(/(authorization|secret|token)(["']?\s*[:=]\s*["']?)[^\s"',;]+/gi, '$1$2***')
}

function rotate(file: string): void {
  try {
    if (!existsSync(file) || statSync(file).size < MAX_BYTES) return
    rmSync(`${file}.${KEEP}`, { force: true })
    for (let i = KEEP - 1; i >= 1; i--) {
      if (existsSync(`${file}.${i}`)) renameSync(`${file}.${i}`, `${file}.${i + 1}`)
    }
    renameSync(file, `${file}.1`)
  } catch {
    // el log nunca debe romper la app
  }
}

function write(level: string, message: string): void {
  try {
    if (!dir) {
      dir = join(app.getPath('userData'), 'logs')
      mkdirSync(dir, { recursive: true })
    }
    const file = join(dir, 'app.log')
    rotate(file)
    appendFileSync(file, `${new Date().toISOString()} ${level} ${redact(message)}\n`, 'utf8')
  } catch {
    // idem
  }
}

export const log = {
  info: (message: string): void => write('INFO', message),
  warn: (message: string): void => write('WARN', message),
  error: (message: string): void => write('ERROR', message)
}
