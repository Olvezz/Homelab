import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AiEvent, Guest, PveSnapshot, SshConnection } from '../src/shared/types'
import { ChatEngine } from '../src/main/ai/engine'
import { AiError, streamChat, type Msg, type ProviderRuntime, type StreamEvent, type ToolDef } from '../src/main/ai/providers'
import { buildSystemPrompt, createTools, type HomelabApi } from '../src/main/ai/tools'

// ---------- servidor simulado de proveedores ----------

interface Seen {
  url: string
  headers: http.IncomingHttpHeaders
  body: Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
}
let server: http.Server
let base = ''
let seen: Seen[] = []
let reply: (res: http.ServerResponse, seen: Seen) => void = () => undefined

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      const s: Seen = { url: req.url ?? '', headers: req.headers, body: raw ? JSON.parse(raw) : {} }
      seen.push(s)
      reply(res, s)
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => new Promise<void>((r) => server.close(() => r())))

const sse = (res: http.ServerResponse, chunks: string[], event = false): void => {
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  for (const c of chunks) res.write(event ? c : `data: ${c}\n\n`)
  res.end()
}
const collect = async (rt: ProviderRuntime, messages: Msg[], tools: ToolDef[] = []): Promise<StreamEvent[]> => {
  const out: StreamEvent[] = []
  for await (const ev of streamChat(rt, { system: 'SYS', messages, tools })) out.push(ev)
  return out
}
const rt = (kind: ProviderRuntime['kind'], over: Partial<ProviderRuntime> = {}): ProviderRuntime => ({ kind, baseUrl: base, model: 'm1', apiKey: 'k-secreta', ...over })
const tool: ToolDef = { name: 'get_guest', description: 'd', parameters: { type: 'object', properties: { vmid: { type: 'integer' } }, required: ['vmid'] } }
const history: Msg[] = [
  { role: 'user', text: 'hola' },
  { role: 'assistant', text: 'miro', calls: [{ id: 'c1', name: 'get_guest', args: { vmid: 102 } }, { id: 'c2', name: 'get_guest', args: { vmid: 100 } }] },
  { role: 'tool', callId: 'c1', name: 'get_guest', text: 'r1' },
  { role: 'tool', callId: 'c2', name: 'get_guest', text: 'r2' }
]

describe('proveedor Anthropic (Claude)', () => {
  it('envía la petición correcta y transmite el texto', async () => {
    seen = []
    reply = (res) =>
      sse(res, [
        '{"type":"message_start","message":{}}',
        '{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
        '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Ho"}}',
        '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"la"}}',
        '{"type":"message_stop"}'
      ])
    const events = await collect(rt('anthropic'), [{ role: 'user', text: 'hola' }], [tool])
    expect(events).toEqual([{ type: 'text', text: 'Ho' }, { type: 'text', text: 'la' }])
    const s = seen[0]
    expect(s.url).toBe('/v1/messages')
    expect(s.headers['x-api-key']).toBe('k-secreta')
    expect(s.headers['anthropic-version']).toBe('2023-06-01')
    expect(s.body).toMatchObject({ model: 'm1', stream: true, system: 'SYS', max_tokens: 4096 })
    expect(s.body.tools[0]).toMatchObject({ name: 'get_guest', input_schema: tool.parameters })
    expect(s.body.messages).toEqual([{ role: 'user', content: 'hola' }])
  })

  it('reconstruye llamadas a herramientas desde el JSON parcial', async () => {
    reply = (res) =>
      sse(res, [
        '{"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"tu_1","name":"get_guest"}}',
        '{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"vm"}}',
        '{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"id\\": 102}"}}',
        '{"type":"content_block_stop","index":1}'
      ])
    const events = await collect(rt('anthropic'), [{ role: 'user', text: 'x' }], [tool])
    expect(events).toEqual([{ type: 'call', call: { id: 'tu_1', name: 'get_guest', args: { vmid: 102 } } }])
  })

  it('devuelve los resultados de una ronda en un solo mensaje de usuario', async () => {
    seen = []
    reply = (res) => sse(res, ['{"type":"message_stop"}'])
    await collect(rt('anthropic'), history, [tool])
    const msgs = seen[0].body.messages
    expect(msgs[1]).toMatchObject({ role: 'assistant', content: [{ type: 'text', text: 'miro' }, { type: 'tool_use', id: 'c1', input: { vmid: 102 } }, { type: 'tool_use', id: 'c2' }] })
    expect(msgs[2]).toEqual({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content: 'r1' }, { type: 'tool_result', tool_use_id: 'c2', content: 'r2' }] })
  })

  it('un evento de error del flujo se convierte en AiError', async () => {
    reply = (res) => sse(res, ['{"type":"error","error":{"type":"overloaded_error","message":"Sobrecargado"}}'])
    await expect(collect(rt('anthropic'), [{ role: 'user', text: 'x' }])).rejects.toThrow('Sobrecargado')
  })
})

