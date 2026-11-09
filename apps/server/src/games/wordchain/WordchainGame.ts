import type { GameAction, WordchainSettings, WordchainView } from '@relay/shared'
import { START_WORDS } from '../../content/index.js'
import { fail, ok, shuffle, type ActionResult, type GameContext, type GameEngine } from '../types.js'

/**
 * 끝말잇기.
 * 간편 모드: 내장 사전이 없어 "완성형 한글 2~8자 · 끝 글자 일치 · 중복 금지"만 서버가 검사한다.
 * 3명 이상이면 단어가 나온 뒤 이의 제기 대기 시간(기본 5초)을 두고, 그동안 다음 차례는 시작하지 않는다.
 * 이의가 들어오면 낸 사람을 뺀 생존자 투표(10초)로 과반 찬성 시 무효·탈락, 아니면 다음 차례 시작.
 * 2명일 때는 판정할 제3자가 없어 이의 제기가 없다 (연습용).
 */
export { START_WORDS }

/** 이의 제기 투표 시간 */
export const CHALLENGE_VOTE_MS = 10_000

const HANGUL_BASE = 0xac00
const JUNG = 21
const JONG = 28
const CHO_N = 2 // ㄴ
const CHO_R = 5 // ㄹ
const CHO_O = 11 // ㅇ
// 중성 인덱스: ㅑ2 ㅕ6 ㅖ7 ㅛ12 ㅠ17 ㅣ20
const IOTIZED = new Set([2, 6, 7, 12, 17, 20])

const isHangulSyllable = (ch: string) => {
  const c = ch.charCodeAt(0)
  return c >= HANGUL_BASE && c <= 0xd7a3
}

/** 두음법칙 적용한 시작 가능 글자 */
export function allowedStarts(lastChar: string): string[] {
  if (!isHangulSyllable(lastChar)) return [lastChar]
  const code = lastChar.charCodeAt(0) - HANGUL_BASE
  const cho = Math.floor(code / (JUNG * JONG))
  const jung = Math.floor((code % (JUNG * JONG)) / JONG)
  const jong = code % JONG
  const make = (c: number) => String.fromCharCode(HANGUL_BASE + (c * JUNG + jung) * JONG + jong)
  const out = [lastChar]
  if (cho === CHO_R) out.push(make(IOTIZED.has(jung) ? CHO_O : CHO_N))
  else if (cho === CHO_N && IOTIZED.has(jung)) out.push(make(CHO_O))
  return out
}

export function validateWordFormat(word: string): string | null {
  if (word.length < 2 || word.length > 8) return '2~8글자 단어만 쓸 수 있습니다'
  if (![...word].every(isHangulSyllable)) return '완성된 한글 글자만 쓸 수 있습니다'
  return null
}

export class WordchainGame implements GameEngine {
  readonly type = 'wordchain' as const
  private stage: 'turn' | 'result' = 'turn'
  private order: string[] = []
  private out: string[] = []
  private turn = 0
  private chain: { playerId: string | null; word: string }[] = []
  deadline: number | null = null
  private result: WordchainView['result'] = null
  private cancel: (() => void) | null = null
  /** 이의 제기 대기 중이면 다음 차례 인덱스 (대기·투표가 끝나야 그 차례가 시작된다) */
  private reviewNext: number | null = null
  /** 직전 단어에 이의를 제기할 수 있는 마감 시각 */
  private challengeUntil: number | null = null
  private challenge: {
    byId: string
    authorId: string
    word: string
    voters: string[]
    votes: Map<string, boolean>
    deadline: number
  } | null = null

  constructor(private ctx: GameContext<WordchainSettings>) {}

  start() {
    this.order = shuffle(
      this.ctx.participants.map((p) => p.id),
      this.ctx.random,
    )
    const first = this.ctx.pickFresh('wordchain:start', START_WORDS.map((w) => ({ id: w })), 1)[0].id
    this.chain.push({ playerId: null, word: first })
    this.ctx.emit({ code: 'game_started', game: 'wordchain', round: this.ctx.round })
    this.ctx.emit({ code: 'word_played', name: '시작 단어', word: first })
    this.beginTurn(0)
  }

  dispose() {
    this.clearTimer()
  }

  private name(id: string | null) {
    return id ? (this.ctx.participants.find((p) => p.id === id)?.name ?? '알 수 없음') : ''
  }

  private alive() {
    return this.order.filter((id) => !this.out.includes(id))
  }

  private allowed() {
    const last = this.chain[this.chain.length - 1].word
    return allowedStarts(last[last.length - 1])
  }

  private clearTimer() {
    this.cancel?.()
    this.cancel = null
  }

