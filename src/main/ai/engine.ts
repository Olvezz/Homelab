import type { AiEvent } from '../../shared/types'
import { streamChat, type Msg, type ProviderRuntime, type ToolCall } from './providers'
import type { ToolRuntime } from './tools'

const MAX_ROUNDS = 8
const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000
const MAX_RESULT_TO_MODEL = 12000
const MAX_RESULT_TO_UI = 4000

export interface EngineDeps {
  tools: ToolRuntime
  emit: (event: AiEvent) => void
  system: () => string
  stream?: typeof streamChat // sustituible en las pruebas
}

const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max)}\n…(recortado)` : text)

// Conversación con el modelo y bucle de herramientas. Las herramientas que cambian algo esperan siempre
// la aprobación del usuario (approve) antes de ejecutarse; sin respuesta en 5 minutos se deniegan.
export class ChatEngine {
  private history: Msg[] = []
  private pending = new Map<string, (ok: boolean) => void>()
  private abort: AbortController | null = null
  private running = false
  private seq = 0 // contador para que los ids de llamada sean únicos en toda la conversación

  constructor(private deps: EngineDeps) {}

  get busy(): boolean {
    return this.running
  }

  reset(): void {
    this.stop()
    this.history = []
  }

  stop(): void {
    this.abort?.abort()
    for (const resolve of this.pending.values()) resolve(false)
    this.pending.clear()
  }

  approve(callId: string, ok: boolean): void {
    const resolve = this.pending.get(callId)
    if (!resolve) return
    this.pending.delete(callId)
    resolve(ok)
  }

  private askApproval(callId: string, signal: AbortSignal): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const done = (ok: boolean): void => {
        clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
        resolve(ok)
      }
      const onAbort = (): void => {
        this.pending.delete(callId)
        done(false)
      }
      const timer = setTimeout(() => {
        this.pending.delete(callId)
        done(false)
      }, APPROVAL_TIMEOUT_MS)
      signal.addEventListener('abort', onAbort)
      this.pending.set(callId, done)
    })
  }

  async send(rt: ProviderRuntime, text: string, convId: string): Promise<void> {
    if (this.running) throw new Error('Ya hay una respuesta en curso')
    const { tools, emit } = this.deps
    const stream = this.deps.stream ?? streamChat
    this.running = true
    const abort = new AbortController()
    this.abort = abort
    let safe = this.history.length // punto al que volver si algo falla a medias (se avanza al cerrar cada ronda)
    this.history.push({ role: 'user', text })

    try {
      for (let round = 0; round < MAX_ROUNDS; round++) {
        let said = ''
        const calls: ToolCall[] = []
        for await (const ev of stream(rt, {
          system: this.deps.system(),
          messages: this.history,
          tools: tools.definitions(),
          signal: abort.signal
        })) {
          if (ev.type === 'text') {
            said += ev.text
            emit({ convId, type: 'text', text: ev.text })
          } else calls.push(ev.call)
        }
        // Los proveedores no garantizan ids únicos (Gemini reinicia «g1» en cada respuesta): se renombran de
        // forma consistente en el historial y en la interfaz para que cada tarjeta y cada aprobación sean suyas
        for (const c of calls) c.id = `c${++this.seq}-${c.id.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40)}`
        this.history.push({ role: 'assistant', text: said, calls })
        if (calls.length === 0) break

        for (const call of calls) {
          const d = tools.describe(call.name, call.args)
          if (!d) {
            this.history.push({ role: 'tool', callId: call.id, name: call.name, text: `Error: herramienta desconocida o no disponible (${call.name})` })
            emit({ convId, type: 'tool-result', callId: call.id, status: 'error', result: 'Herramienta no disponible' })
            continue
          }
          emit({ convId, type: 'tool', callId: call.id, name: call.name, summary: d.summary, detail: d.detail, status: d.mutating ? 'awaiting' : 'running' })

          let result: string
          let status: 'done' | 'error' | 'denied' = 'done'
          if (d.mutating && !(await this.askApproval(call.id, abort.signal))) {
            if (abort.signal.aborted) throw new DOMException('Cancelado', 'AbortError')
            result = 'El usuario rechazó esta acción. No la repitas.'
            status = 'denied'
          } else {
            try {
              result = await tools.execute(call.name, call.args)
            } catch (e) {
              result = `Error: ${e instanceof Error ? e.message : String(e)}`
              status = 'error'
            }
          }
          this.history.push({ role: 'tool', callId: call.id, name: call.name, text: clip(result, MAX_RESULT_TO_MODEL) })
          emit({ convId, type: 'tool-result', callId: call.id, status, result: clip(result, MAX_RESULT_TO_UI) })
        }
        safe = this.history.length
        if (round === MAX_ROUNDS - 1) emit({ convId, type: 'text', text: '\n\n(Se alcanzó el máximo de pasos seguidos; dime si quieres que continúe.)' })
      }
      emit({ convId, type: 'done' })
    } catch (e) {
      this.history.length = safe
      if (abort.signal.aborted) emit({ convId, type: 'done' })
      else emit({ convId, type: 'error', message: e instanceof Error ? e.message : String(e) })
    } finally {
      this.pending.clear()
      this.running = false
      this.abort = null
    }
  }
}
