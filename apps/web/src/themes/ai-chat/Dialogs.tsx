import {
  GAME_META,
  GAME_TYPES,
  LIAR_CATEGORIES,
  LIAR_CATEGORY_LABEL,
  LIMITS,
  QUIZ_CATEGORIES,
  QUIZ_CATEGORY_LABEL,
  type GameType,
  type LiarCategory,
  type QuizCategory,
  type RoomPhase,
} from '@relay/shared'
import { MessageSquare, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { createSession, joinSession, peekSession } from '../../features/rooms/api'
import { THEMES, usePrefs, WORK_VIEW_KEYS, type Appearance, type WorkViewKey } from '../../stores/prefs'
import { useSession } from '../../stores/session'
import type { DemoConversation } from './data'
import { Dialog } from './ui'

/* ───────────── 새 공유 세션 ───────────── */

export function NewSessionDialog({ open, onClose, onCreated }: { open: boolean; onClose(): void; onCreated(): void }) {
  const savedName = usePrefs((s) => s.nickname)
  const [name, setName] = useState(savedName)
  const [title, setTitle] = useState('')
  const [type, setType] = useState<GameType>('liar')
  const [liarCat, setLiarCat] = useState<LiarCategory>('random')
  const [quizCat, setQuizCat] = useState<QuizCategory>('random')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) {
      setName(usePrefs.getState().nickname)
      setError('')
    }
  }, [open])

  async function submit() {
    if (!name.trim()) return setError('표시 이름을 입력하세요')
    setBusy(true)
    const r = await createSession({
      name,
      sessionName: title.trim() || undefined,
      gameType: type,
      settings: { liar: { category: liarCat }, quiz: { category: quizCat } },
    })
    setBusy(false)
    if (!r.ok) return setError(r.error.message)
    usePrefs.getState().setNickname(name.trim())
    onCreated()
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="새 공유 세션"
      footer={
        <>
          <button type="button" className="ac-btn" onClick={onClose}>취소</button>
          <button type="button" className="ac-btn primary" disabled={busy} onClick={() => void submit()}>
            {busy ? '만드는 중…' : '세션 만들기'}
          </button>
        </>
      }
    >
      <form
        className="ac-form"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <p className="ac-form-desc">
          링크를 받은 사람은 가입 없이 이름만 입력하고 참여할 수 있습니다. 설정은 기본값 그대로 시작해도 됩니다.
        </p>
        <label className="ac-field">
          <span>내 표시 이름</span>
          <input value={name} maxLength={LIMITS.nameMax} onChange={(e) => setName(e.target.value)} placeholder="예: 김민수" autoComplete="nickname" />
        </label>
        <label className="ac-field">
          <span>세션 이름 <em>선택</em></span>
          <input value={title} maxLength={LIMITS.sessionNameMax} onChange={(e) => setTitle(e.target.value)} placeholder="비워 두면 자동으로 지정됩니다" />
        </label>
        <fieldset className="ac-field">
          <span>작업 유형</span>
          <div className="ac-choice">
            {GAME_TYPES.map((g) => (
              <label key={g} className={type === g ? 'on' : ''}>
                <input type="radio" name="gt" checked={type === g} onChange={() => setType(g)} />
                <span className="ac-choice-title">{GAME_META[g].workTitle}</span>
                <span className="ac-choice-desc">
                  {GAME_META[g].workDesc} <span className="muted">({GAME_META[g].title} · {GAME_META[g].minPlayers}–{GAME_META[g].maxPlayers}명)</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        {(type === 'liar' || type === 'quiz') && <label className="ac-field">
          <span>{type === 'liar' ? '키워드 카테고리' : '문항 분야'}</span>
          {type === 'liar' ? (
            <select value={liarCat} onChange={(e) => setLiarCat(e.target.value as LiarCategory)}>
              {LIAR_CATEGORIES.map((c) => <option key={c} value={c}>{LIAR_CATEGORY_LABEL[c]}</option>)}
            </select>
          ) : (
            <select value={quizCat} onChange={(e) => setQuizCat(e.target.value as QuizCategory)}>
              {QUIZ_CATEGORIES.map((c) => <option key={c} value={c}>{QUIZ_CATEGORY_LABEL[c]}</option>)}
            </select>
          )}
        </label>}
        {error && <p className="ac-error">{error}</p>}
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}

/* ───────────── 세션 참여 (초대 링크 / 코드) ───────────── */

const PHASE_LABEL: Record<RoomPhase, string> = { WAITING: '대기 중', STARTING: '시작 중', PLAYING: '진행 중', RESULT: '결과 확인 중' }

export function JoinDialog({
  open,
  onClose,
  initialCode,
  onJoined,
}: {
  open: boolean
  onClose(): void
  initialCode?: string | null
  onJoined(): void
}) {
  const [code, setCode] = useState(initialCode ?? '')
  const [name, setName] = useState(usePrefs.getState().nickname)
  const [info, setInfo] = useState<{ name: string; members: number; phase: RoomPhase } | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const status = useSession((s) => s.status)

  useEffect(() => {
    if (open) {
      setCode(initialCode ?? '')
      setName(usePrefs.getState().nickname)
      setError('')
      setInfo(null)
    }
  }, [open, initialCode])

  useEffect(() => {
    const c = code.trim().toUpperCase()
    if (!open || c.length !== 6 || status !== 'online') return setInfo(null)
    let alive = true
    void peekSession(c).then((r) => {
      if (!alive) return
      if (r.ok) {
        setInfo(r.data)
        setError('')
      } else {
        setInfo(null)
        setError(r.error.message)
      }
    })
    return () => {
      alive = false
    }
  }, [code, open, status])

  async function submit() {
    if (code.trim().length !== 6) return setError('6자리 세션 코드를 입력하세요')
    if (!name.trim()) return setError('표시 이름을 입력하세요')
    setBusy(true)
    const r = await joinSession(code.trim(), name)
    setBusy(false)
    if (!r.ok) return setError(r.error.message)
    usePrefs.getState().setNickname(name.trim())
    onJoined()
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={initialCode ? '공유 세션에 초대되었습니다' : '코드로 세션 참여'}
      width={420}
      footer={
        <>
          <button type="button" className="ac-btn" onClick={onClose}>취소</button>
          <button type="button" className="ac-btn primary" disabled={busy || status !== 'online'} onClick={() => void submit()}>
            {busy ? '참여하는 중…' : '참여'}
          </button>
        </>
      }
    >
      <form
        className="ac-form"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        {info ? (
          <div className="ac-join-info">
            <MessageSquare size={18} />
            <div>
              <strong>{info.name}</strong>
              <span>참여자 {info.members}명 · {PHASE_LABEL[info.phase]}{info.phase === 'PLAYING' || info.phase === 'STARTING' ? ' — 이번 라운드는 관전으로 참여합니다' : ''}</span>
            </div>
          </div>
        ) : (
          <p className="ac-form-desc">가입 없이 표시 이름만으로 참여합니다.</p>
        )}
        {!initialCode && (
          <label className="ac-field">
            <span>세션 코드</span>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6).toUpperCase())}
              placeholder="예: K7XQ2P"
              className="mono"
              autoComplete="off"
            />
          </label>
        )}
        <label className="ac-field">
          <span>내 표시 이름</span>
          <input value={name} maxLength={LIMITS.nameMax} onChange={(e) => setName(e.target.value)} placeholder="예: 김민수" autoComplete="nickname" />
        </label>
        {status !== 'online' && <p className="ac-error">서버에 연결하는 중입니다…</p>}
        {error && <p className="ac-error">{error}</p>}
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}

/* ───────────── 설정 ───────────── */

export function SettingsDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const p = usePrefs()
  const [tab, setTab] = useState<'general' | 'shortcuts' | 'about'>('general')
  return (
    <Dialog open={open} onClose={onClose} title="설정" width={640}>
      <div className="ac-settings">
        <nav>
          <button type="button" className={tab === 'general' ? 'on' : ''} onClick={() => setTab('general')}>일반</button>
          <button type="button" className={tab === 'shortcuts' ? 'on' : ''} onClick={() => setTab('shortcuts')}>단축키</button>
          <button type="button" className={tab === 'about' ? 'on' : ''} onClick={() => setTab('about')}>정보</button>
        </nav>
        <div className="ac-settings-body">
          {tab === 'general' && (
            <>
              <div className="ac-setting">
                <div><strong>모양</strong><span>화면 밝기 테마</span></div>
                <select value={p.appearance} onChange={(e) => p.setAppearance(e.target.value as Appearance)}>
                  <option value="system">시스템 설정</option>
                  <option value="light">라이트</option>
                  <option value="dark">다크</option>
                </select>
              </div>
              <div className="ac-setting">
                <div><strong>인터페이스</strong><span>세션과 대화는 그대로 유지됩니다</span></div>
                <select value={p.theme} onChange={(e) => p.setTheme(e.target.value as 'ai' | 'terminal')}>
                  {THEMES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
              </div>
              <div className="ac-setting">
                <div><strong>표시 이름</strong><span>새로 참여하는 세션에 사용됩니다</span></div>
                <input value={p.nickname} maxLength={LIMITS.nameMax} onChange={(e) => p.setNickname(e.target.value)} placeholder="미설정" />
              </div>
              <div className="ac-setting">
                <div><strong>업무 보기</strong><span>공유 세션 영역을 숨기고 일반 대화만 표시</span></div>
                <label className="ac-switch">
                  <input type="checkbox" checked={p.workView} onChange={(e) => p.setWorkView(e.target.checked)} />
                  <span />
                </label>
              </div>
            </>
          )}
          {tab === 'shortcuts' && (
            <>
              <div className="ac-setting">
                <div><strong>업무 보기 전환</strong><span>브라우저/OS 단축키와 겹치면 변경하세요</span></div>
                <select value={p.workViewKey} onChange={(e) => p.setWorkViewKey(e.target.value as WorkViewKey)}>
                  {Object.entries(WORK_VIEW_KEYS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div className="ac-setting"><div><strong>메시지 보내기</strong></div><span className="ac-kbd-row"><kbd>Enter</kbd></span></div>
              <div className="ac-setting"><div><strong>줄바꿈</strong></div><span className="ac-kbd-row"><kbd>Shift</kbd><kbd>Enter</kbd></span></div>
              <div className="ac-setting"><div><strong>대화 검색</strong></div><span className="ac-kbd-row"><kbd>Ctrl</kbd><kbd>K</kbd></span></div>
            </>
          )}
          {tab === 'about' && (
            <div className="ac-about">
              <p><strong>Relay Workspace</strong> 0.1.0</p>
              <p>이 워크스페이스는 오프라인 데모 모드로 동작합니다. 어시스턴트 응답은 미리 작성된 템플릿이며 외부 AI 모델을 호출하지 않습니다.</p>
              <p>공유 세션은 서버 메모리에만 저장되며, 계정이나 개인 정보를 수집하지 않습니다. 서버가 재시작되거나 30분 이상 아무도 접속하지 않으면 세션이 정리됩니다.</p>
            </div>
          )}
        </div>
      </div>
    </Dialog>
  )
}

/* ───────────── 대화 검색 ───────────── */

export function SearchDialog({
  open,
  onClose,
  conversations,
  onPick,
}: {
  open: boolean
  onClose(): void
  conversations: DemoConversation[]
  onPick(id: string): void
}) {
  const [q, setQ] = useState('')
  useEffect(() => {
    if (open) setQ('')
  }, [open])
  const results = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return conversations.slice(0, 8).map((c) => ({ c, snippet: '' }))
    return conversations
      .map((c) => {
        const hit = c.messages.find((m) => m.content.toLowerCase().includes(t))
        const titleHit = c.title.toLowerCase().includes(t)
        if (!hit && !titleHit) return null
        let snippet = ''
        if (hit) {
          const i = hit.content.toLowerCase().indexOf(t)
          snippet = (i > 20 ? '…' : '') + hit.content.slice(Math.max(0, i - 20), i + 60).replace(/[`*#|]/g, '').replace(/\n/g, ' ')
        }
        return { c, snippet }
      })
      .filter(Boolean) as { c: DemoConversation; snippet: string }[]
  }, [q, conversations])
  return (
    <Dialog open={open} onClose={onClose} title="대화 검색" width={560}>
      <div className="ac-search">
        <div className="ac-search-input">
          <Search size={16} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="대화 제목이나 내용 검색"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && results[0]) onPick(results[0].c.id)
            }}
          />
        </div>
        <div className="ac-search-list">
          {results.length === 0 && <p className="ac-search-empty">일치하는 대화가 없습니다</p>}
          {results.map(({ c, snippet }) => (
            <button key={c.id} type="button" onClick={() => onPick(c.id)}>
              <MessageSquare size={15} />
              <span>
                <strong>{c.title}</strong>
                {snippet && <em>{snippet}</em>}
              </span>
            </button>
          ))}
        </div>
      </div>
    </Dialog>
  )
}
