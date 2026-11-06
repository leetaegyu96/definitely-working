import { Check, Copy, RotateCcw, ThumbsDown, ThumbsUp } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Markdown } from '../../components/Markdown'
import { usePrefs } from '../../stores/prefs'
import { Composer } from './Composer'
import { SUGGESTIONS, templateReply, type DemoConversation, type DemoMessage } from './data'
import { BrandMark } from './ui'

interface Props {
  conv: DemoConversation | null
  onSend(convId: string | null, msgs: DemoMessage[]): string
  onReplace(convId: string, index: number, msg: DemoMessage): void
}

/** 일반 업무 대화 화면 — 응답은 오프라인 템플릿 (실제 모델 호출 없음) */
export function ConversationView({ conv, onSend, onReplace }: Props) {
  const nickname = usePrefs((s) => s.nickname)
  const [stream, setStream] = useState<{ convId: string; index: number; full: string; shown: number } | null>(null)
  const [thinking, setThinking] = useState<string | null>(null)
  const timer = useRef<number | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  useEffect(() => () => stopTimers(), [])
  useEffect(() => {
    stick.current = true
    scroller.current?.scrollTo({ top: 0 })
  }, [conv?.id])

  useEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  })

  function stopTimers() {
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = null
  }

  function startStream(convId: string, index: number, full: string) {
    setThinking(null)
    setStream({ convId, index, full, shown: 0 })
    const tick = () => {
      setStream((s) => {
        if (!s) return s
        const step = 3 + Math.floor(Math.random() * 6)
        const shown = Math.min(s.full.length, s.shown + step)
        if (shown >= s.full.length) {
          timer.current = null
          return null
        }
        timer.current = window.setTimeout(tick, 18 + Math.random() * 30)
        return { ...s, shown }
      })
    }
    timer.current = window.setTimeout(tick, 30)
  }

  function send(text: string) {
    if (stream || thinking) return false
    const reply = templateReply(text)
    const id = onSend(conv?.id ?? null, [
      { role: 'user', content: text },
      { role: 'assistant', content: reply },
    ])
    const index = (conv?.messages.length ?? 0) + 1
    stick.current = true
    setThinking(id)
    timer.current = window.setTimeout(() => startStream(id, index, reply), 700 + Math.random() * 600)
  }

  function stop() {
    stopTimers()
    if (stream) onReplace(stream.convId, stream.index, { role: 'assistant', content: stream.full.slice(0, stream.shown) })
    setStream(null)
    setThinking(null)
  }

  const messages = conv?.messages ?? []
  const busy = !!stream || !!thinking

  if (!conv) {
    return (
      <div className="ac-main-body">
        <div className="ac-empty">
          <h1>{nickname ? `${nickname}님, 무엇을 도와드릴까요?` : '무엇을 도와드릴까요?'}</h1>
          <Composer placeholder="Relay에게 메시지 보내기" onSend={send} footer={null} />
          <div className="ac-suggest">
            {SUGGESTIONS.map((s) => (
              <button key={s.title} type="button" onClick={() => send(s.text)}>
                <strong>{s.title}</strong>
                <span>{s.text}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="ac-main-body">
      <div
        className="ac-scroll"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
        }}
      >
        <div className="ac-thread">
          {messages.map((m, i) => {
            const isStreaming = stream && stream.convId === conv.id && stream.index === i
            if (thinking === conv.id && m.role === 'assistant' && i === messages.length - 1) return null
            const content = isStreaming ? stream.full.slice(0, stream.shown) : m.content
            return m.role === 'user' ? (
              <div key={i} className="ac-msg-user">
                <div className="ac-bubble">{m.content}</div>
              </div>
            ) : (
              <AssistantMessage
                key={i}
                content={content}
                streaming={!!isStreaming}
                onRegenerate={i === messages.length - 1 && !busy ? () => startStream(conv.id, i, m.content) : undefined}
              />
            )
          })}
          {thinking === conv.id && (
            <div className="ac-msg-ai">
              <div className="ac-ai-icon"><BrandMark size={22} /></div>
              <div className="ac-thinking"><span /><span /><span /></div>
            </div>
          )}
        </div>
      </div>
      <Composer placeholder="Relay에게 메시지 보내기" onSend={send} busy={busy} onStop={stop} />
    </div>
  )
}

export function AssistantMessage({
  content,
  streaming,
  onRegenerate,
}: {
  content: string
  streaming?: boolean
  onRegenerate?(): void
}) {
  const [copied, setCopied] = useState(false)
  const [vote, setVote] = useState<'up' | 'down' | null>(null)
  return (
    <div className="ac-msg-ai">
      <div className="ac-ai-icon"><BrandMark size={22} /></div>
      <div className="ac-ai-body">
        <Markdown text={content} />
        {streaming && <span className="ac-caret" />}
        {!streaming && (
          <div className="ac-msg-actions">
            <button
              type="button"
              title="복사"
              onClick={() => {
                navigator.clipboard?.writeText(content).catch(() => {})
                setCopied(true)
                setTimeout(() => setCopied(false), 1400)
              }}
            >
              {copied ? <Check size={15} /> : <Copy size={15} />}
            </button>
            <button type="button" title="좋은 응답" className={vote === 'up' ? 'on' : ''} onClick={() => setVote(vote === 'up' ? null : 'up')}>
              <ThumbsUp size={15} />
            </button>
            <button type="button" title="별로인 응답" className={vote === 'down' ? 'on' : ''} onClick={() => setVote(vote === 'down' ? null : 'down')}>
              <ThumbsDown size={15} />
            </button>
            {onRegenerate && (
              <button type="button" title="다시 생성" onClick={onRegenerate}>
                <RotateCcw size={15} />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
