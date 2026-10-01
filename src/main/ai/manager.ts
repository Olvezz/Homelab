import { safeStorage } from 'electron'
import type { AiConnection, AiConnectionInput } from '../../shared/types'
import type { ConfigStore } from '../config/store'
import { log } from '../log'
import { ChatEngine } from './engine'
import { AiError, defaultBaseUrl, streamChat, type ProviderRuntime } from './providers'
import { buildSystemPrompt, createTools, type HomelabApi } from './tools'

// Conexiones con proveedores de IA (Claude, Gemini, compatibles con OpenAI, Ollama) y conversación con
// el asistente. Las claves de API se cifran con DPAPI (safeStorage) y no salen del proceso principal.
export class AiManager {
  private engine: ChatEngine
  // Sin cifrado disponible la clave no se guarda en disco: vive solo en memoria durante la sesión
  private sessionKeys = new Map<string, string>()

  constructor(
    private store: ConfigStore,
    private notify: (channel: string, payload: unknown) => void,
    api: HomelabApi,
    private eventChannel: string
  ) {
    const allow = (): boolean => this.store.get().ui.aiAllowActions
    this.engine = new ChatEngine({
      tools: createTools(api, allow),
      emit: (event) => this.notify(this.eventChannel, event),
      system: () => buildSystemPrompt(allow())
    })
  }

  list(): AiConnection[] {
    return this.store.get().ai.map(({ keyEnc, ...c }) => ({ ...c, hasKey: !!keyEnc || this.sessionKeys.has(c.id) }))
  }

  save(input: AiConnectionInput): AiConnection[] {
    const existing = input.id ? this.store.get().ai.find((c) => c.id === input.id) : undefined
    const id = existing?.id ?? `ai-${Math.random().toString(36).slice(2, 10)}`
    let keyEnc = existing?.keyEnc ?? null
    if (input.apiKey !== undefined) {
      this.sessionKeys.delete(id)
      if (!input.apiKey) keyEnc = null
      else if (safeStorage.isEncryptionAvailable()) keyEnc = safeStorage.encryptString(input.apiKey).toString('base64')
      else {
        keyEnc = null
        this.sessionKeys.set(id, input.apiKey)
      }
    }
    const next = { id, name: input.name, kind: input.kind, baseUrl: input.baseUrl || undefined, model: input.model, keyEnc }
    this.store.update((c) => {
      const i = c.ai.findIndex((x) => x.id === id)
      if (i >= 0) c.ai[i] = next
      else c.ai.push(next)
    })
    return this.list()
  }

  delete(id: string): AiConnection[] {
    this.sessionKeys.delete(id)
    this.store.update((c) => {
      c.ai = c.ai.filter((x) => x.id !== id)
    })
    return this.list()
  }

  private storedKey(id: string): string {
    const session = this.sessionKeys.get(id)
    if (session) return session
    const enc = this.store.get().ai.find((c) => c.id === id)?.keyEnc
    if (enc && safeStorage.isEncryptionAvailable()) {
      try {
        return safeStorage.decryptString(Buffer.from(enc, 'base64'))
      } catch {
        return ''
      }
    }
    return ''
  }

  private runtime(spec: { id?: string; kind: AiConnection['kind']; baseUrl?: string; model: string }, apiKey: string): ProviderRuntime {
    if (!apiKey && spec.kind !== 'ollama') throw new AiError('Falta la clave de API de esta conexión (Ajustes → Asistentes de IA)')
    return {
      kind: spec.kind,
      baseUrl: (spec.baseUrl || defaultBaseUrl(spec.kind)).replace(/\/+$/, ''),
      model: spec.model,
      apiKey
    }
  }

  // Prueba la conexión con una petición mínima (sin herramientas)
  async test(input: AiConnectionInput): Promise<{ ok: boolean; message: string }> {
    try {
      const key = input.apiKey !== undefined ? input.apiKey : input.id ? this.storedKey(input.id) : ''
      const rt = this.runtime(input, key)
      let text = ''
      for await (const ev of streamChat(rt, {
        system: 'Responde en español, en una sola palabra.',
        messages: [{ role: 'user', text: 'Responde solo con la palabra: ok' }],
        tools: [],
        maxTokens: 32
      })) {
        if (ev.type === 'text') text += ev.text
        if (text.length > 60) break
      }
      return { ok: true, message: `Conexión correcta con ${rt.model}${text.trim() ? `: «${text.trim().slice(0, 40)}»` : ''}` }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) }
    }
  }

  // La respuesta llega como eventos (ai:event); aquí nunca se lanza: los fallos también son eventos
  async send(connId: string, text: string, convId: string): Promise<void> {
    try {
      const conn = this.store.get().ai.find((c) => c.id === connId)
      if (!conn) throw new AiError('Elige una conexión de IA')
      const rt = this.runtime(conn, this.storedKey(conn.id))
      log.info(`IA: consulta a ${conn.kind}/${conn.model}`)
      await this.engine.send(rt, text, convId)
    } catch (e) {
      this.notify(this.eventChannel, { convId, type: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }

  stop(): void {
    this.engine.stop()
  }

  reset(): void {
    this.engine.reset()
  }

  approve(callId: string, ok: boolean): void {
    if (ok) log.info('IA: acción aprobada por el usuario')
    this.engine.approve(callId, ok)
  }
}
