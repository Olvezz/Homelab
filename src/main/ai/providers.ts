import type { AiKind } from '../../shared/types'

// Adaptadores de proveedores de IA con una interfaz común de streaming. Todo corre en el proceso
// principal: la clave de API nunca llega al renderer.

export interface ProviderRuntime {
  kind: AiKind
  baseUrl: string
  model: string
  apiKey: string
}

export interface ToolDef {
  name: string
  description: string
  parameters: Record<string, unknown> // JSON Schema (type: object)
}

export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
}

// Historial neutral; cada proveedor lo convierte a su formato
export type Msg =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string; calls: ToolCall[] }
  | { role: 'tool'; callId: string; name: string; text: string }

export type StreamEvent = { type: 'text'; text: string } | { type: 'call'; call: ToolCall }

export interface ChatRequest {
  system: string
  messages: Msg[]
  tools: ToolDef[]
  signal?: AbortSignal
  maxTokens?: number
}

// Error con mensaje ya en español y sin datos sensibles
export class AiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AiError'
  }
}

export function defaultBaseUrl(kind: AiKind): string {
  switch (kind) {
    case 'anthropic':
      return 'https://api.anthropic.com'
    case 'gemini':
      return 'https://generativelanguage.googleapis.com'
    case 'openai':
      return 'https://api.openai.com/v1'
    case 'ollama':
      return 'http://localhost:11434/v1'
  }
}

export const DEFAULT_MODELS: Record<AiKind, string> = {
  anthropic: 'claude-sonnet-5-5',
  gemini: 'gemini-2.5-flash',
  openai: 'gpt-4.1-mini',
  ollama: 'llama3.1'
}

// ---- HTTP y SSE ----

function friendlyHttpError(status: number, body: string): string {
  let detail = ''
  try {
    const j = JSON.parse(body) as { error?: { message?: string } | string; message?: string }
    detail = typeof j.error === 'string' ? j.error : (j.error?.message ?? j.message ?? '')
  } catch {
    detail = ''
  }
  detail = detail.replace(/\s+/g, ' ').slice(0, 200)
  if (status === 401 || status === 403) return 'La clave de API no es válida o no tiene permiso para este modelo'
  if (status === 404) return `Modelo o dirección no encontrados${detail ? `: ${detail}` : ' (revisa el nombre del modelo)'}`
  if (status === 429) return 'Se alcanzó el límite de uso o la cuota del proveedor'
  if (status >= 500) return `El proveedor tiene un problema (código ${status}); inténtalo de nuevo en un rato`
  return `El proveedor rechazó la solicitud (${status})${detail ? `: ${detail}` : ''}`
}

async function post(url: string, headers: Record<string, string>, body: unknown, signal?: AbortSignal): Promise<Response> {
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal
    })
  } catch (e) {
    if (signal?.aborted) throw e
    throw new AiError(`No se pudo conectar con ${new URL(url).host} (${e instanceof Error ? e.message : 'error de red'})`)
  }
  if (!res.ok) throw new AiError(friendlyHttpError(res.status, (await res.text()).slice(0, 2000)))
  if (!res.body) throw new AiError('El proveedor respondió sin contenido')
  return res
}

async function* sse(res: Response): AsyncGenerator<string> {
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  const take = (raw: string): string | null => {
    const data = raw
      .split(/\r?\n/)
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).replace(/^ /, ''))
      .join('\n')
    return data || null
  }
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let m: RegExpExecArray | null
    while ((m = /\r?\n\r?\n/.exec(buf))) {
      const raw = buf.slice(0, m.index)
      buf = buf.slice(m.index + m[0].length)
      const data = take(raw)
      if (data) yield data
    }
  }
  const rest = take(buf)
  if (rest) yield rest
}

function parseArgs(json: string): Record<string, unknown> {
  if (!json.trim()) return {}
  try {
    const v = JSON.parse(json) as unknown
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

// ---- Anthropic (Claude) ----

function toAnthropic(messages: Msg[]): unknown[] {
  const out: { role: string; content: unknown }[] = []
  for (const m of messages) {
    if (m.role === 'user') out.push({ role: 'user', content: m.text })
    else if (m.role === 'assistant') {
      const content: unknown[] = []
      if (m.text) content.push({ type: 'text', text: m.text })
      for (const c of m.calls) content.push({ type: 'tool_use', id: c.id, name: c.name, input: c.args })
      out.push({ role: 'assistant', content: content.length ? content : m.text })
    } else {
      const block = { type: 'tool_result', tool_use_id: m.callId, content: m.text }
      const last = out[out.length - 1]
      if (last && last.role === 'user' && Array.isArray(last.content) && (last.content[0] as { type?: string })?.type === 'tool_result') {
        last.content.push(block) // los resultados de una misma ronda van en un solo mensaje
      } else out.push({ role: 'user', content: [block] })
    }
  }
  return out
}

async function* anthropic(rt: ProviderRuntime, req: ChatRequest): AsyncGenerator<StreamEvent> {
  const body: Record<string, unknown> = {
    model: rt.model,
    max_tokens: req.maxTokens ?? 4096,
    stream: true,
    system: req.system,
    messages: toAnthropic(req.messages)
  }
  if (req.tools.length) body.tools = req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }))
  const res = await post(`${rt.baseUrl}/v1/messages`, { 'x-api-key': rt.apiKey, 'anthropic-version': '2023-06-01' }, body, req.signal)

  const blocks = new Map<number, { id: string; name: string; json: string }>()
  for await (const data of sse(res)) {
    let d: Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
    try {
      d = JSON.parse(data)
    } catch {
      continue
    }
    if (d.type === 'content_block_start' && d.content_block?.type === 'tool_use') {
      blocks.set(d.index, { id: d.content_block.id, name: d.content_block.name, json: '' })
    } else if (d.type === 'content_block_delta') {
      if (d.delta?.type === 'text_delta' && d.delta.text) yield { type: 'text', text: d.delta.text }
      else if (d.delta?.type === 'input_json_delta') {
        const b = blocks.get(d.index)
        if (b) b.json += d.delta.partial_json ?? ''
      }
    } else if (d.type === 'content_block_stop') {
      const b = blocks.get(d.index)
      if (b) {
        blocks.delete(d.index)
        yield { type: 'call', call: { id: b.id, name: b.name, args: parseArgs(b.json) } }
      }
    } else if (d.type === 'error') {
      throw new AiError(String(d.error?.message ?? 'Error del proveedor').slice(0, 200))
    }
  }
}

