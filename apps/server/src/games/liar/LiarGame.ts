import {
  LIAR_CATEGORIES,
  LIAR_CATEGORY_LABEL,
  type GameAction,
  type LiarCategory,
  type LiarSettings,
  type LiarStage,
  type LiarView,
} from '@relay/shared'
import { fail, ok, shuffle, type ActionResult, type GameContext, type GameEngine } from '../types.js'
import { LIAR_WORDS } from './words.js'

const VOTE_SECONDS = 45
const GUESS_SECONDS = 30
const OFFLINE_TURN_MS = 8_000

export function normalizeWord(s: string): string {
  return s.replace(/\s+/g, '').toLowerCase()
}

export class LiarGame implements GameEngine {
  readonly type = 'liar' as const
  private stage: LiarStage = 'describe'
  private order: string[] = []
  private liarId = ''
  private category: Exclude<LiarCategory, 'random'> = 'food'
  private word = ''
  private turnIndex = 0
  private descriptions: LiarView['descriptions'] = []
  private deadline: number | null = null
  private revote = false
  private candidates: string[] = []
  private votes = new Map<string, string>()
  private accusedId: string | null = null
  private result: LiarView['result'] = null
  private cancelTimer: (() => void) | null = null

  constructor(private ctx: GameContext<LiarSettings>) {}

  /* ── lifecycle ── */

  start() {
    const r = this.ctx.random
    const cats = LIAR_CATEGORIES.filter((c) => c !== 'random') as Exclude<LiarCategory, 'random'>[]
    this.category = this.ctx.settings.category === 'random' ? cats[Math.floor(r() * cats.length)] : this.ctx.settings.category
    const words = LIAR_WORDS[this.category]
    this.word = words[Math.floor(r() * words.length)]
    this.order = shuffle(
      this.ctx.participants.map((p) => p.id),
      r,
    )
    this.liarId = this.order[Math.floor(r() * this.order.length)]
    this.ctx.emit({ code: 'game_started', game: 'liar', round: this.ctx.round })
    this.beginTurn(0)
  }

  dispose() {
    this.clearTimer()
  }

  /* ── helpers ── */

  private name(id: string) {
    return this.ctx.participants.find((p) => p.id === id)?.name ?? '알 수 없음'
  }

  private clearTimer() {
    this.cancelTimer?.()
    this.cancelTimer = null
  }

  private schedule(ms: number, fn: () => void) {
    this.clearTimer()
    this.deadline = this.ctx.now() + ms
    this.cancelTimer = this.ctx.setTimer(ms, () => {
      this.cancelTimer = null
      fn()
    })
  }

  /* ── stages ── */

  private beginTurn(index: number) {
    this.stage = 'describe'
    this.turnIndex = index
    if (index >= this.order.length) return this.beginDiscussion()
    const id = this.order[index]
    const ms = this.ctx.isConnected(id) ? this.ctx.settings.describeSeconds * 1000 : OFFLINE_TURN_MS
    this.ctx.emit({ code: 'liar_turn', name: this.name(id) })
    this.schedule(ms, () => this.recordDescription(id, '(시간 초과)', true))
    this.ctx.changed()
  }

  private recordDescription(id: string, text: string, timedOut: boolean) {
    this.descriptions.push({ playerId: id, text, timedOut })
    this.ctx.emit({ code: 'liar_described', name: this.name(id), text, timedOut })
    this.beginTurn(this.turnIndex + 1)
  }

  private beginDiscussion() {
    const secs = this.ctx.settings.discussSeconds
    if (secs <= 0) return this.beginVote(false, this.order.slice())
    this.stage = 'discuss'
    this.ctx.emit({ code: 'liar_discuss', seconds: secs })
    this.schedule(secs * 1000, () => this.beginVote(false, this.order.slice()))
    this.ctx.changed()
  }

  private beginVote(revote: boolean, candidates: string[]) {
    this.stage = 'vote'
    this.revote = revote
    this.candidates = candidates
    this.votes.clear()
    this.ctx.emit({ code: 'liar_vote_open', revote, candidates: candidates.map((c) => this.name(c)) })
    this.schedule(VOTE_SECONDS * 1000, () => this.tally())
    this.ctx.changed()
  }

  /** 투표 가능한 사람 = 참가자 전원 (본인이 후보여도 자신에게는 투표 불가) */
  private voters() {
    return this.order
  }

  private tally() {
    this.clearTimer()
    const counts = new Map<string, number>()
    for (const t of this.votes.values()) counts.set(t, (counts.get(t) ?? 0) + 1)
    let max = 0
    for (const c of this.candidates) max = Math.max(max, counts.get(c) ?? 0)
    const top = this.candidates.filter((c) => (counts.get(c) ?? 0) === max)

    if (max === 0 || top.length > 1) {
      if (!this.revote) return this.beginVote(true, max === 0 ? this.candidates : top)
      return this.finishRound('none', '재투표에서도 동률이 발생해 이번 라운드는 무효 처리되었습니다.')
    }

    this.accusedId = top[0]
    this.ctx.emit({ code: 'liar_accused', name: this.name(top[0]), votes: max })
    if (this.accusedId !== this.liarId) {
      return this.finishRound('liar', `${this.name(this.accusedId)}님은 라이어가 아니었습니다.`)
    }
    this.stage = 'guess'
    this.ctx.emit({ code: 'liar_guess_open', name: this.name(this.liarId) })
    this.schedule(GUESS_SECONDS * 1000, () => this.finishRound('citizens', '라이어가 제한 시간 안에 키워드를 제출하지 못했습니다.'))
    this.ctx.changed()
  }

