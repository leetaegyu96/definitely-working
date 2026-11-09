import { ArrowUp, ImagePlus, Square, X } from 'lucide-react'
import { imageFromTransfer } from '../../lib/image'
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
  /** 이미지 첨부 지원 (붙여넣기 / 끌어다 놓기 / 버튼) */
  onImage?(file: File): void
  attachment?: { src: string; label: string; busy?: boolean; onRemove(): void } | null
}

export const Composer = forwardRef<ComposerHandle, Props>(function Composer(
  { placeholder, onSend, disabled, busy, onStop, maxLength = 4000, chip, footer, onImage, attachment },
  ref,
) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const ta = useRef<HTMLTextAreaElement>(null)
  const composing = useRef(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const canSend = (!!text.trim() || (!!attachment && !attachment.busy)) && !disabled && !sending

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
    if (!canSend) return
    setSending(true)
    const r = await onSend(t)
    setSending(false)
    if (r !== false) setText('')
    ta.current?.focus()
  }

  return (
    <div className="ac-composer-wrap">
      <div
        className={`ac-composer${chip ? ' has-chip' : ''}${dragging ? ' dragging' : ''}`}
        onClick={() => ta.current?.focus()}
        onDragOver={(e) => {
          if (!onImage || !Array.from(e.dataTransfer.types).includes('Files')) return
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          setDragging(false)
          const f = onImage && imageFromTransfer(e.dataTransfer)
          if (f) {
            e.preventDefault()
            onImage!(f)
          }
        }}
      >
        {attachment && (
          <div className="ac-attach">
            <img src={attachment.src} alt="" />
            <span>{attachment.busy ? '이미지 준비 중…' : attachment.label}</span>
            <button type="button" onClick={attachment.onRemove} aria-label="첨부 삭제" title="첨부 삭제">
              <X size={13} />
            </button>
          </div>
        )}
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
          onPaste={(e) => {
            const f = onImage && imageFromTransfer(e.clipboardData)
            if (f) {
              e.preventDefault()
              onImage!(f)
            }
          }}
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
          <div className="ac-composer-left">
            {onImage && (
              <>
                <button type="button" className="ac-attach-btn" title="이미지 첨부 (붙여넣기·끌어다 놓기도 가능)" onClick={() => fileInput.current?.click()} disabled={disabled}>
                  <ImagePlus size={18} />
                </button>
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) onImage(f)
                    e.target.value = ''
                  }}
                />
              </>
            )}
            {text.length > maxLength * 0.8 && <span className="ac-count">{text.length}/{maxLength}</span>}
          </div>
          {busy && onStop ? (
            <button type="button" className="ac-send stop" onClick={onStop} aria-label="응답 중지">
              <Square size={12} fill="currentColor" />
            </button>
          ) : (
            <button
              type="button"
              className="ac-send"
              onClick={() => void submit()}
              disabled={!canSend}
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