describe('proveedor compatible con OpenAI (OpenAI, Ollama…)', () => {
  it('transmite texto y ensambla llamadas repartidas en varios trozos', async () => {
    seen = []
    reply = (res) =>
      sse(res, [
        '{"choices":[{"delta":{"content":"Hola"}}]}',
        '{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_9","function":{"name":"get_guest","arguments":"{\\"vm"}}]}}]}',
        '{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"id\\":100}"}}]}}]}',
        '{"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
        '[DONE]'
      ])
    const events = await collect(rt('openai', { baseUrl: `${base}/v1` }), history, [tool])
    expect(events).toEqual([{ type: 'text', text: 'Hola' }, { type: 'call', call: { id: 'call_9', name: 'get_guest', args: { vmid: 100 } } }])
    const s = seen[0]
    expect(s.url).toBe('/v1/chat/completions')
    expect(s.headers.authorization).toBe('Bearer k-secreta')
    expect(s.body.messages[0]).toEqual({ role: 'system', content: 'SYS' })
    expect(s.body.tools[0]).toEqual({ type: 'function', function: { name: 'get_guest', description: 'd', parameters: tool.parameters } })
    const asst = s.body.messages[2]
    expect(asst.tool_calls[0]).toEqual({ id: 'c1', type: 'function', function: { name: 'get_guest', arguments: '{"vmid":102}' } })
    expect(s.body.messages.slice(3)).toEqual([{ role: 'tool', tool_call_id: 'c1', content: 'r1' }, { role: 'tool', tool_call_id: 'c2', content: 'r2' }])
  })

  it('Ollama sin clave no envía cabecera de autorización', async () => {
    seen = []
    reply = (res) => sse(res, ['{"choices":[{"delta":{"content":"ok"}}]}', '[DONE]'])
    await collect(rt('ollama', { apiKey: '' }), [{ role: 'user', text: 'x' }])
    expect(seen[0].headers.authorization).toBeUndefined()
  })
})

describe('proveedor Gemini', () => {
  it('usa la URL y la cabecera de clave de Google y convierte llamadas y respuestas', async () => {
    seen = []
    reply = (res) =>
      sse(res, [
        '{"candidates":[{"content":{"parts":[{"text":"Veo"}]}}]}',
        '{"candidates":[{"content":{"parts":[{"functionCall":{"name":"get_guest","args":{"vmid":102}}}]}}]}'
      ])
    const events = await collect(rt('gemini', { model: 'gemini-x' }), history, [tool])
    expect(events).toEqual([{ type: 'text', text: 'Veo' }, { type: 'call', call: { id: 'g1', name: 'get_guest', args: { vmid: 102 } } }])
    const s = seen[0]
    expect(s.url).toBe('/v1beta/models/gemini-x:streamGenerateContent?alt=sse')
    expect(s.headers['x-goog-api-key']).toBe('k-secreta')
    expect(s.url).not.toContain('k-secreta') // la clave no viaja en la URL
    expect(s.body.systemInstruction).toEqual({ parts: [{ text: 'SYS' }] })
    expect(s.body.tools[0].functionDeclarations[0].name).toBe('get_guest')
    expect(s.body.contents[1]).toEqual({ role: 'model', parts: [{ text: 'miro' }, { functionCall: { name: 'get_guest', args: { vmid: 102 } } }, { functionCall: { name: 'get_guest', args: { vmid: 100 } } }] })
    expect(s.body.contents[2]).toEqual({ role: 'user', parts: [{ functionResponse: { name: 'get_guest', response: { result: 'r1' } } }, { functionResponse: { name: 'get_guest', response: { result: 'r2' } } }] })
  })

  it('una respuesta bloqueada por seguridad da un error claro', async () => {
    reply = (res) => sse(res, ['{"promptFeedback":{"blockReason":"SAFETY"}}'])
    await expect(collect(rt('gemini'), [{ role: 'user', text: 'x' }])).rejects.toThrow('bloqueó')
  })
})

