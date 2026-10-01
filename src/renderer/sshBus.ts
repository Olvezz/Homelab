import type { Terminal } from '@xterm/xterm'

// Puente entre los datos que llegan del main y los terminales xterm: los bytes que lleguen antes de que
// el terminal esté montado (el banner de login) se guardan y se escriben al enlazarlo.
const terminals = new Map<string, Terminal>()
const pending = new Map<string, Uint8Array[]>()

export function pushData(id: string, data: Uint8Array): void {
  const term = terminals.get(id)
  if (term) {
    term.write(data)
    return
  }
  const list = pending.get(id) ?? []
  list.push(data)
  pending.set(id, list)
}

export function attach(id: string, term: Terminal): void {
  terminals.set(id, term)
  for (const chunk of pending.get(id) ?? []) term.write(chunk)
  pending.delete(id)
}

export function detach(id: string): void {
  terminals.delete(id)
  pending.delete(id)
}
