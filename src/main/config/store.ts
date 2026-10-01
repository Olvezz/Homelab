import { app } from 'electron'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import { DEFAULT_SIDEBAR_WIDTH, type Panel, type UiConfig } from '../../shared/types'
import { connectionSchema, fingerprintSchema, hostSchema, httpUrlSchema, portSchema } from '../ipcSchemas'

export const panelSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
  name: z.string().trim().min(1).max(60),
  url: httpUrlSchema,
  icon: z.string().max(30).optional(),
  source: z.enum(['manual', 'proxmox-notes', 'proxmox-tag']),
  vmid: z.number().int().positive().optional()
})

export const panelsSchema = z
  .array(panelSchema)
  .max(50)
  .refine((list) => new Set(list.map((p) => p.id)).size === list.length, 'IDs de panel repetidos')

const themeSchema = z.string().regex(/^[a-z0-9-]{1,40}$/)

export const uiPatchSchema = z
  .object({
    theme: themeSchema,
    sidebarWidth: z.number().int().min(160).max(480),
    sidebarCollapsed: z.boolean(),
    closeToTray: z.boolean(),
    startWithWindows: z.boolean(),
    showTemplates: z.boolean(),
    aiAllowActions: z.boolean(),
    lastAiId: z.string().regex(/^ai-[a-z0-9-]{1,40}$/),
    autoUpdate: z.boolean(),
    lastActiveId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/)
  })
  .partial()

const defaultUi: UiConfig = {
  theme: 'proxmox',
  sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
  sidebarCollapsed: false,
  closeToTray: true,
  startWithWindows: false,
  showTemplates: false,
  aiAllowActions: true,
  autoUpdate: true
}

// Paneles de ejemplo, editables desde Ajustes
const seedPanels: Panel[] = [
  { id: 'manual-proxmox', name: 'Proxmox', url: 'https://10.0.0.50:8006', source: 'manual' },
  { id: 'manual-portainer', name: 'Portainer', url: 'http://10.0.0.53:9000', source: 'manual' }
]

// Conexión al API de Proxmox. El secreto va cifrado con safeStorage (DPAPI); nunca en claro.
const pveSchema = z.object({
  host: hostSchema,
  port: portSchema,
  tokenId: connectionSchema.shape.tokenId,
  tokenSecretEnc: z.string().nullable(), // base64; null = no se pudo cifrar, se pide en cada arranque
  fingerprint: fingerprintSchema,
  pollIntervalSec: connectionSchema.shape.pollIntervalSec
})

// Carga tolerante: un panel dañado se descarta, los demás se conservan (no se vuelve a los de ejemplo
// por un solo registro roto). Solo un archivo sin lista usa los paneles de ejemplo.
const lenientPanels = z.unknown().transform((raw): Panel[] => {
  if (!Array.isArray(raw)) return seedPanels
  const seen = new Set<string>()
  const out: Panel[] = []
  for (const item of raw) {
    const r = panelSchema.safeParse(item)
    if (r.success && !seen.has(r.data.id)) {
      seen.add(r.data.id)
      out.push(r.data as Panel)
    }
  }
  return out
})

const sshConnSchema = z.object({
  id: z.string().regex(/^ssh-[a-z0-9-]{1,40}$/),
  name: z.string().trim().min(1).max(60),
  host: hostSchema,
  port: portSchema,
  username: z.string().regex(/^[A-Za-z0-9._$@-]{1,64}$/),
  auth: z.enum(['password', 'key', 'agent']),
  keyPath: z.string().max(500).optional(),
  secretEnc: z.string().nullable() // base64 (safeStorage); null = se pide al conectar
})

const aiConnSchema = z.object({
  id: z.string().regex(/^ai-[a-z0-9-]{1,40}$/),
  name: z.string().trim().min(1).max(60),
  kind: z.enum(['anthropic', 'gemini', 'openai', 'ollama']),
  baseUrl: httpUrlSchema.optional(),
  model: z.string().regex(/^[A-Za-z0-9._:/-]{1,100}$/),
  keyEnc: z.string().nullable() // base64 (safeStorage); null = sin clave o solo en memoria
})