  private finishRound(winner: 'liar' | 'citizens' | 'none', reason: string, guess: string | null = null) {
    this.clearTimer()
    this.stage = 'result'
    this.deadline = null
    this.result = {
      winner,
      liarId: this.liarId,
      word: this.word,
      guess,
      reason,
      votes: Object.fromEntries(this.votes),
    }
    this.ctx.emit({ code: 'liar_result', winner, liarName: this.name(this.liarId), word: this.word, guess, reason })
    this.ctx.finish()
    this.ctx.changed()
  }

  /* ── actions ── */

  action(playerId: string, action: GameAction, opts: { isHost: boolean }): ActionResult {
    const isParticipant = this.order.includes(playerId)
    switch (action.type) {
      case 'liar.describe': {
        if (this.stage !== 'describe') return fail('BAD_STATE', '설명 단계가 아닙니다')
        if (this.order[this.turnIndex] !== playerId) return fail('FORBIDDEN', '내 차례가 아닙니다')
        this.recordDescription(playerId, action.text, false)
        return ok
      }
      case 'liar.skipDiscussion': {
        if (this.stage !== 'discuss') return fail('BAD_STATE', '토론 단계가 아닙니다')
        if (!opts.isHost) return fail('FORBIDDEN', '세션 호스트만 진행할 수 있습니다')
        this.beginVote(false, this.order.slice())
        return ok
      }
      case 'liar.vote': {
        if (this.stage !== 'vote') return fail('BAD_STATE', '투표 단계가 아닙니다')
        if (!isParticipant) return fail('FORBIDDEN', '참가자만 투표할 수 있습니다')
        if (action.targetId === playerId) return fail('INVALID', '자기 자신에게는 투표할 수 없습니다')
        if (!this.candidates.includes(action.targetId)) return fail('INVALID', '투표 대상이 아닙니다')
        if (this.votes.has(playerId)) return fail('BAD_STATE', '이미 투표했습니다')
        this.votes.set(playerId, action.targetId)
        const pending = this.voters().filter((v) => !this.votes.has(v) && this.ctx.isConnected(v) && this.canVote(v))
        if (pending.length === 0) this.tally()
        else this.ctx.changed()
        return ok
      }
      case 'liar.guess': {
        if (this.stage !== 'guess') return fail('BAD_STATE', '키워드 추측 단계가 아닙니다')
        if (playerId !== this.liarId) return fail('FORBIDDEN', '라이어만 제출할 수 있습니다')
        const correct = normalizeWord(action.word) === normalizeWord(this.word)
        if (correct) this.finishRound('liar', '라이어가 키워드를 맞혔습니다.', action.word)
        else this.finishRound('citizens', '라이어가 키워드를 맞히지 못했습니다.', action.word)
        return ok
      }
      default:
        return fail('INVALID', '지원하지 않는 동작입니다')
    }
  }

  /** 후보가 본인 하나뿐이면 투표할 대상이 없다 */
  private canVote(id: string) {
    return this.candidates.some((c) => c !== id)
  }

  playerLeft(playerId: string) {
    if (!this.order.includes(playerId) || this.stage === 'result') return
    if (playerId === this.liarId) return this.finishRound('none', '라이어가 세션을 나가 라운드가 종료되었습니다.')
    const wasCurrent = this.stage === 'describe' && this.order[this.turnIndex] === playerId
    const idx = this.order.indexOf(playerId)
    this.order.splice(idx, 1)
    this.candidates = this.candidates.filter((c) => c !== playerId)
    this.votes.delete(playerId)
    for (const [k, v] of this.votes) if (v === playerId) this.votes.delete(k)
    if (this.order.length < 3) return this.finishRound('none', '참가 인원이 3명 미만이 되어 라운드가 종료되었습니다.')
    if (this.stage === 'describe') {
      if (idx < this.turnIndex) this.turnIndex--
      if (wasCurrent) return this.beginTurn(this.turnIndex)
    }
    if (this.stage === 'vote') {
      if (this.candidates.length === 0) return this.beginVote(this.revote, this.order.slice())
      const pending = this.order.filter((v) => !this.votes.has(v) && this.ctx.isConnected(v) && this.canVote(v))
      if (pending.length === 0) return this.tally()
    }
    this.ctx.changed()
  }

  /* ── view ── */

  view(playerId: string | null): LiarView {
    const inGame = playerId !== null && this.order.includes(playerId)
    const isLiar = inGame && playerId === this.liarId
    return {
      type: 'liar',
      round: this.ctx.round,
      stage: this.stage,
      category: LIAR_CATEGORY_LABEL[this.category],
      myRole: !inGame ? 'spectator' : isLiar ? 'liar' : 'citizen',
      word: inGame && !isLiar ? this.word : null,
      order: this.order.slice(),
      currentTurnId: this.stage === 'describe' ? (this.order[this.turnIndex] ?? null) : null,
      descriptions: this.descriptions.slice(),
      deadline: this.stage === 'result' ? null : this.deadline,
      revote: this.revote,
      candidates: this.stage === 'vote' ? this.candidates.slice() : [],
      votedIds: this.stage === 'vote' ? [...this.votes.keys()] : [],
      myVote: playerId && this.stage === 'vote' ? (this.votes.get(playerId) ?? null) : null,
      accusedId: this.accusedId,
      result: this.result,
    }
  }
}
