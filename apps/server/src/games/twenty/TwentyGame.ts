import type { GameAction, TwentyReply, TwentySettings, TwentyView } from '@relay/shared'
import { matchesAnswer, TWENTY_BANK, type WordEntry } from '../../content/index.js'
import { newId } from '../../services/ids.js'
import { fail, ok, shuffle, type ActionResult, type GameContext, type GameEngine } from '../types.js'

/**
 * 스무고개 — 사람이 답하는 방식 (AI 없음).
 * 출제자 1명(무작위)이 정답 은행 후보 중 하나를 고르면(고급 옵션: 직접 입력),
 * 나머지가 정해진 순서대로 한 명씩 예/아니오 질문 또는 정답 도전을 한다. 둘 다 1회 소모.
 */
export const QUESTION_SECONDS = 20
export const REPLY_SECONDS = 15
export const GAME_LIMIT_MS = 8 * 60_000
const OPTION_COUNT = 3
const REROLLS = 2

type Question = TwentyView['questions'][number]

export class TwentyGame implements GameEngine {
  readonly type = 'twenty' as const
  private stage: TwentyView['stage'] = 'setup'
  private setterId = ''
  private entry: { text: string; aliases: string[]; category: string } = { text: '', aliases: [], category: '' }
  private options: WordEntry[] = []
  private rerollsLeft = REROLLS
  private questions: Question[] = []
  private pendingId: string | null = null
  private order: string[] = []
  private turnIdx = -1
  deadline: number | null = null
  private endsAt: number | null = null
  private result: TwentyView['result'] = null
  private cancel: (() => void) | null = null
  private cancelLimit: (() => void) | null = null
  private players: string[] = []

  constructor(private ctx: GameContext<TwentySettings>) {}

  start() {
    this.players = this.ctx.participants.map((p) => p.id)
    this.setterId = this.players[Math.floor(this.ctx.random() * this.players.length)]
    this.drawOptions()
    this.ctx.emit({ code: 'game_started', game: 'twenty', round: this.ctx.round })
    this.schedule(this.ctx.settings.setupSeconds * 1000, () => this.useEntry(this.options[0]))
    this.ctx.changed()
  }

  dispose() {
    this.cancel?.()
    this.cancelLimit?.()
  }