// ---- OpenAI y compatibles (OpenAI, Ollama, Groq, OpenRouter, LM Studio…) ----

function toOpenAi(system: string, messages: Msg[]): unknown[] {
  const out: unknown[] = [{ role: 'system', content: system }]
  for (const m of messages) {
    if (m.role === 'user') out.push({ role: 'user', content: m.text })
    else if (m.role === 'assistant') {
      const msg: Record<string, unknown> = { role: 'assistant', content: m.text || null }
      if (m.calls.length) {
        msg.tool_calls = m.calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } }))
      }
      out.push(msg)
    } else out.push({ role: 'tool', tool_call_id: m.callId, content: m.text })
  }
  return out
}

async function* openai(rt: ProviderRuntime, req: ChatRequest): AsyncGenerator<StreamEvent> {
  const body: Record<string, unknown> = { model: rt.model, stream: true, messages: toOpenAi(req.system, req.messages) }
  if (req.tools.length) {
    body.tools = req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }))
  }
  const headers: Record<string, string> = rt.apiKey ? { authorization: `Bearer ${rt.apiKey}` } : {}
  const res = await post(`${rt.baseUrl}/chat/completions`, headers, body, req.signal)

  const calls = new Map<number, { id: string; name: string; args: string }>()
  const flush = function* (): Generator<StreamEvent> {
    for (const [, c] of [...calls.entries()].sort((a, b) => a[0] - b[0])) {
      yield { type: 'call', call: { id: c.id || `call_${c.name}`, name: c.name, args: parseArgs(c.args) } }
    }
    calls.clear()
  }
  for await (const data of sse(res)) {
    if (data.trim() === '[DONE]') break
    let d: Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
    try {
      d = JSON.parse(data)
    } catch {
      continue
    }
    if (d.error) throw new AiError(String(d.error.message ?? d.error).slice(0, 200))
    const delta = d.choices?.[0]?.delta
    if (delta?.content) yield { type: 'text', text: delta.content }
    for (const tc of delta?.tool_calls ?? []) {
      const cur = calls.get(tc.index ?? 0) ?? { id: '', name: '', args: '' }
      if (tc.id) cur.id = tc.id
      if (tc.function?.name) cur.name += tc.function.name
      if (tc.function?.arguments) cur.args += tc.function.arguments
      calls.set(tc.index ?? 0, cur)
    }
  }
  yield* flush()
}

// ---- Google Gemini ----

function toGemini(messages: Msg[]): unknown[] {
  const out: { role: string; parts: unknown[] }[] = []
  for (const m of messages) {
    if (m.role === 'user') out.push({ role: 'user', parts: [{ text: m.text }] })
    else if (m.role === 'assistant') {
      const parts: unknown[] = []
      if (m.text) parts.push({ text: m.text })
      for (const c of m.calls) parts.push({ functionCall: { name: c.name, args: c.args } })
      out.push({ role: 'model', parts: parts.length ? parts : [{ text: '' }] })
    } else {
      const part = { functionResponse: { name: m.name, response: { result: m.text } } }
      const last = out[out.length - 1]
      if (last && last.role === 'user' && (last.parts[0] as { functionResponse?: unknown })?.functionResponse) last.parts.push(part)
      else out.push({ role: 'user', parts: [part] })
    }
  }
  return out
}

async function* gemini(rt: ProviderRuntime, req: ChatRequest): AsyncGenerator<StreamEvent> {
  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: req.system }] },
    contents: toGemini(req.messages)
  }
  if (req.tools.length) {
    body.tools = [{ functionDeclarations: req.tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })) }]
  }
  const url = `${rt.baseUrl}/v1beta/models/${encodeURIComponent(rt.model)}:streamGenerateContent?alt=sse`
  const res = await post(url, { 'x-goog-api-key': rt.apiKey }, body, req.signal)

  let n = 0
  for await (const data of sse(res)) {
    let d: Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
    try {
      d = JSON.parse(data)
    } catch {
      continue
    }
    if (d.error) throw new AiError(String(d.error.message ?? 'Error del proveedor').slice(0, 200))
    if (d.promptFeedback?.blockReason) throw new AiError('El proveedor bloqueó la respuesta por sus políticas de seguridad')
    for (const part of d.candidates?.[0]?.content?.parts ?? []) {
      if (part.text) yield { type: 'text', text: part.text }
      else if (part.functionCall) {
        yield { type: 'call', call: { id: `g${++n}`, name: part.functionCall.name, args: (part.functionCall.args ?? {}) as Record<string, unknown> } }
      }
    }
  }
}

export function streamChat(rt: ProviderRuntime, req: ChatRequest): AsyncGenerator<StreamEvent> {
  switch (rt.kind) {
    case 'anthropic':
      return anthropic(rt, req)
    case 'gemini':
      return gemini(rt, req)
    case 'openai':
    case 'ollama':
      return openai(rt, req)
  }
}
