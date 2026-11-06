import { ArrowUp, Square, X } from 'lucide-react'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react'

export interface ComposerHandle {
  focus(): void
  setText(t: string): void
}

interface Props {
  placeholder: string
  onSend(text: string): Promise<boolean | void> | boolean | void
  disabled?: boolean
  busy?: boolean
  onStop?(): void
  maxLength?: number
  /** 입력창 위의 모드 표시 (예: 내 차례 설명 입력) */
  chip?: { label: ReactNode; onClear?(): void } | null
  footer?: ReactNode
}

export const Composer = forwardRef<ComposerHandle, Props>(function Composer(
  { placeholder, onSend, disabled, busy, onStop, maxLength = 4000, chip, footer },
  ref,
) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const ta = useRef<HTMLTextAreaElement>(null)
  const composing = useRef(false)

  useImperativeHandle(ref, () => ({
    focus: () => ta.current?.focus(),
    setText: (t) => {
      setText(t)
      setTimeout(() => ta.current?.focus(), 0)
    },
  }))

  useEffect(() => {
    const el = ta.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 220) + 'px'
  }, [text])

  const submit = async () => {
    const t = text.trim()
    if (!t || disabled || sending) return
    setSending(true)
    const r = await onSend(t)
    setSending(false)
    if (r !== false) setText('')
    ta.current?.focus()
  }

  return (
    <div className="ac-composer-wrap">
      <div className={`ac-composer${chip ? ' has-chip' : ''}`} onClick={() => ta.current?.focus()}>
        {chip && (
          <div className="ac-composer-chip">
            <span>{chip.label}</span>
            {chip.onClear && (
              <button type="button" onClick={chip.onClear} aria-label="일반 메시지로 전환" title="일반 메시지로 전환">
                <X size={13} />
              </button>
            )}
          </div>
        )}
        <textarea
          ref={ta}
          rows={1}
          value={text}
          maxLength={maxLength}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onCompositionStart={() => (composing.current = true)}
          onCompositionEnd={() => (composing.current = false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !composing.current && !e.nativeEvent.isComposing) {
              e.preventDefault()
              void submit()
            }
          }}
        />
        <div className="ac-composer-bar">
          <div className="ac-composer-left">{text.length > maxLength * 0.8 && <span className="ac-count">{text.length}/{maxLength}</span>}</div>
          {busy && onStop ? (
            <button type="button" className="ac-send stop" onClick={onStop} aria-label="응답 중지">
              <Square size={12} fill="currentColor" />
            </button>
          ) : (
            <button
              type="button"
              className="ac-send"
              onClick={() => void submit()}
              disabled={!text.trim() || disabled || sending}
              aria-label="보내기"
            >
              <ArrowUp size={18} strokeWidth={2.4} />
            </button>
          )}
        </div>
      </div>
      {footer !== undefined ? footer : <p className="ac-disclaimer">Relay는 실수를 할 수 있습니다. 중요한 정보는 직접 확인하세요.</p>}
    </div>
  )
})
