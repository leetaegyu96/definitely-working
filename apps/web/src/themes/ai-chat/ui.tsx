import { useEffect, useRef, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'

/** 바깥 클릭 / Esc 로 닫히는 드롭다운 */
export function Popover({
  open,
  onClose,
  children,
  align = 'left',
  side = 'bottom',
  className = '',
}: {
  open: boolean
  onClose(): void
  children: ReactNode
  align?: 'left' | 'right'
  side?: 'bottom' | 'top'
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as HTMLElement).closest('[data-popover-anchor]'))
        onClose()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])
  if (!open) return null
  return (
    <div ref={ref} className={`ac-pop ac-pop-${align} ac-pop-${side} ${className}`} role="menu">
      {children}
    </div>
  )
}

export function MenuItem({
  icon,
  children,
  onClick,
  hint,
  danger,
  disabled,
  checked,
}: {
  icon?: ReactNode
  children: ReactNode
  onClick?(): void
  hint?: ReactNode
  danger?: boolean
  disabled?: boolean
  checked?: boolean
}) {
  return (
    <button type="button" role="menuitem" className={`ac-mi${danger ? ' danger' : ''}`} onClick={onClick} disabled={disabled}>
      {icon !== undefined && <span className="ac-mi-icon">{icon}</span>}
      <span className="ac-mi-label">{children}</span>
      {hint && <span className="ac-mi-hint">{hint}</span>}
      {checked && <span className="ac-mi-check">✓</span>}
    </button>
  )
}

export const MenuSep = () => <div className="ac-msep" />

export function Dialog({
  open,
  onClose,
  title,
  children,
  width = 480,
  footer,
}: {
  open: boolean
  onClose(): void
  title: ReactNode
  children: ReactNode
  width?: number
  footer?: ReactNode
}) {
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    const t = setTimeout(() => panel.current?.querySelector<HTMLElement>('input, select, textarea, button.primary')?.focus(), 30)
    return () => {
      document.removeEventListener('keydown', onKey)
      clearTimeout(t)
    }
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="ac-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={panel} className="ac-dialog" style={{ width }} role="dialog" aria-modal="true">
        <div className="ac-dialog-head">
          <h2>{title}</h2>
          <button type="button" className="ac-icon-btn" onClick={onClose} aria-label="닫기">
            <X size={18} />
          </button>
        </div>
        <div className="ac-dialog-body">{children}</div>
        {footer && <div className="ac-dialog-foot">{footer}</div>}
      </div>
    </div>
  )
}

const AVATAR_TONES = ['#7c6f64', '#5b7083', '#6b7a5a', '#8a6a6a', '#6a6a8a', '#7a6e52', '#4f7a78', '#7d5f7a']
export function toneFor(name: string) {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return AVATAR_TONES[h % AVATAR_TONES.length]
}

export function Avatar({ name, size = 28, dim }: { name: string; size?: number; dim?: boolean }) {
  return (
    <span
      className="ac-avatar"
      style={{ width: size, height: size, fontSize: size * 0.42, background: toneFor(name), opacity: dim ? 0.45 : 1 }}
      aria-hidden
    >
      {name.trim().slice(0, 1).toUpperCase()}
    </span>
  )
}

export function BrandMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="ac-brand-mark">
      <rect width="32" height="32" rx="8" fill="currentColor" />
      <path
        d="M10 22V10h6.5a4 4 0 0 1 0 8H13m3.5 0L22 22"
        fill="none"
        stroke="var(--bg)"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function useToast() {
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => {
    if (!msg) return
    const t = setTimeout(() => setMsg(null), 2200)
    return () => clearTimeout(t)
  }, [msg])
  const node = msg ? <div className="ac-toast" role="status">{msg}</div> : null
  return [node, setMsg] as const
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="ac-kbd">{children}</kbd>
}