  private drawOptions() {
    this.options = this.ctx.pickFresh('twenty', TWENTY_BANK.filter((w) => w.enabled), OPTION_COUNT)
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

  private guessers() {
    return this.players.filter((p) => p !== this.setterId)
  }

  private useEntry(e: WordEntry) {
    this.beginAsking({ text: e.text, aliases: e.aliases, category: e.categoryId })
  }

  private beginAsking(entry: { text: string; aliases: string[]; category: string }) {
    this.entry = entry
    this.options = []
    this.stage = 'asking'
    this.order = shuffle(this.guessers(), this.ctx.random)
    this.endsAt = this.ctx.now() + GAME_LIMIT_MS
    this.cancelLimit = this.ctx.setTimer(GAME_LIMIT_MS, () => this.finish('setter', null, '제한 시간 8분이 지나 출제자가 승리했습니다.'))
    this.ctx.emit({ code: 'twenty_ready', setterName: this.name(this.setterId), category: entry.category })
    this.nextTurn()
  }

  private get turnId(): string | null {
    return this.stage === 'asking' ? (this.order[this.turnIdx] ?? null) : null
  }

  /** 다음 질문자에게 차례를 넘긴다. 접속 중인 사람을 우선하고, 아무도 없으면 순서대로 */
  private nextTurn() {
    if (this.order.length === 0) return this.finish('none', null, '질문할 참가자가 없어 중단되었습니다.')
    let idx = this.turnIdx
    for (let i = 1; i <= this.order.length; i++) {
      const cand = (this.turnIdx + i) % this.order.length
      if (this.ctx.isConnected(this.order[cand])) {
        idx = cand
        break
      }
      if (i === this.order.length) idx = (this.turnIdx + 1) % this.order.length
    }
    this.turnIdx = idx
    const id = this.order[idx]
    this.schedule(QUESTION_SECONDS * 1000, () => this.pass(id))
    this.ctx.changed()
  }

  private used() {
    return this.questions.length
  }

  /** 1회 소모 후: 횟수가 다 찼으면 출제자 승리, 아니면 다음 차례 */
  private afterUse() {
    if (this.used() >= this.ctx.settings.maxQuestions) return this.finish('setter', null, '질문 횟수를 모두 써서 출제자가 승리했습니다.')
    this.nextTurn()
  }

  private pass(id: string) {
    this.questions.push({ id: newId(), askerId: id, text: '', kind: 'pass', reply: null, correct: false })
    this.ctx.emit({ code: 'twenty_passed', name: this.name(id) })
    this.afterUse()
  }

  private finish(winner: 'guessers' | 'setter' | 'none', solverId: string | null, reason: string) {
    this.clearTimer()
    this.cancelLimit?.()
    this.cancelLimit = null
    this.stage = 'result'
    this.pendingId = null
    this.endsAt = null
    this.result = { winner, answer: this.entry.text, solverId, reason }
    this.ctx.emit({
      code: 'twenty_result',
      winner,
      answer: this.entry.text,
      solverName: solverId ? this.name(solverId) : null,
      reason,
    })
    this.ctx.finish()
    this.ctx.changed()
  }

  private applyReply(q: Question, reply: TwentyReply) {
    q.reply = reply
    this.pendingId = null
    this.ctx.emit({ code: 'twenty_replied', text: q.text, reply, kind: 'question', correct: false })
    this.afterUse()
  }

  action(playerId: string, action: GameAction): ActionResult {
    const isSetter = playerId === this.setterId
    switch (action.type) {
      case 'twenty.setup': {
        if (this.stage !== 'setup') return fail('BAD_STATE', '이미 문제가 정해졌습니다')
        if (!isSetter) return fail('FORBIDDEN', '출제자만 정할 수 있습니다')
        if (action.optionId) {
          const e = this.options.find((o) => o.id === action.optionId)
          if (!e) return fail('INVALID', '후보에 없는 정답입니다')
          this.useEntry(e)
          return ok
        }
        if (!this.ctx.settings.freeInput) return fail('FORBIDDEN', '직접 입력이 꺼져 있습니다. 후보에서 고르세요')
        if (!action.answer || !action.category) return fail('INVALID', '정답과 분류를 입력하세요')
        this.beginAsking({ text: action.answer, aliases: [], category: action.category })
        return ok
      }
      case 'twenty.reroll': {
        if (this.stage !== 'setup') return fail('BAD_STATE', '이미 문제가 정해졌습니다')
        if (!isSetter) return fail('FORBIDDEN', '출제자만 다시 뽑을 수 있습니다')
        if (this.rerollsLeft <= 0) return fail('BAD_STATE', '더 이상 다시 뽑을 수 없습니다')
        this.rerollsLeft--
        this.drawOptions()
        this.ctx.changed()
        return ok
      }
      case 'twenty.ask':
      case 'twenty.guess': {
        if (this.stage !== 'asking') return fail('BAD_STATE', '질문을 받는 중이 아닙니다')
        if (isSetter) return fail('FORBIDDEN', '출제자는 질문할 수 없습니다')
        if (this.pendingId) return fail('BAD_STATE', '앞 질문의 답변을 기다리는 중입니다')
        if (this.turnId !== playerId) return fail('FORBIDDEN', '내 질문 차례가 아닙니다')
        if (action.type === 'twenty.guess') {
          const correct = matchesAnswer(action.text, this.entry.text, this.entry.aliases)
          this.questions.push({ id: newId(), askerId: playerId, text: action.text, kind: 'guess', reply: correct ? 'yes' : 'no', correct })
          this.ctx.emit({ code: 'twenty_guessed', name: this.name(playerId), correct })
          if (correct) return this.finish('guessers', playerId, `${this.name(playerId)}님이 정답을 맞혔습니다.`), ok
          this.afterUse()
          return ok
        }
        const q: Question = { id: newId(), askerId: playerId, text: action.text, kind: 'question', reply: null, correct: false }
        this.questions.push(q)
        this.ctx.emit({ code: 'twenty_asked', name: this.name(playerId), text: q.text, kind: 'question' })
        this.pendingId = q.id
        // 출제자가 답하지 않으면 "애매함"으로 자동 처리
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

  /** 연결이 끊긴 채 유예 시간이 지남: 출제자면 중단(답을 다른 사람에게 넘기지 않음), 질문자면 차례 포기 */
  playerGone(playerId: string) {
    if (!this.players.includes(playerId) || this.stage === 'result') return
    if (playerId === this.setterId) return this.finish('none', null, '출제자의 연결이 끊겨 게임이 중단되었습니다.')
    if (this.turnId === playerId && !this.pendingId) return this.pass(playerId)
  }

  playerLeft(playerId: string) {
    if (!this.players.includes(playerId) || this.stage === 'result') return
    this.players = this.players.filter((p) => p !== playerId)
    if (playerId === this.setterId) return this.finish('none', null, '출제자가 나가 게임이 중단되었습니다.')
    if (this.players.length < 2) return this.finish('none', null, '참가 인원이 부족해 중단되었습니다.')
    const wasTurn = this.turnId === playerId
    const idx = this.order.indexOf(playerId)
    if (idx >= 0) {
      this.order.splice(idx, 1)
      if (idx <= this.turnIdx) this.turnIdx--
    }
    if (wasTurn && !this.pendingId) return this.nextTurn()
    this.ctx.changed()
  }

  view(playerId: string | null): TwentyView {
    const inGame = playerId !== null && this.players.includes(playerId)
    const isSetter = playerId === this.setterId
    const done = this.stage === 'result'
    return {
      type: 'twenty',
      round: this.ctx.round,
      stage: this.stage,
      setterId: this.setterId,
      order: this.order.slice(),
      turnId: this.turnId,
      options: isSetter && this.stage === 'setup' ? this.options.map((o) => ({ id: o.id, answer: o.text, category: o.categoryId })) : null,
      rerollsLeft: isSetter ? this.rerollsLeft : 0,
      freeInput: this.ctx.settings.freeInput,
      endsAt: this.endsAt,
      myRole: !inGame ? 'spectator' : isSetter ? 'setter' : 'guesser',
      category: this.entry.category,
      answer: isSetter ? this.entry.text || null : null,
      maxQuestions: this.ctx.settings.maxQuestions,
      // 오답 도전 내용은 도전자·출제자에게만 (불필요한 정답 후보 노출 방지)
      questions: this.questions.map((q) =>
        q.kind === 'guess' && !q.correct && !done && !isSetter && q.askerId !== playerId ? { ...q, text: '' } : { ...q },
      ),
      pendingId: this.pendingId,
      deadline: done ? null : this.deadline,
      result: this.result,
    }
  }
}
