import type { GameAction, WordchainSettings, WordchainView } from '@relay/shared'
import { START_WORDS } from '../../content/index.js'
import { fail, ok, shuffle, type ActionResult, type GameContext, type GameEngine } from '../types.js'

/**
 * 끝말잇기.
 * 간편 모드: 내장 사전이 없어 "완성형 한글 2~8자 · 끝 글자 일치 · 중복 금지"만 서버가 검사한다.
 * 실제 단어가 아니면 3명 이상일 때 직전 단어에 이의를 제기해 생존자 과반 찬성으로 무효(낸 사람 탈락) 처리한다.
 */
export { START_WORDS }

/** 단어가 나온 뒤 이의 제기를 받는 시간 */
export const CHALLENGE_WINDOW_MS = 5_000
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
  /** 직전 단어에 이의를 제기할 수 있는 마감 시각 */
  private challengeUntil: number | null = null
  private challenge: {
    byId: string
    authorId: string
    word: string
    voters: string[]
    votes: Map<string, boolean>
    deadline: number
    /** 투표 동안 멈춘 차례의 남은 시간 */
    pausedMs: number
    cancel: () => void
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
    this.cancel?.()
    this.challenge?.cancel()
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

  private setTurnTimer(ms: number) {
    const id = this.order[this.turn]
    this.cancel?.()
    this.deadline = this.ctx.now() + ms
    this.cancel = this.ctx.setTimer(ms, () => {
      this.cancel = null
      this.eliminate(id, 'timeout')
    })
  }

  private beginTurn(index: number) {
    const alive = this.alive()
    if (alive.length <= 1) return this.finish(alive[0] ?? null)
    this.turn = ((index % this.order.length) + this.order.length) % this.order.length
    while (this.out.includes(this.order[this.turn])) this.turn = (this.turn + 1) % this.order.length
    this.setTurnTimer(this.ctx.settings.turnSeconds * 1000)
    this.ctx.changed()
  }

  private eliminate(id: string, reason: 'timeout' | 'rejected' | 'left') {
    if (this.out.includes(id)) return
    this.out.push(id)
    this.ctx.emit({ code: 'word_out', name: this.name(id), reason })
    if (this.challenge && (this.challenge.authorId === id || this.alive().length < 3)) this.cancelChallenge()
    if (this.challengeUntil && this.alive().length < 3) this.challengeUntil = null
    const idx = this.order.indexOf(id)
    this.beginTurn(idx + 1)
  }

  private finish(winnerId: string | null) {
    this.cancel?.()
    this.challenge?.cancel()
    this.challenge = null
    this.challengeUntil = null
    this.stage = 'result'
    this.deadline = null
    this.result = { winnerId }
    this.ctx.emit({ code: 'word_result', winnerName: winnerId ? this.name(winnerId) : null, length: this.chain.length - 1 })
    this.ctx.finish()
    this.ctx.changed()
  }

  /* ── 이의 제기 ── */

  private needed(voters: number) {
    return Math.floor(voters / 2) + 1
  }

  private startChallenge(byId: string) {
    const last = this.chain[this.chain.length - 1]
    const authorId = last.playerId!
    const voters = this.alive().filter((id) => id !== authorId)
    // 차례 타이머를 멈춘다
    const pausedMs = Math.max(0, (this.deadline ?? this.ctx.now()) - this.ctx.now())
    this.cancel?.()
    this.cancel = null
    this.challengeUntil = null
    const deadline = this.ctx.now() + CHALLENGE_VOTE_MS
    this.challenge = {
      byId,
      authorId,
      word: last.word,
      voters,
      votes: new Map([[byId, true]]),
      deadline,
      pausedMs,
      cancel: this.ctx.setTimer(CHALLENGE_VOTE_MS, () => this.resolveChallenge()),
    }
    this.deadline = deadline
    this.ctx.emit({ code: 'word_challenge', by: this.name(byId), word: last.word, author: this.name(authorId), seconds: CHALLENGE_VOTE_MS / 1000 })
    this.checkChallenge()
  }

  private checkChallenge() {
    const c = this.challenge
    if (!c) return
    const yes = [...c.votes.values()].filter(Boolean).length
    const pending = c.voters.filter((v) => !c.votes.has(v) && this.ctx.isConnected(v) && !this.out.includes(v)).length
    const need = this.needed(c.voters.length)
    if (yes >= need || yes + pending < need || pending === 0) return this.resolveChallenge()
    this.ctx.changed()
  }

  private cancelChallenge() {
    const c = this.challenge
    if (!c) return
    c.cancel()
    this.challenge = null
  }

  private resolveChallenge() {
    const c = this.challenge
    if (!c) return
    c.cancel()
    this.challenge = null
    const yes = [...c.votes.values()].filter(Boolean).length
    const need = this.needed(c.voters.length)
    const upheld = yes >= need
    this.ctx.emit({ code: 'word_challenge_result', word: c.word, upheld, yes, needed: need })
    if (upheld) {
      this.chain.pop()
      return this.eliminate(c.authorId, 'rejected')
    }
    // 기각: 멈췄던 차례를 이어서 (최소 5초)
    this.setTurnTimer(Math.max(5_000, c.pausedMs))
    this.ctx.changed()
  }

  /* ── actions ── */

  action(playerId: string, action: GameAction): ActionResult {
    if (this.stage !== 'turn') return fail('BAD_STATE', '진행 중이 아닙니다')
    const alive = this.alive().includes(playerId)
    if (action.type === 'word.submit') {
      if (this.challenge) return fail('BAD_STATE', '이의 제기 투표가 끝난 뒤 입력하세요')
      if (this.order[this.turn] !== playerId) return fail('FORBIDDEN', '내 차례가 아닙니다')
      const word = action.word.normalize('NFC').replace(/\s+/g, '')
      const bad = validateWordFormat(word)
      if (bad) return fail('INVALID', bad)
      const allowed = this.allowed()
      if (!allowed.includes(word[0])) return fail('INVALID', `'${allowed.join("' 또는 '")}'(으)로 시작해야 합니다`)
      if (this.chain.some((c) => c.word === word)) return fail('INVALID', '이미 나온 단어입니다')
      this.chain.push({ playerId, word })
      this.ctx.emit({ code: 'word_played', name: this.name(playerId), word })
      this.challengeUntil = this.alive().length >= 3 ? this.ctx.now() + CHALLENGE_WINDOW_MS : null
      this.beginTurn(this.turn + 1)
      return ok
    }
    if (action.type === 'word.challenge') {
      const last = this.chain[this.chain.length - 1]
      if (!alive) return fail('FORBIDDEN', '생존한 참가자만 이의를 제기할 수 있습니다')
      if (this.challenge) return fail('BAD_STATE', '이미 투표 중입니다')
      if (!last.playerId || this.challengeUntil === null || this.ctx.now() > this.challengeUntil)
        return fail('BAD_STATE', '이의 제기 시간이 지났습니다')
      if (last.playerId === playerId) return fail('FORBIDDEN', '내가 낸 단어에는 이의를 제기할 수 없습니다')
      if (this.alive().length < 3) return fail('BAD_STATE', '3명 이상일 때만 이의를 제기할 수 있습니다')
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
    if (this.order[this.turn] === playerId && !this.challenge) return this.eliminate(playerId, 'left')
    this.out.push(playerId)
    this.ctx.emit({ code: 'word_out', name: this.name(playerId), reason: 'left' })
    if (this.alive().length <= 1) return this.finish(this.alive()[0] ?? null)
    if (this.challenge) {
      if (this.challenge.authorId === playerId || this.alive().length < 3) {
        const paused = this.challenge.pausedMs
        this.cancelChallenge()
        if (this.order[this.turn] === playerId) return this.beginTurn(this.turn + 1)
        this.setTurnTimer(Math.max(5_000, paused))
      } else this.checkChallenge()
    }
    if (this.order[this.turn] === playerId) return this.beginTurn(this.turn + 1)
    this.ctx.changed()
  }

  playerLeft(playerId: string) {
    this.playerGone(playerId)
  }

  view(playerId: string | null = null): WordchainView {
    const c = this.challenge
    return {
      type: 'wordchain',
      round: this.ctx.round,
      stage: this.stage,
      order: this.order.slice(),
      out: this.out.slice(),
      currentTurnId: this.stage === 'turn' ? this.order[this.turn] : null,
      chain: this.chain.slice(),
      allowed: this.allowed(),
      deadline: this.stage === 'turn' ? this.deadline : null,
      challengeUntil: this.stage === 'turn' && !c ? this.challengeUntil : null,
      challenge: c
        ? {
            byId: c.byId,
            authorId: c.authorId,
            word: c.word,
            voters: c.voters.slice(),
            votedIds: [...c.votes.keys()],
            myVote: playerId ? c.votes.get(playerId) : undefined,
            needed: this.needed(c.voters.length),
            deadline: c.deadline,
          }
        : null,
      result: this.result,
    }
  }
}