  private schedule(ms: number, fn: () => void) {
    this.clearTimer()
    this.deadline = this.ctx.now() + ms
    this.cancel = this.ctx.setTimer(ms, () => {
      this.cancel = null
      fn()
    })
  }

  /** index부터 살아 있는 첫 사람의 인덱스 */
  private nextAlive(index: number) {
    let i = ((index % this.order.length) + this.order.length) % this.order.length
    for (let n = 0; n < this.order.length && this.out.includes(this.order[i]); n++) i = (i + 1) % this.order.length
    return i
  }

  private beginTurn(index: number) {
    this.reviewNext = null
    this.challengeUntil = null
    const alive = this.alive()
    if (alive.length <= 1) return this.finish(alive[0] ?? null)
    this.turn = this.nextAlive(index)
    const id = this.order[this.turn]
    this.schedule(this.ctx.settings.turnSeconds * 1000, () => this.eliminate(id, 'timeout'))
    this.ctx.changed()
  }

  /** 단어가 나온 뒤: 3명 이상이면 이의 제기 대기, 아니면 바로 다음 차례 */
  private afterWord(next: number) {
    const ms = this.ctx.settings.challengeSeconds * 1000
    if (this.alive().length < 3 || ms <= 0) return this.beginTurn(next)
    this.reviewNext = next
    this.challengeUntil = this.ctx.now() + ms
    this.schedule(ms, () => this.beginTurn(next))
    this.ctx.changed()
  }

  /** 이의 제기 대기·투표를 끝내고 미뤄 둔 차례를 시작 */
  private endReview() {
    const next = this.reviewNext ?? this.turn + 1
    this.challenge = null
    this.beginTurn(next)
  }

  private eliminate(id: string, reason: 'timeout' | 'rejected' | 'left') {
    if (this.out.includes(id)) return
    this.out.push(id)
    this.ctx.emit({ code: 'word_out', name: this.name(id), reason })
    this.beginTurn(this.order.indexOf(id) + 1)
  }

  private finish(winnerId: string | null) {
    this.clearTimer()
    this.challenge = null
    this.challengeUntil = null
    this.reviewNext = null
    this.stage = 'result'
    this.deadline = null
    this.result = { winnerId }
    this.ctx.emit({ code: 'word_result', winnerName: winnerId ? this.name(winnerId) : null, length: this.chain.length - 1 })
    this.ctx.finish()
    this.ctx.changed()
  }

  /* ── 이의 제기 ── */

  /** 과반 기준: 투표 시작 때 정한 투표자 중 아직 탈락·이탈하지 않은 사람 */
  private eligible() {
    const c = this.challenge
    return c ? c.voters.filter((v) => !this.out.includes(v)) : []
  }

  private tallyChallenge() {
    const c = this.challenge!
    const eligible = this.eligible()
    const yes = eligible.filter((v) => c.votes.get(v) === true).length
    return { eligible, yes, need: Math.floor(eligible.length / 2) + 1 }
  }

  private startChallenge(byId: string) {
    const last = this.chain[this.chain.length - 1]
    const authorId = last.playerId!
    const deadline = this.ctx.now() + CHALLENGE_VOTE_MS
    this.challengeUntil = null
    this.challenge = {
      byId,
      authorId,
      word: last.word,
      voters: this.alive().filter((id) => id !== authorId),
      votes: new Map([[byId, true]]),
      deadline,
    }
    this.schedule(CHALLENGE_VOTE_MS, () => this.resolveChallenge())
    this.ctx.emit({ code: 'word_challenge', by: this.name(byId), word: last.word, author: this.name(authorId), seconds: CHALLENGE_VOTE_MS / 1000 })
    this.checkChallenge()
  }

  private checkChallenge() {
    const c = this.challenge
    if (!c) return
    const { eligible, yes, need } = this.tallyChallenge()
    const pending = eligible.filter((v) => !c.votes.has(v) && this.ctx.isConnected(v)).length
    if (yes >= need || yes + pending < need || pending === 0) return this.resolveChallenge()
    this.ctx.changed()
  }

  private resolveChallenge() {
    const c = this.challenge
    if (!c) return
    const { yes, need } = this.tallyChallenge()
    this.challenge = null
    const upheld = yes >= need
    this.ctx.emit({ code: 'word_challenge_result', word: c.word, upheld, yes, needed: need })
    if (upheld) {
      this.chain.pop()
      this.reviewNext = null
      return this.eliminate(c.authorId, 'rejected')
    }
    this.endReview()
  }

  /* ── actions ── */

