import { GAME_META, LIMITS, type ChatMessage, type SystemEvent } from '@relay/shared'
import { ChevronRight, LogIn, LogOut, MessageSquareText, Repeat, Settings2, Sparkles, UserRound } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { gameAction, sendChat } from '../../features/rooms/api'
import { fmtClock, fmtTime, MAFIA_WINNER, REPLY_LABEL, TWENTY_WINNER, useRemaining, WINNER_LABEL, type SessionModel } from '../../game-ui/model'
import { useSession } from '../../stores/session'
import { Composer, type ComposerHandle } from './Composer'
import { GamePanel } from './GamePanel'
import { Avatar } from './ui'

/** 이벤트를 업무 로그 문장으로 */
function eventText(e: SystemEvent): { icon: ReactNode; text: ReactNode } | null {
  switch (e.code) {
    case 'room_created':
      return { icon: <Sparkles size={13} />, text: <>공유 세션 <b>{e.name}</b>을(를) 만들었습니다</> }
    case 'joined':
      return { icon: <LogIn size={13} />, text: <><b>{e.name}</b>님이 참여했습니다{e.spectator ? ' (관전)' : ''}</> }
    case 'left':
      return { icon: <LogOut size={13} />, text: <><b>{e.name}</b>님이 나갔습니다</> }
    case 'host_changed':
      return { icon: <UserRound size={13} />, text: <>호스트가 <b>{e.name}</b>님으로 변경되었습니다</> }
    case 'game_selected':
      return { icon: <Settings2 size={13} />, text: <>작업 유형을 <b>{GAME_META[e.game].workTitle}</b>(으)로 변경했습니다</> }
    case 'game_starting':
      return { icon: <Repeat size={13} />, text: <>{GAME_META[e.game].workTitle} 작업을 준비합니다</> }
    case 'game_started':
      return { icon: <Repeat size={13} />, text: <>{GAME_META[e.game].workTitle} 라운드 {e.round} 시작</> }
    case 'game_stopped':
      return { icon: <Repeat size={13} />, text: <><b>{e.by}</b>님이 작업을 중단했습니다</> }
    case 'game_aborted':
      return { icon: <Repeat size={13} />, text: <>작업이 취소되었습니다 — {e.reason}</> }
    case 'liar_turn':
      return null
    case 'liar_described':
      return null // 별도 렌더링
    case 'liar_discuss':
      return { icon: <MessageSquareText size={13} />, text: <>모든 설명이 등록되었습니다. 자유 토론 {e.seconds}초</> }
    case 'liar_vote_open':
      return { icon: <ChevronRight size={13} />, text: <>{e.revote ? '재투표' : '투표'}가 열렸습니다 — 후보 {e.candidates.join(', ')}</> }
    case 'liar_accused':
      return { icon: <ChevronRight size={13} />, text: <><b>{e.name}</b>님이 {e.votes}표로 지목되었습니다</> }
    case 'liar_guess_open':
      return { icon: <ChevronRight size={13} />, text: <>라이어 {e.name}님이 키워드를 추측합니다</> }
    case 'liar_result':
      return { icon: <ChevronRight size={13} />, text: <>결과: <b>{WINNER_LABEL[e.winner]}</b> · 라이어 {e.liarName} · 키워드 {e.word}</> }
    case 'quiz_question':
      return { icon: <ChevronRight size={13} />, text: <>문항 {e.index + 1}/{e.total} 출제</> }
    case 'quiz_reveal':
      return {
        icon: <ChevronRight size={13} />,
        text: <>문항 {e.index + 1} 정답 <b>{e.answer}</b>{e.correctNames.length ? ` · 정답자 ${e.correctNames.join(', ')}` : ' · 정답자 없음'}</>,
      }
    case 'quiz_result':
      return { icon: <ChevronRight size={13} />, text: <>최종 1위 <b>{e.ranking[0]?.name ?? '-'}</b> ({e.ranking[0]?.score ?? 0}점)</> }
    case 'mafia_night':
      return { icon: <ChevronRight size={13} />, text: <>{e.day}일차 밤 — 마피아가 대상을 고르는 중입니다</> }
    case 'mafia_dawn':
      return { icon: <ChevronRight size={13} />, text: e.killedName ? <>{e.day}일차 아침 · <b>{e.killedName}</b>님이 제외되었습니다</> : <>{e.day}일차 아침 · 아무도 제외되지 않았습니다</> }
    case 'mafia_vote_open':
      return { icon: <ChevronRight size={13} />, text: <>{e.day}일차 투표가 열렸습니다</> }
    case 'mafia_executed':
      return { icon: <ChevronRight size={13} />, text: e.name ? <><b>{e.name}</b>님이 {e.votes}표로 제외되었습니다</> : <>동률 또는 기권으로 아무도 제외되지 않았습니다</> }
    case 'mafia_result':
      return { icon: <ChevronRight size={13} />, text: <>결과: <b>{MAFIA_WINNER[e.winner]}</b> · 마피아 {e.mafiaNames.join(', ')}</> }
    case 'word_played':
      return null
    case 'word_out':
      return { icon: <LogOut size={13} />, text: <><b>{e.name}</b>님 탈락 — {e.reason === 'timeout' ? '시간 초과' : e.reason === 'rejected' ? '단어 무효 처리' : '세션 이탈'}</> }
    case 'word_result':
      return { icon: <ChevronRight size={13} />, text: <>결과: {e.winnerName ? <><b>{e.winnerName}</b> 승리</> : '승자 없음'} · {e.length}개 연결</> }
    case 'baseball_round':
      return { icon: <ChevronRight size={13} />, text: <>{e.round}턴 판정 · {e.results.map((r) => `${r.name} ${r.guess} → ${r.strike}S ${r.ball}B`).join(' · ') || '제출 없음'}</> }
    case 'baseball_result':
      return { icon: <ChevronRight size={13} />, text: <>결과: 정답 <b>{e.secret}</b> · {e.winners.length ? `${e.winners.join(', ')} 승리` : '아무도 맞히지 못함'}</> }
    case 'twenty_ready':
      return { icon: <ChevronRight size={13} />, text: <>출제자 <b>{e.setterName}</b> · 분류 {e.category} · 질문을 시작하세요</> }
    case 'twenty_asked':
      return null
    case 'twenty_replied':
      return null
    case 'twenty_result':
      return { icon: <ChevronRight size={13} />, text: <>결과: <b>{TWENTY_WINNER[e.winner]}</b> · 정답 {e.answer}{e.solverName ? ` · ${e.solverName}님이 맞힘` : ''}</> }
  }
}

