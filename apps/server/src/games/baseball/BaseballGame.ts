import type { BaseballSettings, BaseballView, GameAction } from '@relay/shared'
import { fail, ok, shuffle, type ActionResult, type GameContext, type GameEngine } from '../types.js'

/**
 * 숫자 야구 — 동시 제출 방식.
 * 매 턴 모든 참여자가 추측을 제출하고, 전원 제출(또는 시간 만료) 시 한꺼번에 판정·공개한다.
 * 같은 턴에 정답을 맞힌 사람은 모두 공동 승리. 최대 턴까지 아무도 못 맞히면 무승부.
 */
export function judge(secret: string, guess: string) {
  let strike = 0
  let ball = 0
  for (let i = 0; i < guess.length; i++) {
    if (guess[i] === secret[i]) strike++
    else if (secret.includes(guess[i])) ball++
  }
  return { strike, ball }
}

export class BaseballGame implements GameEngine {
  readonly type = 'baseball' as const
  private stage: 'guess' | 'result' = 'guess'
  private secret = ''
  private turn = 1
  private participants: string[] = []
  private guesses = new Map<string, string>()
  private history: BaseballView['history'] = []
  deadline: number | null = null
  private result: BaseballView['result'] = null
  private cancel: (() => void) | null = null

  constructor(private ctx: GameContext<BaseballSettings>) {}

  start() {
    const d = this.ctx.settings.digits
    this.secret = shuffle(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'], this.ctx.random).slice(0, d).join('')
    this.participants = this.ctx.participants.map((p) => p.id)
    this.ctx.emit({ code: 'game_started', game: 'baseball', round: this.ctx.round })
    this.beginTurn()
  }

  dispose() {
    this.cancel?.()
  }

  private name(id: string) {
    return this.ctx.participants.find((p) => p.id === id)?.name ?? '알 수 없음'
  }

  private beginTurn() {
    this.stage = 'guess'
    this.guesses.clear()
    this.cancel?.()
    const ms = this.ctx.settings.roundSeconds * 1000
    this.deadline = this.ctx.now() + ms
    this.cancel = this.ctx.setTimer(ms, () => {
      this.cancel = null
      this.resolveTurn()
    })
    this.ctx.changed()
  }

  private resolveTurn() {
    this.cancel?.()
    const entries = this.participants
      .filter((id) => this.guesses.has(id))
      .map((id) => ({ playerId: id, guess: this.guesses.get(id)!, ...judge(this.secret, this.guesses.get(id)!) }))
    this.history.push({ turn: this.turn, entries })
    this.ctx.emit({
      code: 'baseball_round',
      round: this.turn,
      results: entries.map((e) => ({ name: this.name(e.playerId), guess: e.guess, strike: e.strike, ball: e.ball })),
    })
    const winners = entries.filter((e) => e.strike === this.secret.length).map((e) => e.playerId)
    if (winners.length || this.turn >= this.ctx.settings.maxRounds || this.participants.length === 0) return this.finish(winners)
    this.turn++
    this.beginTurn()
  }

  private finish(winners: string[]) {
    this.cancel?.()
    this.stage = 'result'
    this.deadline = null
    this.result = { winners, secret: this.secret }
    this.ctx.emit({ code: 'baseball_result', winners: winners.map((w) => this.name(w)), secret: this.secret })
    this.ctx.finish()
    this.ctx.changed()
  }

  action(playerId: string, action: GameAction): ActionResult {
    if (action.type !== 'baseball.guess') return fail('INVALID', '지원하지 않는 동작입니다')
    if (this.stage !== 'guess') return fail('BAD_STATE', '제출을 받는 중이 아닙니다')
    if (!this.participants.includes(playerId)) return fail('FORBIDDEN', '참여자만 제출할 수 있습니다')
    if (this.guesses.has(playerId)) return fail('BAD_STATE', '이번 턴에 이미 제출했습니다')
    const g = action.guess
    if (g.length !== this.secret.length) return fail('INVALID', `${this.secret.length}자리 숫자를 입력하세요`)
    if (new Set(g).size !== g.length) return fail('INVALID', '서로 다른 숫자로만 입력하세요')
    if (this.history.some((h) => h.entries.some((e) => e.playerId === playerId && e.guess === g)))
      return fail('INVALID', '이미 냈던 숫자입니다')
    this.guesses.set(playerId, g)
    if (this.participants.every((id) => this.guesses.has(id) || !this.ctx.isConnected(id))) this.resolveTurn()
    else this.ctx.changed()
    return ok
  }

  playerGone() {
    if (this.stage === 'guess' && this.participants.every((id) => this.guesses.has(id) || !this.ctx.isConnected(id))) this.resolveTurn()
  }

  playerLeft(playerId: string) {
    if (!this.participants.includes(playerId) || this.stage === 'result') return
    this.participants = this.participants.filter((p) => p !== playerId)
    this.guesses.delete(playerId)
    if (this.participants.length === 0) return this.finish([])
    if (this.participants.every((id) => this.guesses.has(id) || !this.ctx.isConnected(id))) return this.resolveTurn()
    this.ctx.changed()
  }

  view(playerId: string | null): BaseballView {
    return {
      type: 'baseball',
      round: this.ctx.round,
      stage: this.stage,
      digits: this.secret.length,
      turn: this.turn,
      maxTurns: this.ctx.settings.maxRounds,
      participants: this.participants.slice(),
      deadline: this.stage === 'guess' ? this.deadline : null,
      submittedIds: this.stage === 'guess' ? [...this.guesses.keys()] : [],
      myGuess: playerId && this.stage === 'guess' ? (this.guesses.get(playerId) ?? null) : null,
      history: this.history.slice(),
      result: this.result,
    }
  }
}