describe('errores de red y de proveedor', () => {
  const failWith = (status: number, body = '{}'): void => {
    reply = (res) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(body)
    }
  }
  it('mensajes claros y sin filtrar la clave', async () => {
    failWith(401, '{"error":{"message":"invalid x-api-key k-secreta"}}')
    const e1 = await collect(rt('anthropic'), [{ role: 'user', text: 'x' }]).catch((e) => e)
    expect(e1).toBeInstanceOf(AiError)
    expect(e1.message).toContain('clave de API no es válida')
    expect(e1.message).not.toContain('k-secreta')
    failWith(429)
    expect((await collect(rt('openai'), []).catch((e) => e)).message).toContain('límite de uso')
    failWith(404, '{"error":{"message":"model not found"}}')
    expect((await collect(rt('gemini'), []).catch((e) => e)).message).toContain('Modelo')
    failWith(503)
    expect((await collect(rt('ollama'), []).catch((e) => e)).message).toContain('problema')
  })
  it('sin conexión: error comprensible', async () => {
    const e = await collect(rt('openai', { baseUrl: 'http://127.0.0.1:1/v1' }), []).catch((x) => x)
    expect(e).toBeInstanceOf(AiError)
    expect(e.message).toContain('No se pudo conectar')
  })
})

// ---------- herramientas y motor ----------

const guest = (over: Partial<Guest>): Guest => ({
  key: `proxmox/${over.vmid}`, vmid: 100, name: 'g', node: 'proxmox', type: 'lxc', status: 'running', template: false,
  cpu: 0.05, maxcpu: 2, mem: 512, maxmem: 1024, uptime: 100, tags: [], description: '', ips: ['10.0.0.51'], panels: [], ...over
})
const snapshot = (): PveSnapshot => ({
  status: 'connected', nodes: [{ name: 'proxmox', online: true, cpu: 0.1, maxcpu: 4, mem: 1, maxmem: 2 }],
  guests: [
    guest({ vmid: 100, name: 'adguard', description: 'Notas del guest' }),
    guest({ vmid: 102, name: 'docker-server', type: 'qemu', status: 'stopped' }),
    guest({ vmid: 103, name: 'plantilla', type: 'qemu', status: 'stopped', template: true })
  ],
  diagnostics: [{ kind: 'no-ip', text: 'sin IP' }], canPower: true, updatedAt: 1
})
const conns: SshConnection[] = [{ id: 'ssh-1', name: 'Docker', host: '10.0.0.53', port: 22, username: 'root', auth: 'password', hasSecret: true }]

function makeApi(): HomelabApi & { powered: unknown[]; commands: string[] } {
  const powered: unknown[] = []
  const commands: string[] = []
  return {
    powered, commands,
    snapshot, panels: () => [], sshConnections: () => conns,
    power: async (ref, action) => { powered.push({ ref, action }); return { ok: true, message: 'hecho' } },
    sshExec: async (_id, command) => { commands.push(command); return { exitCode: 0, output: 'salida\n', truncated: false } }
  }
}

describe('herramientas', () => {
  it('las de lectura devuelven datos y las de acción solo existen si se permiten', () => {
    const api = makeApi()
    let allow = true
    const t = createTools(api, () => allow)
    expect(t.definitions().map((d) => d.name)).toEqual(['cluster_status', 'list_guests', 'get_guest', 'list_ssh_connections', 'power_action', 'ssh_exec'])
    allow = false
    expect(t.definitions().map((d) => d.name)).toEqual(['cluster_status', 'list_guests', 'get_guest', 'list_ssh_connections'])
    expect(t.describe('power_action', { vmid: 100, action: 'start' })).toBeNull()
    expect(buildSystemPrompt(false)).toContain('solo lectura')
  })

  it('list_guests / get_guest / cluster_status', async () => {
    const t = createTools(makeApi(), () => true)
    const list = JSON.parse(await t.execute('list_guests', {})) as { vmid: number; cpu_percent?: number }[]
    expect(list.map((g) => g.vmid)).toEqual([100, 102, 103])
    expect(list[0].cpu_percent).toBe(5)
    expect(JSON.parse(await t.execute('get_guest', { vmid: 100 })).notas).toBe('Notas del guest')
    await expect(t.execute('get_guest', { vmid: 999 })).rejects.toThrow('No existe')
    expect(JSON.parse(await t.execute('cluster_status', {}))).toMatchObject({ guests_total: 3, guests_encendidos: 1 })
  })

  it('describe marca como mutantes las acciones y enseña el comando completo', () => {
    const t = createTools(makeApi(), () => true)
    expect(t.describe('list_guests', {})).toMatchObject({ mutating: false })
    const p = t.describe('power_action', { vmid: 102, action: 'reboot' })!
    expect(p.mutating).toBe(true)
    expect(p.summary).toContain('Reiniciar 102 docker-server')
    const s = t.describe('ssh_exec', { connection: 'docker', command: 'apt update && apt -y upgrade' })!
    expect(s.mutating).toBe(true)
    expect(s.detail).toContain('root@10.0.0.53:22')
    expect(s.detail).toContain('apt update && apt -y upgrade')
  })

  it('power_action valida: plantillas y vmid inexistente se rechazan', async () => {
    const api = makeApi()
    const t = createTools(api, () => true)
    await expect(t.execute('power_action', { vmid: 103, action: 'start' })).rejects.toThrow('plantilla')
    await expect(t.execute('power_action', { vmid: 5, action: 'start' })).rejects.toThrow('No existe')
    await expect(t.execute('power_action', { vmid: 100, action: 'destroy' })).rejects.toThrow()
    expect(api.powered).toEqual([])
    await t.execute('power_action', { vmid: 100, action: 'start' })
    expect(api.powered).toEqual([{ ref: { node: 'proxmox', type: 'lxc', vmid: 100 }, action: 'start' }])
  })

  it('ssh_exec resuelve la conexión por nombre y formatea la salida', async () => {
    const api = makeApi()
    const t = createTools(api, () => true)
    expect(await t.execute('ssh_exec', { connection: 'DOCKER', command: 'uptime' })).toBe('exit=0\nsalida\n')
    expect(api.commands).toEqual(['uptime'])
    await expect(t.execute('ssh_exec', { connection: 'nope', command: 'x' })).rejects.toThrow('Disponibles: Docker')
  })
})