  action(playerId: string, action: GameAction): ActionResult {
    if (this.stage !== 'turn') return fail('BAD_STATE', '진행 중이 아닙니다')
    const alive = this.alive().includes(playerId)
    if (action.type === 'word.submit') {
      if (this.challenge) return fail('BAD_STATE', '이의 제기 투표가 끝난 뒤 입력하세요')
      if (this.reviewNext !== null) return fail('BAD_STATE', '이의 제기 확인이 끝나면 다음 차례가 시작됩니다')
      if (this.order[this.turn] !== playerId) return fail('FORBIDDEN', '내 차례가 아닙니다')
      const word = action.word.normalize('NFC').replace(/\s+/g, '')
      const bad = validateWordFormat(word)
      if (bad) return fail('INVALID', bad)
      const allowed = this.allowed()
      if (!allowed.includes(word[0])) return fail('INVALID', `'${allowed.join("' 또는 '")}'(으)로 시작해야 합니다`)
      if (this.chain.some((c) => c.word === word)) return fail('INVALID', '이미 나온 단어입니다')
      this.chain.push({ playerId, word })
      this.ctx.emit({ code: 'word_played', name: this.name(playerId), word })
      this.afterWord(this.turn + 1)
      return ok
    }
    if (action.type === 'word.challenge') {
      const last = this.chain[this.chain.length - 1]
      if (!alive) return fail('FORBIDDEN', '생존한 참가자만 이의를 제기할 수 있습니다')
      if (this.challenge) return fail('BAD_STATE', '이미 투표 중입니다')
      if (this.alive().length < 3) return fail('BAD_STATE', '3명 이상일 때만 이의를 제기할 수 있습니다')
      if (!last.playerId || this.reviewNext === null || this.challengeUntil === null || this.ctx.now() > this.challengeUntil)
        return fail('BAD_STATE', '이의 제기 시간이 지났습니다')
      if (last.playerId === playerId) return fail('FORBIDDEN', '내가 낸 단어에는 이의를 제기할 수 없습니다')
      this.startChallenge(playerId)
      return ok
    }
    if (action.type === 'word.challengeVote') {
      const c = this.challenge
      if (!c) return fail('BAD_STATE', '진행 중인 이의 제기 투표가 없습니다')
      if (!c.voters.includes(playerId) || !alive) return fail('FORBIDDEN', '투표 대상이 아닙니다')
      if (c.votes.has(playerId)) return fail('BAD_STATE', '이미 투표했습니다')
      c.votes.set(playerId, action.agree)
      this.checkChallenge()
      return ok
    }
    return fail('INVALID', '지원하지 않는 동작입니다')
  }

  isOut(playerId: string) {
    return this.out.includes(playerId) && this.stage !== 'result'
  }

  /** 연결이 끊긴 채 유예 시간이 지나면 탈락 */
  playerGone(playerId: string) {
    if (!this.order.includes(playerId) || this.stage === 'result' || this.out.includes(playerId)) return
    const inReview = this.reviewNext !== null || this.challenge !== null
    if (!inReview && this.order[this.turn] === playerId) return this.eliminate(playerId, 'left')
    this.out.push(playerId)
    this.ctx.emit({ code: 'word_out', name: this.name(playerId), reason: 'left' })
    if (this.alive().length <= 1) return this.finish(this.alive()[0] ?? null)
    if (this.challenge) {
      // 이의 대상 단어를 낸 사람이 나갔거나 판정할 인원이 부족하면 투표를 접고 진행
      if (this.challenge.authorId === playerId || this.alive().length < 3) return this.endReview()
      return this.checkChallenge()
    }
    if (this.reviewNext !== null && this.alive().length < 3) return this.endReview()
    this.ctx.changed()
  }

  playerLeft(playerId: string) {
    this.playerGone(playerId)
  }

  view(playerId: string | null = null): WordchainView {
    const c = this.challenge
    const playing = this.stage === 'turn'
    const waiting = this.reviewNext !== null || c !== null
    return {
      type: 'wordchain',
      round: this.ctx.round,
      stage: this.stage,
      order: this.order.slice(),
      out: this.out.slice(),
      currentTurnId: playing && !waiting ? this.order[this.turn] : null,
      nextTurnId: playing && waiting ? this.order[this.nextAlive(this.reviewNext ?? this.turn + 1)] : null,
      chain: this.chain.slice(),
      allowed: this.allowed(),
      deadline: playing ? this.deadline : null,
      challengeUntil: playing && !c ? this.challengeUntil : null,
      challenge: c
        ? {
            byId: c.byId,
            authorId: c.authorId,
            word: c.word,
            voters: this.eligible(),
            votedIds: [...c.votes.keys()],
            myVote: playerId ? c.votes.get(playerId) : undefined,
            needed: this.tallyChallenge().need,
            deadline: c.deadline,
          }
        : null,
      result: this.result,
    }
  }
}
