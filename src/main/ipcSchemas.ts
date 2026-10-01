import { z } from 'zod'

// Validación de los argumentos que llegan por IPC desde la UI (sin dependencias de Electron).

export const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/)

export const hostSchema = z.string().regex(/^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/)
export const portSchema = z.number().int().min(1).max(65535)

export const fingerprintSchema = z.string().regex(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/)

export const connectionSchema = z.object({
  host: hostSchema,
  port: portSchema,
  // usuario@realm!nombre-del-token
  tokenId: z.string().regex(/^[^@\s!]{1,64}@[A-Za-z0-9._-]{1,32}![A-Za-z0-9._-]{2,64}$/),
  secret: z.string().regex(/^[A-Za-z0-9-]{8,128}$/),
  fingerprint: fingerprintSchema,
  pollIntervalSec: z.number().int().min(5).max(300)
})

export const guestRefSchema = z.object({
  node: z.string().regex(/^[A-Za-z0-9-]{1,63}$/),
  type: z.enum(['qemu', 'lxc']),
  vmid: z.number().int().min(1).max(999999999)
})

export const sshConnectionSchema = z.object({
  id: z.string().regex(/^ssh-[a-z0-9-]{1,40}$/).optional(),
  name: z.string().trim().min(1).max(60),
  host: hostSchema,
  port: portSchema,
  username: z.string().regex(/^[A-Za-z0-9._$@-]{1,64}$/),
  auth: z.enum(['password', 'key', 'agent']),
  keyPath: z.string().max(500).optional(),
  secret: z.string().max(1000).optional()
})

export const nativeThemeSchema = z.enum(['dark', 'light'])

export const powerActionSchema = z.enum(['start', 'shutdown', 'stop', 'reboot'])

export const guestNameSchema = z.string().max(100)

export const httpUrlSchema = z
  .string()
  .max(2048)
  .refine((v) => {
    try {
      const { protocol } = new URL(v)
      return protocol === 'http:' || protocol === 'https:'
    } catch {
      return false
    }
  }, 'URL inválida: solo se permiten http y https')

export const navSchema = z.enum([
  'back',
  'forward',
  'reload',
  'openExternal',
  'copyUrl',
  'zoomIn',
  'zoomOut',
  'zoomReset'
])

export const certDecisionSchema = z.tuple([z.string().min(1).max(255), z.string().max(200), z.boolean()])

export const aiConnectionSchema = z.object({
  id: z.string().regex(/^ai-[a-z0-9-]{1,40}$/).optional(),
  name: z.string().trim().min(1).max(60),
  kind: z.enum(['anthropic', 'gemini', 'openai', 'ollama']),
  baseUrl: httpUrlSchema.optional(),
  model: z.string().regex(/^[A-Za-z0-9._:/-]{1,100}$/),
  apiKey: z.string().max(500).optional()
})