type Item =
  | { k: 'chat'; m: Extract<ChatMessage, { type: 'chat' }>; mine: boolean; grouped: boolean }
  | { k: 'desc'; m: Extract<ChatMessage, { type: 'event' }>; e: Extract<SystemEvent, { code: 'liar_described' }>; label?: string; reply?: string }
  | { k: 'log'; list: Extract<ChatMessage, { type: 'event' }>[] }

function buildItems(chat: ChatMessage[], meId: string): Item[] {
  const items: Item[] = []
  for (const m of chat) {
    if (m.type === 'chat') {
      const prev = items[items.length - 1]
      const grouped = !!prev && prev.k === 'chat' && prev.m.authorId === m.authorId && m.ts - prev.m.ts < 120_000
      items.push({ k: 'chat', m, mine: m.authorId === meId, grouped })
    } else if (m.event.code === 'liar_described') {
      items.push({ k: 'desc', m, e: m.event })
    } else if (m.event.code === 'word_played') {
      items.push({ k: 'desc', m, e: { code: 'liar_described', name: m.event.name, text: m.event.word, timedOut: false }, label: '단어' })
    } else if (m.event.code === 'twenty_asked') {
      items.push({ k: 'desc', m, e: { code: 'liar_described', name: m.event.name, text: m.event.text, timedOut: false }, label: m.event.kind === 'guess' ? '정답 도전' : '질문' })
    } else if (m.event.code === 'twenty_replied') {
      const ev = m.event
      const prev = items[items.length - 1]
      if (prev && prev.k === 'desc') prev.reply = ev.kind === 'guess' ? (ev.correct ? '정답' : '오답') : REPLY_LABEL[ev.reply]
    } else if (eventText(m.event)) {
      const prev = items[items.length - 1]
      if (prev && prev.k === 'log') prev.list.push(m)
      else items.push({ k: 'log', list: [m] })
    }
  }
  return items
}

