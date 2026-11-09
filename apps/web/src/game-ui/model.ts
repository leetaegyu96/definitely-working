/**
 * 테마 독립 게임 UI 모델.
 * 서버 스냅샷 → "지금 내가 해야 할 일(task)" + 표시용 데이터로 변환한다.
 * 각 테마는 이 모델만 보고 자기 방식으로 그린다 (규칙/판정은 전부 서버).
 */
import {
  canStartGame,
  GAME_META,
  LIAR_CATEGORY_LABEL,
  QUIZ_CATEGORY_LABEL,
  type BaseballView,
  type GameType,
  type LiarView,
  type MafiaView,
  type PlayerInfo,
  type QuizView,
  type RoomSnapshot,
  type SystemEvent,
  type TwentyView,
  type WordchainView,
} from '@relay/shared'
import { useEffect, useState } from 'react'
import { useSession } from '../stores/session'

export type Task =
  | { kind: 'none' }
  | { kind: 'liar.describe'; deadline: number | null }
  /** myVote: undefined = 아직, null = 기권 */
  | { kind: 'liar.vote'; options: PlayerInfo[]; myVote: string | null | undefined; deadline: number | null; revote: boolean }
  | { kind: 'liar.guess'; deadline: number | null }
  | { kind: 'quiz.answer'; choices: string[]; myAnswer: number | null; deadline: number | null }
  | { kind: 'mafia.kill'; options: PlayerInfo[]; myPick: string | null; deadline: number | null }
  | { kind: 'mafia.vote'; options: PlayerInfo[]; deadline: number | null }
  | { kind: 'word.submit'; allowed: string[]; deadline: number | null }
  | { kind: 'word.challengeVote'; word: string; author: string; by: string; needed: number; myVote: boolean | undefined; deadline: number }
  | { kind: 'baseball.guess'; digits: number; deadline: number | null }
  | {
      kind: 'twenty.setup'
      deadline: number | null
      options: { id: string; answer: string; category: string }[]
      rerollsLeft: number
      freeInput: boolean
    }
  | { kind: 'twenty.reply'; question: string; questionId: string; deadline: number | null }
  | { kind: 'twenty.ask'; deadline: number | null }

export interface SessionModel {
  snap: RoomSnapshot
  me: PlayerInfo | undefined
  isHost: boolean
  host: PlayerInfo | undefined
  players: PlayerInfo[]
  /** 다음 게임에 참여 가능한 (관전자 아님) 접속 인원 */
  activeCount: number
  online: number
  meta: (typeof GAME_META)[GameType]
  canStart: { ok: boolean; reason?: string }
  liar: LiarView | null
  quiz: QuizView | null
  mafia: MafiaView | null
  wordchain: WordchainView | null
  baseball: BaseballView | null
  twenty: TwentyView | null
  task: Task
  name(id: string | null | undefined): string
  settingsSummary: string
  /** 진행 중인 판에서 빠져 있음(관전·사망·탈락) → 내 채팅은 같은 처지끼리만 보인다 */
  amOut: boolean
}