const configSchema = z.object({
  // Versión de la app que escribió el archivo por última vez (para copias de seguridad al actualizar)
  appVersion: z.string().optional().catch(undefined),
  panels: lenientPanels,
  ui: z
    .object({
      // 'dark' era el valor por defecto antiguo: ahora el defecto es seguir a Proxmox
      theme: themeSchema.transform((v) => (v === 'dark' ? 'proxmox' : v)).catch(defaultUi.theme),
      sidebarWidth: z.number().int().min(160).max(480).catch(defaultUi.sidebarWidth),
      sidebarCollapsed: z.boolean().catch(defaultUi.sidebarCollapsed),
      closeToTray: z.boolean().catch(defaultUi.closeToTray),
      startWithWindows: z.boolean().catch(defaultUi.startWithWindows),
      showTemplates: z.boolean().catch(defaultUi.showTemplates),
      aiAllowActions: z.boolean().catch(defaultUi.aiAllowActions),
      lastAiId: z.string().optional().catch(undefined),
      autoUpdate: z.boolean().catch(defaultUi.autoUpdate),
      lastActiveId: z.string().optional().catch(undefined)
    })
    .catch(defaultUi),
  // hostname -> huella SHA-256 (hex) aceptada por el usuario (TOFU) para las vistas web
  trustedCerts: z.record(z.string(), z.string()).catch({}),
  pve: pveSchema.nullable().catch(null),
  // Orígenes fuera de rangos privados que el usuario aprobó para paneles descubiertos
  approvedExternal: z.array(z.string()).catch([]),
  // Conexiones SSH guardadas (reemplazo de PuTTY) y huellas de servidor aceptadas (TOFU)
  ai: z.array(aiConnSchema).max(20).catch([]), // conexiones con proveedores de IA
  ssh: z.array(sshConnSchema).max(200).catch([]),
  sshHostKeys: z.record(z.string(), z.string()).catch({}),
  // Script que se ejecuta en cada guest nuevo (null = el predeterminado de la app)
  provisionScript: z.string().max(20000).nullable().catch(null)
})

export type StoredConfig = z.infer<typeof configSchema>
export type StoredPve = z.infer<typeof pveSchema>

export class ConfigStore {
  private path = join(app.getPath('userData'), 'config.json')
  private data: StoredConfig

  constructor() {
    const dir = dirname(this.path)
    const existed = existsSync(this.path)
    let raw: unknown = {}
    if (existed) {
      try {
        raw = JSON.parse(readFileSync(this.path, 'utf8'))
      } catch {
        // Archivo ilegible: se aparta (nunca se sobrescribe) para poder recuperarlo a mano
        try {
          renameSync(this.path, join(dir, `config.corrupt-${Date.now()}.json`))
        } catch {
          // sin permisos para renombrar: se seguirá con los valores por defecto
        }
      }
    }
    const parsed = configSchema.safeParse(raw)
    this.data = parsed.success
      ? parsed.data
      : { panels: seedPanels, ui: defaultUi, trustedCerts: {}, pve: null, approvedExternal: [], provisionScript: null, ai: [], ssh: [], sshHostKeys: {} }

    // Al cambiar de versión se guarda una copia del archivo anterior; los datos viven en
    // %APPDATA%, fuera de la carpeta de la app, así que instalar encima no los toca.
    const current = app.getVersion()
    if (existed && this.data.appVersion !== current) {
      this.backup(dir, this.data.appVersion ?? 'anterior')
    }
    this.data.appVersion = current
    if (existed) this.save()
  }

  private backup(dir: string, fromVersion: string): void {
    try {
      copyFileSync(this.path, join(dir, `config.backup-v${fromVersion}.json`))
      // Se conservan las 5 copias más recientes
      const backups = readdirSync(dir)
        .filter((f) => /^config.backup-v.+.json$/.test(f))
        .map((f) => ({ f, t: statSafe(join(dir, f)) }))
        .sort((a, b) => b.t - a.t)
      for (const old of backups.slice(5)) rmSync(join(dir, old.f), { force: true })
    } catch {
      // una copia fallida no debe impedir arrancar
    }
  }

  get(): Readonly<StoredConfig> {
    return this.data
  }

  update(mutate: (draft: StoredConfig) => void): void {
    mutate(this.data)
    this.save()
  }

  private save(): void {
    mkdirSync(dirname(this.path), { recursive: true })
    const tmp = `${this.path}.tmp`
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8')
    renameSync(tmp, this.path)
  }
}

function statSafe(path: string): number {
  try {
    return statSync(path).mtimeMs
  } catch {
    return 0
  }
}
