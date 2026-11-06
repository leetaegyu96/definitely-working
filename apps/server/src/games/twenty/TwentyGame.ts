import type { GameAction, TwentyReply, TwentySettings, TwentyView } from '@relay/shared'
import { newId } from '../../services/ids.js'
import { fail, ok, type ActionResult, type GameContext, type GameEngine } from '../types.js'

/**
 * 스무고개 — 사람이 답하는 방식 (AI 없음).
 * 출제자 1명(무작위)이 답과 분류를 정하면, 나머지가 예/아니오 질문 또는 정답 도전을 한다.
 * 한 번에 하나의 질문만 대기. 정답 도전은 서버가 자동 판정(공백·대소문자 무시)하고 질문 1회를 소모한다.
 */
const SETUP_SECONDS = 60
const REPLY_SECONDS = 60
const FALLBACK: { answer: string; category: string }[] = [
  { answer: '냉장고', category: '사물' },
  { answer: '펭귄', category: '동물' },
  { answer: '떡볶이', category: '음식' },
  { answer: '도서관', category: '장소' },
  { answer: '소방관', category: '직업' },
  { answer: '자전거', category: '사물' },
]

const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase()

export class TwentyGame implements GameEngine {
  readonly type = 'twenty' as const
  private stage: TwentyView['stage'] = 'setup'
  private setterId = ''
  private answer = ''
  private category = ''
  private questions: TwentyView['questions'] = []
  private pendingId: string | null = null
  private deadline: number | null = null
  private result: TwentyView['result'] = null
  private cancel: (() => void) | null = null
  private players: string[] = []

  constructor(private ctx: GameContext<TwentySettings>) {}

  start() {
    this.players = this.ctx.participants.map((p) => p.id)
    this.setterId = this.players[Math.floor(this.ctx.random() * this.players.length)]
    this.ctx.emit({ code: 'game_started', game: 'twenty', round: this.ctx.round })
    this.schedule(SETUP_SECONDS * 1000, () => {
      const f = FALLBACK[Math.floor(this.ctx.random() * FALLBACK.length)]
      this.beginAsking(f.answer, f.category)
    })
    this.ctx.changed()
  }

  dispose() {
    this.cancel?.()
  }

  private name(id: string | null) {
    return id ? (this.ctx.participants.find((p) => p.id === id)?.name ?? '알 수 없음') : ''
  }

  private schedule(ms: number, fn: () => void) {
    this.cancel?.()
    this.deadline = this.ctx.now() + ms
    this.cancel = this.ctx.setTimer(ms, () => {
      this.cancel = null
      fn()
    })
  }

  private clearTimer() {
    this.cancel?.()
    this.cancel = null
    this.deadline = null
  }

  private beginAsking(answer: string, category: string) {
    this.answer = answer
    this.category = category
    this.stage = 'asking'
    this.clearTimer()
    this.ctx.emit({ code: 'twenty_ready', setterName: this.name(this.setterId), category })
    this.ctx.changed()
  }

  private used() {
    return this.questions.length
  }

  private finish(winner: 'guessers' | 'setter' | 'none', solverId: string | null) {
    this.clearTimer()
    this.stage = 'result'
    this.pendingId = null
    this.result = { winner, answer: this.answer, solverId }
    this.ctx.emit({ code: 'twenty_result', winner, answer: this.answer, solverName: solverId ? this.name(solverId) : null })
    this.ctx.finish()
    this.ctx.changed()
  }

  private applyReply(q: TwentyView['questions'][number], reply: TwentyReply) {
    q.reply = reply
    this.pendingId = null
    this.clearTimer()
    this.ctx.emit({ code: 'twenty_replied', text: q.text, reply, kind: q.kind, correct: false })
    if (this.used() >= this.ctx.settings.maxQuestions) return this.finish('setter', null)
    this.ctx.changed()
  }

  action(playerId: string, action: GameAction): ActionResult {
    const isSetter = playerId === this.setterId
    const isGuesser = this.players.includes(playerId) && !isSetter
    switch (action.type) {
      case 'twenty.setup':
        if (this.stage !== 'setup') return fail('BAD_STATE', '이미 문제가 정해졌습니다')
        if (!isSetter) return fail('FORBIDDEN', '출제자만 정할 수 있습니다')
        this.beginAsking(action.answer, action.category)
        return ok
      case 'twenty.ask':
      case 'twenty.guess': {
        if (this.stage !== 'asking') return fail('BAD_STATE', '질문을 받는 중이 아닙니다')
        if (!isGuesser) return fail('FORBIDDEN', '출제자는 질문할 수 없습니다')
        if (this.pendingId) return fail('BAD_STATE', '앞 질문의 답변을 기다리는 중입니다')
        const kind = action.type === 'twenty.ask' ? 'question' : 'guess'
        const q = { id: newId(), askerId: playerId, text: action.text, kind, reply: null, correct: false } as TwentyView['questions'][number]
        this.questions.push(q)
        this.ctx.emit({ code: 'twenty_asked', name: this.name(playerId), text: q.text, kind })
        if (kind === 'guess') {
          const correct = norm(action.text) === norm(this.answer)
          q.reply = correct ? 'yes' : 'no'
          q.correct = correct
          this.ctx.emit({ code: 'twenty_replied', text: q.text, reply: q.reply, kind, correct })
          if (correct) return this.finish('guessers', playerId), ok
          if (this.used() >= this.ctx.settings.maxQuestions) return this.finish('setter', null), ok
          this.ctx.changed()
          return ok
        }
        this.pendingId = q.id
        // 출제자가 답하지 않으면 "애매"로 자동 처리
        this.schedule(REPLY_SECONDS * 1000, () => this.applyReply(q, 'maybe'))
        this.ctx.changed()
        return ok
      }
      case 'twenty.reply': {
        if (this.stage !== 'asking') return fail('BAD_STATE', '질문을 받는 중이 아닙니다')
        if (!isSetter) return fail('FORBIDDEN', '출제자만 답할 수 있습니다')
        const q = this.questions.find((x) => x.id === action.questionId)
        if (!q || q.id !== this.pendingId) return fail('INVALID', '답할 질문이 아닙니다')
        this.applyReply(q, action.reply)
        return ok
      }
      default:
        return fail('INVALID', '지원하지 않는 동작입니다')
    }
  }

  playerLeft(playerId: string) {
    if (!this.players.includes(playerId) || this.stage === 'result') return
    this.players = this.players.filter((p) => p !== playerId)
    if (playerId === this.setterId) return this.finish('none', null)
    if (this.players.length < 2) return this.finish('none', null)
    this.ctx.changed()
  }

  view(playerId: string | null): TwentyView {
    const inGame = playerId !== null && this.players.includes(playerId)
    const isSetter = playerId === this.setterId
    return {
      type: 'twenty',
      round: this.ctx.round,
      stage: this.stage,
      setterId: this.setterId,
      myRole: !inGame ? 'spectator' : isSetter ? 'setter' : 'guesser',
      category: this.category,
      answer: isSetter ? this.answer || null : null,
      maxQuestions: this.ctx.settings.maxQuestions,
      questions: this.questions.map((q) => ({ ...q })),
      pendingId: this.pendingId,
      deadline: this.stage === 'result' ? null : this.deadline,
      result: this.result,
    }
  }
}