export function buildModel(snap: RoomSnapshot): SessionModel {
  const players = snap.players
  const me = players.find((p) => p.id === snap.meId)
  const byId = new Map(players.map((p) => [p.id, p]))
  const name = (id: string | null | undefined) => (id ? (byId.get(id)?.name ?? '나간 사용자') : '')
  const activeCount = players.filter((p) => p.connected).length
  const liar = snap.game?.type === 'liar' ? snap.game : null
  const quiz = snap.game?.type === 'quiz' ? snap.game : null
  const mafia = snap.game?.type === 'mafia' ? snap.game : null
  const wordchain = snap.game?.type === 'wordchain' ? snap.game : null
  const baseball = snap.game?.type === 'baseball' ? snap.game : null
  const twenty = snap.game?.type === 'twenty' ? snap.game : null
  const info = (id: string) => byId.get(id) ?? { id, name: name(id), connected: false, spectator: false, joinedAt: 0 }

  let task: Task = { kind: 'none' }
  if (snap.phase === 'PLAYING' && liar && liar.myRole !== 'spectator') {
    if (liar.stage === 'describe' && liar.currentTurnId === snap.meId) task = { kind: 'liar.describe', deadline: liar.deadline }
    else if (liar.stage === 'vote')
      task = {
        kind: 'liar.vote',
        options: liar.candidates.filter((id) => id !== snap.meId).map((id) => byId.get(id) ?? { id, name: name(id), connected: false, spectator: false, joinedAt: 0 }),
        myVote: liar.myVote,
        deadline: liar.deadline,
        revote: liar.revote,
      }
    else if (liar.stage === 'guess' && liar.myRole === 'liar') task = { kind: 'liar.guess', deadline: liar.deadline }
  }
  if (snap.phase === 'PLAYING' && quiz && quiz.stage === 'question' && quiz.question && quiz.participants.includes(snap.meId))
    task = { kind: 'quiz.answer', choices: quiz.question.choices, myAnswer: quiz.myAnswer, deadline: quiz.deadline }
  const me_ = snap.meId
  if (snap.phase === 'PLAYING' && mafia && mafia.alive.includes(me_)) {
    if (mafia.stage === 'night' && mafia.myRole === 'mafia')
      task = { kind: 'mafia.kill', options: mafia.alive.filter((id) => !mafia.team.includes(id)).map(info), myPick: mafia.nightVotes[me_] ?? null, deadline: mafia.deadline }
    else if (mafia.stage === 'vote' && mafia.myVote === undefined)
      task = { kind: 'mafia.vote', options: mafia.alive.filter((id) => id !== me_).map(info), deadline: mafia.deadline }
  }
  if (snap.phase === 'PLAYING' && wordchain?.stage === 'turn') {
    const c = wordchain.challenge
    if (c && c.voters.includes(me_) && c.myVote === undefined)
      task = { kind: 'word.challengeVote', word: c.word, author: name(c.authorId), by: name(c.byId), needed: c.needed, myVote: c.myVote, deadline: c.deadline }
    else if (!c && wordchain.currentTurnId === me_) task = { kind: 'word.submit', allowed: wordchain.allowed, deadline: wordchain.deadline }
  }
  if (snap.phase === 'PLAYING' && baseball?.stage === 'guess' && baseball.participants.includes(me_) && !baseball.myGuess)
    task = { kind: 'baseball.guess', digits: baseball.digits, deadline: baseball.deadline }
  if (snap.phase === 'PLAYING' && twenty) {
    if (twenty.stage === 'setup' && twenty.myRole === 'setter')
      task = { kind: 'twenty.setup', deadline: twenty.deadline, options: twenty.options ?? [], rerollsLeft: twenty.rerollsLeft, freeInput: twenty.freeInput }
    else if (twenty.stage === 'asking' && twenty.myRole === 'setter' && twenty.pendingId) {
      const q = twenty.questions.find((x) => x.id === twenty.pendingId)
      if (q) task = { kind: 'twenty.reply', question: q.text, questionId: q.id, deadline: twenty.deadline }
    } else if (twenty.stage === 'asking' && twenty.myRole === 'guesser' && !twenty.pendingId && twenty.turnId === me_)
      task = { kind: 'twenty.ask', deadline: twenty.deadline }
  }

  const s = snap.settings
  const settingsSummary = {
    liar: `카테고리 ${LIAR_CATEGORY_LABEL[s.liar.category]} · 설명 ${s.liar.describeSeconds}초 · 토론 ${s.liar.discussSeconds}초`,
    quiz: `분야 ${QUIZ_CATEGORY_LABEL[s.quiz.category]} · ${s.quiz.questionCount}문항 · 문항당 ${s.quiz.seconds}초`,
    mafia: `낮 토론 ${s.mafia.discussSeconds}초 · 투표 ${s.mafia.voteSeconds}초 · 밤 ${s.mafia.nightSeconds}초 · 최대 8일`,
    wordchain: `차례당 ${s.wordchain.turnSeconds}초 · 두음법칙 허용 · 간편 모드(사전 없음)`,
    baseball: `${s.baseball.digits}자리 · 최대 ${s.baseball.maxRounds}턴 · 턴당 ${s.baseball.roundSeconds}초`,
    twenty: `질문 ${s.twenty.maxQuestions}개 · 출제자 무작위 · ${s.twenty.freeInput ? '정답 직접 입력' : '정답 은행에서 고르기'}`,
  }[snap.gameType]

  return {
    snap,
    me,
    isHost: snap.hostId === snap.meId,
    host: byId.get(snap.hostId),
    players,
    activeCount,
    online: players.filter((p) => p.connected).length,
    meta: GAME_META[snap.gameType],
    canStart: canStartGame(snap.gameType, activeCount),
    liar,
    quiz,
    mafia,
    wordchain,
    baseball,
    twenty,
    task,
    name,
    settingsSummary,
    amOut:
      snap.phase === 'PLAYING' &&
      (!!me?.spectator ||
        (!!mafia && mafia.players.includes(snap.meId) && !mafia.alive.includes(snap.meId)) ||
        (!!wordchain && wordchain.out.includes(snap.meId))),
  }
}

