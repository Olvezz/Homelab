import { useEffect, useRef, useState } from 'react'
import { t } from '../i18n'
import { useStore, type ChatItem } from '../store'
import { Icon } from './Icon'

// Markdown mínimo y seguro: bloques ``` , `código` y **negrita**. Todo son nodos de React (nada de HTML).
function inline(text: string): React.ReactNode[] {
  return text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g).map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) return <code key={i}>{part.slice(1, -1)}</code>
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={i}>{part.slice(2, -2)}</strong>
    return part
  })
}

function RichText({ text }: { text: string }): React.JSX.Element {
  return (
    <>
      {text.split('```').map((part, i) =>
        i % 2 === 1 ? (
          <pre className="ai-code" key={i}>
            <code>{part.replace(/^[A-Za-z0-9+#-]*\n/, '').replace(/\n$/, '')}</code>
          </pre>
        ) : part.trim() ? (
          <div className="ai-p" key={i}>
            {inline(part.replace(/^\n+|\n+$/g, ''))}
          </div>
        ) : null
      )}
    </>
  )
}

function ToolCard({ item }: { item: ChatItem }): React.JSX.Element | null {
  const approve = useStore((s) => s.approveAi)
  const tool = item.tool
  if (!tool) return null
  const label: Record<string, string> = {
    running: t('aiToolRunning'),
    awaiting: t('aiToolAwaiting'),
    done: t('aiToolDone'),
    error: t('aiToolError'),
    denied: t('aiToolDenied')
  }
  const mutating = tool.name === 'power_action' || tool.name === 'ssh_exec'
  return (
    <div className={`ai-tool ${tool.status}`}>
      <div className="ai-tool-head">
        <Icon k={mutating ? 'ui:terminal' : 'ui:search'} size={14} />
        <span className="ai-tool-summary">{tool.summary}</span>
        <span className="ai-tool-status">{label[tool.status]}</span>
      </div>
      {tool.status === 'awaiting' && (
        <>
          <pre className="ai-code">{tool.detail}</pre>
          <div className="ai-approve">
            <span>{t('aiApproveAsk')}</span>
            <button className="btn small" onClick={() => approve(tool.callId, false)}>
              {t('aiReject')}
            </button>
            <button className="btn small primary" autoFocus onClick={() => approve(tool.callId, true)}>
              {t('aiApprove')}
            </button>
          </div>
        </>
      )}
      {tool.result && tool.status !== 'awaiting' && (
        <details>
          <summary>{t('aiToolResult')}</summary>
          <pre className="ai-code">{tool.result}</pre>
        </details>
      )}
    </div>
  )
}

export function AiChat(): React.JSX.Element {
  const connections = useStore((s) => s.aiConnections)
  const chat = useStore((s) => s.aiChat)
  const busy = useStore((s) => s.aiBusy)
  const ui = useStore((s) => s.ui)
  const draft = useStore((s) => s.aiDraft)
  const sendAi = useStore((s) => s.sendAi)
  const stopAi = useStore((s) => s.stopAi)
  const newChat = useStore((s) => s.newAiChat)
  const setUi = useStore((s) => s.setUi)
  const openSettings = useStore((s) => s.openSettings)
  const [text, setText] = useState('')
  const end = useRef<HTMLDivElement>(null)

  const active = connections.find((c) => c.id === ui.lastAiId) ?? connections[0]

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [chat])

  useEffect(() => {
    if (draft) {
      setText(draft)
      useStore.setState({ aiDraft: null })
    }
  }, [draft])

  const submit = (value = text): void => {
    const v = value.trim()
    if (!v || busy) return
    setText('')
    void sendAi(v)
  }

  if (connections.length === 0) {
    return (
      <section className="ai-chat">
        <div className="ai-empty">
          <Icon k="ui:sparkles" size={28} />
          <h2>{t('aiTitle')}</h2>
          <p>{t('aiIntro')}</p>
          <p className="hint">{t('aiNeedKeys')}</p>
          <button className="btn primary" onClick={() => openSettings('ai-form')}>
            {t('aiConnect')}
          </button>
        </div>
      </section>
    )
  }

  const suggestions = [t('aiSuggest1'), t('aiSuggest2'), t('aiSuggest3')]

  return (
    <section className="ai-chat">
      <div className="ai-bar">
        <Icon k="ui:sparkles" size={16} />
        <select
          value={active?.id}
          aria-label={t('aiConnection')}
          onChange={(e) => setUi({ lastAiId: e.target.value })}
          disabled={busy}
        >
          {connections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} · {c.model}
            </option>
          ))}
        </select>
        <label className="check compact" title={t('aiAllowHint')}>
          <input
            type="checkbox"
            checked={ui.aiAllowActions}
            onChange={(e) => setUi({ aiAllowActions: e.target.checked })}
          />
          <span>{t('aiAllowActions')}</span>
        </label>
        <span className="push" />
        <button className="btn small" onClick={newChat} disabled={chat.length === 0 && !busy}>
          {t('aiNewChat')}
        </button>
      </div>

      <div className="ai-messages">
        {chat.length === 0 && (
          <div className="ai-empty">
            <p>{active?.kind === 'ollama' ? t('aiPrivacyLocal') : t('aiPrivacyCloud')}</p>
            <div className="ai-suggest">
              {suggestions.map((s) => (
                <button key={s} className="btn" onClick={() => submit(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {chat.map((item) =>
          item.role === 'tool' ? (
            <ToolCard key={item.id} item={item} />
          ) : item.role === 'error' ? (
            <div key={item.id} className="ai-error">
              {item.text}
            </div>
          ) : (
            <div key={item.id} className={`ai-msg ${item.role}`}>
              <RichText text={item.text} />
            </div>
          )
        )}
        {busy && chat.at(-1)?.role !== 'assistant' && chat.at(-1)?.tool?.status !== 'awaiting' && (
          <div className="ai-thinking">
            <Icon k="ui:loader" size={14} className="spin" /> {t('aiThinking')}
          </div>
        )}
        <div ref={end} />
      </div>

      <form
        className="ai-input"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <textarea
          value={text}
          rows={2}
          placeholder={t('aiPlaceholder')}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
        />
        {busy ? (
          <button type="button" className="btn" onClick={stopAi}>
            {t('aiStop')}
          </button>
        ) : (
          <button type="submit" className="btn primary" disabled={!text.trim()}>
            {t('aiSend')}
          </button>
        )}
      </form>
    </section>
  )
}
