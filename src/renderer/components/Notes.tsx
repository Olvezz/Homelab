import { useEffect, useRef, useState } from 'react'
import type { Note } from '../../shared/types'
import { t } from '../i18n'
import { useStore } from '../store'
import { Icon } from './Icon'

const SAVE_DELAY_MS = 500

// Apartado de notas: comandos importantes (con botón de copiar) y recordatorios sueltos.
// Se guardan en la config del equipo; cada cambio se guarda solo, con una pequeña espera.
export function Notes(): React.JSX.Element {
  const [notes, setNotes] = useState<Note[] | null>(null)
  const askConfirm = useStore((s) => s.askConfirm)
  const closeConfirm = useStore((s) => s.closeConfirm)
  const showToast = useStore((s) => s.showToast)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<Note[] | null>(null)

  useEffect(() => {
    let alive = true
    void window.api.getNotes().then((n) => alive && setNotes(n))
    return () => {
      alive = false
      // Al salir de la página no se pierde lo último escrito
      if (timer.current) clearTimeout(timer.current)
      if (pending.current) void window.api.saveNotes(pending.current)
    }
  }, [])

  const change = (next: Note[]): void => {
    setNotes(next)
    pending.current = next
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = null
      if (pending.current) void window.api.saveNotes(pending.current)
      pending.current = null
    }, SAVE_DELAY_MS)
  }

  const add = (kind: Note['kind']): void => {
    change([{ id: `n-${crypto.randomUUID().slice(0, 12)}`, title: '', kind, body: '' }, ...(notes ?? [])])
  }
  const edit = (id: string, patch: Partial<Note>): void =>
    change((notes ?? []).map((n) => (n.id === id ? { ...n, ...patch } : n)))
  const remove = (note: Note): void =>
    askConfirm({
      title: t('notesDelete'),
      body: note.title || note.body.slice(0, 80),
      confirmLabel: t('notesDelete'),
      danger: true,
      onConfirm: () => {
        closeConfirm()
        change((notes ?? []).filter((n) => n.id !== note.id))
      }
    })
  const copy = (note: Note): void => {
    void window.api.copyText(note.body).then(() => showToast('ok', t('notesCopied')))
  }

  return (
    <section className="notes">
      <div className="settings-head">
        <h1>{t('notes')}</h1>
        <div className="form-actions">
          <button className="btn" onClick={() => add('note')}>
            + {t('notesAddNote')}
          </button>
          <button className="btn primary" onClick={() => add('command')}>
            + {t('notesAddCommand')}
          </button>
        </div>
      </div>
      <p className="hint">{t('notesHint')}</p>
      {notes && notes.length === 0 && <p className="hint">{t('notesEmpty')}</p>}
      <ul className="notes-list">
        {(notes ?? []).map((n) => (
          <li key={n.id} className="note-card">
            <div className="note-head">
              <input
                className="note-title"
                value={n.title}
                maxLength={120}
                placeholder={t('notesTitlePlaceholder')}
                aria-label={t('notesTitlePlaceholder')}
                onChange={(e) => edit(n.id, { title: e.target.value })}
              />
              <button className="btn small" onClick={() => copy(n)} disabled={!n.body}>
                <Icon k="ui:copy" size={13} /> {t('notesCopy')}
              </button>
              <button className="tool" title={t('notesDelete')} aria-label={t('notesDelete')} onClick={() => remove(n)}>
                <Icon k="ui:x" size={14} />
              </button>
            </div>
            <textarea
              className={`note-body${n.kind === 'command' ? ' code' : ''}`}
              value={n.body}
              maxLength={20000}
              spellCheck={n.kind !== 'command'}
              placeholder={n.kind === 'command' ? t('notesCommandPlaceholder') : t('notesNotePlaceholder')}
              aria-label={n.title || t('notes')}
              onChange={(e) => edit(n.id, { body: e.target.value })}
            />
          </li>
        ))}
      </ul>
    </section>
  )
}