export function useSessionModel(): SessionModel | null {
  const snap = useSession((s) => s.snapshot)
  return snap ? buildModel(snap) : null
}

/** 서버 시계 기준 현재 시각 (주기적으로 갱신) */
export function useServerNow(intervalMs = 250) {
  const offset = useSession((s) => s.offset)
  const [now, setNow] = useState(() => Date.now() + offset)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() + offset), intervalMs)
    setNow(Date.now() + offset)
    return () => clearInterval(t)
  }, [offset, intervalMs])
  return now
}

export function useRemaining(deadline: number | null | undefined) {
  const now = useServerNow()
  if (!deadline) return null
  return Math.max(0, Math.ceil((deadline - now) / 1000))
}

export function fmtClock(secs: number | null) {
  if (secs === null) return ''
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function fmtTime(ts: number) {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** 이벤트 중 "업무 보기"에서도 무해한 것 / 게임 진행 관련인 것 구분 */
export function isGameEvent(e: SystemEvent) {
  return e.code.startsWith('liar_') || e.code.startsWith('quiz_') || e.code.startsWith('game_')
}

/** 내가 행동해야 하는 상황인지 (업무 보기 중 미세 알림용) */
export function needsAttention(m: SessionModel | null) {
  if (!m) return false
  const t = m.task
  if (t.kind === 'liar.describe' || t.kind === 'liar.guess') return true
  if (t.kind === 'liar.vote') return t.myVote === undefined
  if (t.kind === 'quiz.answer') return t.myAnswer === null
  if (t.kind === 'mafia.kill') return !t.myPick
  return t.kind !== 'none'
}

export const LIAR_STEPS = [
  { key: 'assign', label: '키워드 배정' },
  { key: 'describe', label: '순서대로 설명' },
  { key: 'discuss', label: '자유 토론' },
  { key: 'vote', label: '투표' },
  { key: 'result', label: '결과 확인' },
] as const

export function liarStepIndex(v: LiarView) {
  switch (v.stage) {
    case 'describe':
      return 1
    case 'discuss':
      return 2
    case 'vote':
      return 3
    case 'guess':
      return 4
    case 'result':
      return 5
  }
}

export const WINNER_LABEL = { liar: '라이어 승리', citizens: '참여자 승리', none: '중단' } as const
export const MAFIA_WINNER = { mafia: '마피아 승리', citizens: '시민 승리', none: '중단' } as const
export const TWENTY_WINNER = { guessers: '질문자 승리', setter: '출제자 승리', none: '중단' } as const
export const REPLY_LABEL = { yes: '예', no: '아니오', maybe: '애매함' } as const
