import {
  LIAR_CATEGORIES,
  LIAR_CATEGORY_LABEL,
  type GameAction,
  type LiarCategory,
  type LiarSettings,
  type LiarStage,
  type LiarView,
} from '@relay/shared'
import { LIAR_WORDS, matchesAnswer, normalizeAnswer, type WordEntry } from '../../content/index.js'
import { fail, ok, shuffle, type ActionResult, type GameContext, type GameEngine } from '../types.js'

export const VOTE_SECONDS = 30
export const REVOTE_SECONDS = 20
export const GUESS_SECONDS = 20
const OFFLINE_TURN_MS = 8_000

/** @deprecated normalizeAnswer 사용 */
export const normalizeWord = normalizeAnswer

type Cat = Exclude<LiarCategory, 'random'>

export class LiarGame implements GameEngine {
  readonly type = 'liar' as const
  private stage: LiarStage = 'describe'
  private order: string[] = []
  private liarId = ''
  private category: Cat = 'food'
  private entry: WordEntry = LIAR_WORDS[0]
  private turnIndex = 0
  private descriptions: LiarView['descriptions'] = []
  deadline: number | null = null
  private revote = false
  private candidates: string[] = []
  /** null = 기권 */
  private votes = new Map<string, string | null>()
  private accusedId: string | null = null
  private result: LiarView['result'] = null
  private cancelTimer: (() => void) | null = null

  constructor(private ctx: GameContext<LiarSettings>) {}

  private get word() {
    return this.entry.text
  }

  /* ── lifecycle ── */

  start() {
    const r = this.ctx.random
    const cats = LIAR_CATEGORIES.filter((c) => c !== 'random') as Cat[]
    this.category = this.ctx.settings.category === 'random' ? cats[Math.floor(r() * cats.length)] : this.ctx.settings.category
    const pool = LIAR_WORDS.filter((w) => w.enabled && w.categoryId === this.category)
    this.entry = this.ctx.pickFresh(`liar:${this.category}`, pool, 1)[0]
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
    this.schedule((revote ? REVOTE_SECONDS : VOTE_SECONDS) * 1000, () => this.tally())
    this.ctx.changed()
  }

  /** 아직 투표하지 않았고, 접속 중이며, 투표할 대상이 있는 사람 */
  private pendingVoters() {
    return this.order.filter((v) => !this.votes.has(v) && this.ctx.isConnected(v) && this.canVote(v))
  }

  private tally() {
    this.clearTimer()
    const counts = new Map<string, number>()
    for (const t of this.votes.values()) if (t) counts.set(t, (counts.get(t) ?? 0) + 1)
    let max = 0
    for (const c of this.candidates) max = Math.max(max, counts.get(c) ?? 0)
    const top = this.candidates.filter((c) => (counts.get(c) ?? 0) === max)
    if (max === 0) {
      // 전원 기권(또는 무응답) → 시민이 라이어를 특정하지 못함
      this.ctx.emit({ code: 'liar_no_accused', revote: this.revote })
      return this.finishRound('liar', '아무도 지목되지 않아 라이어가 승리했습니다.')
    }
    if (top.length > 1) {
      if (!this.revote) return this.beginVote(true, top)
      this.ctx.emit({ code: 'liar_no_accused', revote: true })
      return this.finishRound('liar', '결선 투표도 동률이라 라이어를 특정하지 못했습니다.')
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
        if (this.votes.has(playerId)) return fail('BAD_STATE', '이미 투표했습니다')
        const t = action.targetId
        if (t !== null) {
          if (t === playerId) return fail('INVALID', '자기 자신에게는 투표할 수 없습니다')
          if (!this.candidates.includes(t)) return fail('INVALID', '투표 대상이 아닙니다')
        }
        this.votes.set(playerId, t)
        if (this.pendingVoters().length === 0) this.tally()
        else this.ctx.changed()
        return ok
      }
      case 'liar.guess': {
        if (this.stage !== 'guess') return fail('BAD_STATE', '키워드 추측 단계가 아닙니다')
        if (playerId !== this.liarId) return fail('FORBIDDEN', '라이어만 제출할 수 있습니다')
        if (matchesAnswer(action.word, this.word, this.entry.aliases))
          this.finishRound('liar', '라이어가 키워드를 맞혔습니다.', action.word)
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

  /** 연결이 끊긴 채 유예 시간이 지남: 지금 설명 차례면 바로 넘기고, 투표 대기에서 제외 */
  playerGone(playerId: string) {
    if (!this.order.includes(playerId) || this.stage === 'result') return
    if (this.stage === 'describe' && this.order[this.turnIndex] === playerId) {
      return this.recordDescription(playerId, '(응답 없음)', true)
    }
    if (this.stage === 'vote' && this.pendingVoters().length === 0) return this.tally()
    this.ctx.changed()
  }

  playerLeft(playerId: string) {
    if (!this.order.includes(playerId) || this.stage === 'result') return
    if (playerId === this.liarId) return this.finishRound('none', '라이어가 세션을 나가 라운드가 중단되었습니다.')
    const wasCurrent = this.stage === 'describe' && this.order[this.turnIndex] === playerId
    const idx = this.order.indexOf(playerId)
    this.order.splice(idx, 1)
    this.candidates = this.candidates.filter((c) => c !== playerId)
    this.votes.delete(playerId)
    for (const [k, v] of this.votes) if (v === playerId) this.votes.delete(k)
    if (this.order.length < 3) return this.finishRound('none', '참가 인원이 3명 미만이 되어 라운드가 중단되었습니다.')
    if (this.stage === 'describe') {
      if (idx < this.turnIndex) this.turnIndex--
      if (wasCurrent) return this.beginTurn(this.turnIndex)
    }
    if (this.stage === 'vote') {
      if (this.candidates.length === 0) return this.beginVote(this.revote, this.order.slice())
      if (this.pendingVoters().length === 0) return this.tally()
    }
    this.ctx.changed()
  }

  /* ── view ── */

  view(playerId: string | null): LiarView {
    const inGame = playerId !== null && this.order.includes(playerId)
    const isLiar = inGame && playerId === this.liarId
    const voted = playerId && this.stage === 'vote' && this.votes.has(playerId)
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
      myVote: voted ? this.votes.get(playerId!)! : undefined,
      accusedId: this.accusedId,
      result: this.result,
    }
  }
}
