import { useEffect } from 'react'
import '../lib/socket'
import { inviteCodeFromLocation } from '../lib/paths'
import { usePrefs } from '../stores/prefs'
import { useSession } from '../stores/session'
import { AiChatApp } from '../themes/ai-chat/AiChatApp'
import { TerminalApp } from '../themes/terminal/TerminalApp'

/** /s/CODE 로 들어오면 초대 대기 상태로 기록 (이미 같은 세션 멤버면 자동 재참여) */
function readInviteFromUrl() {
  const code = inviteCodeFromLocation()
  if (!code) return
  const s = useSession.getState()
  if (s.membership?.code === code) return
  s.setPendingInvite(code)
}
readInviteFromUrl()

export function App() {
  const theme = usePrefs((s) => s.theme)
  const appearance = usePrefs((s) => s.appearance)
  const key = usePrefs((s) => s.workViewKey)

  // 업무 보기 단축키
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const hit =
        key === 'ctrl-shift-space'
          ? (e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'Space'
          : (e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === '.'
      if (hit) {
        e.preventDefault()
        usePrefs.getState().toggleWorkView()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [key])

  // 라이트/다크
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = appearance === 'dark' || (appearance === 'system' && mq.matches)
      document.documentElement.dataset.appearance = dark ? 'dark' : 'light'
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [appearance])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  return theme === 'terminal' ? <TerminalApp /> : <AiChatApp />
}