describe('motor de conversación', () => {
  const runtime = rt('ollama')
  const scripted = (rounds: StreamEvent[][]): { stream: typeof streamChat; calls: Msg[][] } => {
    const calls: Msg[][] = []
    let i = 0
    const stream = (async function* (_rt: ProviderRuntime, req: { messages: Msg[] }) {
      calls.push(JSON.parse(JSON.stringify(req.messages)))
      for (const ev of rounds[i++] ?? []) yield ev
    }) as unknown as typeof streamChat
    return { stream, calls }
  }
  const setup = (rounds: StreamEvent[][], allow = true): { engine: ChatEngine; events: AiEvent[]; api: ReturnType<typeof makeApi>; calls: Msg[][] } => {
    const api = makeApi()
    const events: AiEvent[] = []
    const { stream, calls } = scripted(rounds)
    const engine = new ChatEngine({ tools: createTools(api, () => allow), emit: (e) => events.push(e), system: () => 'SYS', stream })
    return { engine, events, api, calls }
  }
  const call = (id: string, name: string, args: Record<string, unknown>): StreamEvent => ({ type: 'call', call: { id, name, args } })
  const types = (events: AiEvent[]): string[] => events.map((e) => (e.type === 'tool-result' ? `result:${e.status}` : e.type))

  it('ejecuta solas las herramientas de lectura y devuelve el resultado al modelo', async () => {
    const { engine, events, calls } = setup([[call('a', 'list_guests', {})], [{ type: 'text', text: 'Hay 3 guests' }]])
    await engine.send(runtime, 'qué hay', 'c1')
    expect(types(events)).toEqual(['tool', 'result:done', 'text', 'done'])
    expect(events.find((e) => e.type === 'tool')).toMatchObject({ status: 'running', name: 'list_guests' })
    expect(calls[1].at(-1)).toMatchObject({ role: 'tool', callId: 'c1-a', name: 'list_guests' })
    expect(engine.busy).toBe(false)
  })

  it('una acción espera aprobación y SOLO entonces se ejecuta', async () => {
    const { engine, events, api } = setup([[call('p', 'power_action', { vmid: 100, action: 'reboot' })], [{ type: 'text', text: 'Reiniciado' }]])
    const run = engine.send(runtime, 'reinicia adguard', 'c1')
    await vi_wait(() => events.some((e) => e.type === 'tool' && e.status === 'awaiting'))
    expect(api.powered).toEqual([]) // todavía nada
    engine.approve(awaitingId(events), true)
    await run
    expect(api.powered).toHaveLength(1)
    expect(types(events)).toEqual(['tool', 'result:done', 'text', 'done'])
  })

  it('si el usuario rechaza, no se ejecuta y el modelo lo sabe', async () => {
    const { engine, events, api, calls } = setup([[call('p', 'ssh_exec', { connection: 'Docker', command: 'rm -rf /tmp/x' })], [{ type: 'text', text: 'De acuerdo' }]])
    const run = engine.send(runtime, 'limpia', 'c1')
    await vi_wait(() => events.some((e) => e.type === 'tool' && e.status === 'awaiting'))
    engine.approve(awaitingId(events), false)
    await run
    expect(api.commands).toEqual([])
    expect(types(events)).toContain('result:denied')
    expect((calls[1].at(-1) as { text: string }).text).toContain('rechazó')
  })

  it('detener durante la aprobación cancela sin ejecutar nada', async () => {
    const { engine, events, api } = setup([[call('p', 'power_action', { vmid: 100, action: 'stop' })]])
    const run = engine.send(runtime, 'apaga', 'c1')
    await vi_wait(() => events.some((e) => e.type === 'tool' && e.status === 'awaiting'))
    engine.stop()
    await run
    expect(api.powered).toEqual([])
    expect(events.at(-1)?.type).toBe('done')
    expect(engine.busy).toBe(false)
  })

  it('sin permiso de acciones, la herramienta no existe aunque el modelo la pida', async () => {
    const { engine, events, api } = setup([[call('p', 'power_action', { vmid: 100, action: 'start' })], [{ type: 'text', text: 'ok' }]], false)
    await engine.send(runtime, 'x', 'c1')
    expect(api.powered).toEqual([])
    expect(types(events)).toEqual(['result:error', 'text', 'done'])
  })

  it('herramienta desconocida y argumentos inválidos devuelven error al modelo sin romper', async () => {
    const { engine, events } = setup([[call('a', 'borrar_todo', {}), call('b', 'get_guest', { vmid: 'x' })], [{ type: 'text', text: 'ok' }]])
    await engine.send(runtime, 'x', 'c1')
    expect(types(events).filter((t) => t.startsWith('result'))).toEqual(['result:error', 'result:error'])
    expect(events.at(-1)?.type).toBe('done')
  })

  it('un fallo del proveedor emite error y la conversación sigue utilizable', async () => {
    const api = makeApi()
    const events: AiEvent[] = []
    let n = 0
    const stream = (async function* () {
      if (n++ === 0) throw new AiError('La clave de API no es válida')
      yield { type: 'text', text: 'ya funciona' } as StreamEvent
    }) as unknown as typeof streamChat
    const engine = new ChatEngine({ tools: createTools(api, () => true), emit: (e) => events.push(e), system: () => 'S', stream })
    await engine.send(runtime, 'a', 'c1')
    expect(events.at(-1)).toEqual({ convId: 'c1', type: 'error', message: 'La clave de API no es válida' })
    await engine.send(runtime, 'b', 'c1')
    expect(events.at(-1)?.type).toBe('done')
  })

  it('ids de llamada repetidos entre respuestas (como hace Gemini) no se pisan', async () => {
    const { engine, events, api } = setup([
      [call('g1', 'power_action', { vmid: 100, action: 'start' })],
      [call('g1', 'power_action', { vmid: 100, action: 'stop' })],
      [{ type: 'text', text: 'fin' }]
    ])
    const run = engine.send(runtime, 'x', 'c1')
    const waiting = (): string[] => events.filter((e) => e.type === 'tool').map((e) => (e as { callId: string }).callId)
    await vi_wait(() => waiting().length === 1)
    engine.approve(waiting()[0], true)
    await vi_wait(() => waiting().length === 2)
    engine.approve(waiting()[1], false)
    await run
    const [a, b] = waiting()
    expect(a).not.toBe(b)
    expect(api.powered).toHaveLength(1) // la primera aprobada, la segunda rechazada
    const results = events.filter((e) => e.type === 'tool-result').map((e) => (e as { status: string }).status)
    expect(results).toEqual(['done', 'denied'])
  })

  it('no admite dos respuestas a la vez y limita las rondas de herramientas', async () => {
    const rounds = Array.from({ length: 12 }, (_, i) => [call(`r${i}`, 'cluster_status', {})])
    const { engine, events, calls } = setup(rounds)
    await engine.send(runtime, 'bucle', 'c1')
    expect(calls).toHaveLength(8)
    expect(events.some((e) => e.type === 'text' && e.text.includes('máximo de pasos'))).toBe(true)
    const slow = setup([[{ type: 'text', text: 'x' }]])
    const a = slow.engine.send(runtime, 'uno', 'c')
    await expect(slow.engine.send(runtime, 'dos', 'c')).rejects.toThrow('en curso')
    await a
  })
})

async function vi_wait(cond: () => boolean, ms = 3000): Promise<void> {
  const t0 = Date.now()
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timeout esperando la condición')
    await new Promise((r) => setTimeout(r, 10))
  }
}

function awaitingId(events: AiEvent[]): string {
  return (events.filter((e) => e.type === 'tool').at(-1) as { callId: string }).callId
}