function LogGroup({ list }: { list: Extract<ChatMessage, { type: 'event' }>[] }) {
  const [open, setOpen] = useState(false)
  const collapsible = list.length > 3
  const shown = collapsible && !open ? list.slice(-2) : list
  return (
    <div className="ac-log">
      {collapsible && (
        <button type="button" className="ac-log-toggle" onClick={() => setOpen((v) => !v)}>
          <ChevronRight size={13} className={open ? 'rot' : ''} /> 작업 로그 {list.length}건{open ? '' : ` · 이전 ${list.length - 2}건 숨김`}
        </button>
      )}
      {shown.map((m) => {
        const t = eventText(m.event)!
        return (
          <div key={m.id} className="ac-log-line">
            <span className="ac-log-icon">{t.icon}</span>
            <span className="ac-log-text">{t.text}</span>
            <time>{fmtTime(m.ts)}</time>
          </div>
        )
      })}
    </div>
  )
}

export function SessionView({ m, toast }: { m: SessionModel; toast(s: string): void }) {
  const chat = useSession((s) => s.chat)
  const status = useSession((s) => s.status)
  const items = useMemo(() => buildItems(chat, m.snap.meId), [chat, m.snap.meId])
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const composer = useRef<ComposerHandle>(null)
  const [forceChat, setForceChat] = useState(false)

  const task = m.task
  const [twentyGuess, setTwentyGuess] = useState(false)
  const typed = ['liar.describe', 'liar.guess', 'word.submit', 'baseball.guess', 'twenty.ask'] as const
  type TypedKind = (typeof typed)[number]
  const isTyped = (k: string): k is TypedKind => (typed as readonly string[]).includes(k)
  const mode: TypedKind | 'chat' = !forceChat && isTyped(task.kind) ? task.kind : 'chat'
  const left = useRemaining('deadline' in task ? task.deadline : null)

  // 새 차례가 오면 입력 모드 초기화 + 포커스
  useEffect(() => {
    setForceChat(false)
    if (isTyped(task.kind)) composer.current?.focus()
  }, [task.kind])

  useEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  })

  const chip =
    mode === 'liar.describe'
      ? { label: <>내 차례 · 키워드 설명 <span className="ac-chip-muted">{LIMITS.describeMax}자 이내 · {fmtClock(left)}</span></>, onClear: () => setForceChat(true) }
      : mode === 'liar.guess'
        ? { label: <>키워드 추측 <span className="ac-chip-muted">1회 · {fmtClock(left)}</span></>, onClear: () => setForceChat(true) }
        : mode === 'word.submit'
          ? { label: <>내 차례 · 끝말잇기 <span className="ac-chip-muted">'{task.kind === 'word.submit' ? task.allowed.join("' 또는 '") : ''}'(으)로 시작 · {fmtClock(left)}</span></>, onClear: () => setForceChat(true) }
          : mode === 'baseball.guess'
            ? { label: <>숫자 제출 <span className="ac-chip-muted">서로 다른 {task.kind === 'baseball.guess' ? task.digits : 3}자리 · {fmtClock(left)}</span></>, onClear: () => setForceChat(true) }
            : mode === 'twenty.ask'
              ? {
                  label: (
                    <span className="ac-chip-seg">
                      <button type="button" className={twentyGuess ? '' : 'on'} onClick={() => setTwentyGuess(false)}>예/아니오 질문</button>
                      <button type="button" className={twentyGuess ? 'on' : ''} onClick={() => setTwentyGuess(true)}>정답 도전</button>
                    </span>
                  ),
                  onClear: () => setForceChat(true),
                }
              : forceChat && isTyped(task.kind)
                ? { label: <button type="button" className="ac-chip-link" onClick={() => setForceChat(false)}>입력 모드로 돌아가기</button> }
                : null

  async function send(text: string) {
    stick.current = true
    const r =
      mode === 'liar.describe'
        ? await gameAction({ type: 'liar.describe', text: text.slice(0, LIMITS.describeMax) })
        : mode === 'liar.guess'
          ? await gameAction({ type: 'liar.guess', word: text.slice(0, LIMITS.guessMax) })
          : mode === 'word.submit'
            ? await gameAction({ type: 'word.submit', word: text.slice(0, 20) })
            : mode === 'baseball.guess'
              ? await gameAction({ type: 'baseball.guess', guess: text.replace(/\D/g, '').slice(0, 4) })
              : mode === 'twenty.ask'
                ? await gameAction(twentyGuess ? { type: 'twenty.guess', text: text.slice(0, 30) } : { type: 'twenty.ask', text: text.slice(0, 100) })
                : await sendChat(text)
    if (!r.ok) {
      toast(r.error.message)
      return false
    }
    return true
  }

  const placeholder =
    mode === 'liar.describe'
      ? '키워드를 설명하는 한 문장을 입력하세요'
      : mode === 'liar.guess'
        ? '추측한 키워드를 입력하세요'
        : mode === 'word.submit'
          ? '이어질 단어를 입력하세요'
          : mode === 'baseball.guess'
            ? '예: 382'
            : mode === 'twenty.ask'
              ? twentyGuess
                ? '정답이라고 생각하는 단어 (질문 1회 소모)'
                : '예/아니오로 답할 수 있는 질문을 입력하세요'
              : status !== 'online'
          ? '연결을 다시 시도하는 중…'
          : `${m.snap.name}에 메시지 보내기`

  return (
    <div className="ac-main-body">
      <div
        className="ac-scroll"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
        }}
      >
        <div className="ac-thread ac-session-thread">
          {items.map((it) => {
            if (it.k === 'log') return <LogGroup key={it.list[0].id} list={it.list} />
            if (it.k === 'desc')
              return (
                <div key={it.m.id} className="ac-desc">
                  <Avatar name={it.e.name} size={22} />
                  <div>
                    <div className="ac-desc-head">
                      <b>{it.e.name}</b> <span>{it.label ?? '설명 등록'}</span> <time>{fmtTime(it.m.ts)}</time>
                    </div>
                    <div className={`ac-desc-text${it.e.timedOut ? ' muted' : ''}`}>
                      {it.e.text}
                      {it.reply && <span className="ac-desc-reply">→ {it.reply}</span>}
                    </div>
                  </div>
                </div>
              )
            const c = it.m
            if (it.mine)
              return (
                <div key={c.id} className={`ac-msg-user${it.grouped ? ' grouped' : ''}`}>
                  <div className="ac-bubble">{c.text}</div>
                </div>
              )
            return (
              <div key={c.id} className={`ac-peer${it.grouped ? ' grouped' : ''}`}>
                {it.grouped ? <span className="ac-peer-gap" /> : <Avatar name={c.authorName} size={28} />}
                <div className="ac-peer-body">
                  {!it.grouped && (
                    <div className="ac-peer-head">
                      <b>{c.authorName}</b>
                      <time>{fmtTime(c.ts)}</time>
                    </div>
                  )}
                  <div className="ac-peer-text">{c.text}</div>
                </div>
              </div>
            )
          })}
          <GamePanel m={m} toast={toast} />
        </div>
      </div>
      <Composer
        ref={composer}
        placeholder={placeholder}
        onSend={send}
        disabled={status !== 'online'}
        maxLength={mode === 'liar.describe' ? LIMITS.describeMax : mode === 'liar.guess' ? LIMITS.guessMax : mode === 'baseball.guess' ? 4 : mode === 'word.submit' ? 20 : mode === 'twenty.ask' ? 100 : LIMITS.chatMax}
        chip={chip}
        footer={
          <p className="ac-disclaimer">
            공유 세션의 메시지는 참여자 모두에게 표시됩니다 · 세션은 서버 재시작 시 초기화됩니다
          </p>
        }
      />
    </div>
  )
}
