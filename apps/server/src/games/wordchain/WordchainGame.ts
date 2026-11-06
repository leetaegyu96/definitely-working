import type { GameAction, WordchainSettings, WordchainView } from '@relay/shared'
import { fail, ok, shuffle, type ActionResult, type GameContext, type GameEngine } from '../types.js'

/**
 * 끝말잇기.
 * 검증 한계: 내장 사전이 없어 "완성형 한글 2~8자 · 끝 글자 일치 · 중복 금지"만 서버가 검사한다.
 * 실제 단어가 아닌 경우 호스트가 직전 단어를 무효 처리(탈락)할 수 있다.
 */
export const START_WORDS = ['기차', '사과', '바다', '나무', '하늘', '구름', '연필', '시계', '노트북', '자전거', '도서관', '고양이', '컴퓨터', '우산', '김밥', '라디오']

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
  private deadline: number | null = null
  private result: WordchainView['result'] = null
  private cancel: (() => void) | null = null

  constructor(private ctx: GameContext<WordchainSettings>) {}

  start() {
    this.order = shuffle(
      this.ctx.participants.map((p) => p.id),
      this.ctx.random,
    )
    const first = START_WORDS[Math.floor(this.ctx.random() * START_WORDS.length)]
    this.chain.push({ playerId: null, word: first })
    this.ctx.emit({ code: 'game_started', game: 'wordchain', round: this.ctx.round })
    this.ctx.emit({ code: 'word_played', name: '시작 단어', word: first })
    this.beginTurn(0)
  }

  dispose() {
    this.cancel?.()
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

  private beginTurn(index: number) {
    const alive = this.alive()
    if (alive.length <= 1) return this.finish(alive[0] ?? null)
    this.turn = ((index % this.order.length) + this.order.length) % this.order.length
    while (this.out.includes(this.order[this.turn])) this.turn = (this.turn + 1) % this.order.length
    const id = this.order[this.turn]
    const secs = this.ctx.isConnected(id) ? this.ctx.settings.turnSeconds : 5
    this.cancel?.()
    this.deadline = this.ctx.now() + secs * 1000
    this.cancel = this.ctx.setTimer(secs * 1000, () => {
      this.cancel = null
      this.eliminate(id, 'timeout')
    })
    this.ctx.changed()
  }

  private eliminate(id: string, reason: 'timeout' | 'rejected' | 'left') {
    if (this.out.includes(id)) return
    this.out.push(id)
    this.ctx.emit({ code: 'word_out', name: this.name(id), reason })
    const idx = this.order.indexOf(id)
    this.beginTurn(idx + 1)
  }

  private finish(winnerId: string | null) {
    this.cancel?.()
    this.stage = 'result'
    this.deadline = null
    this.result = { winnerId }
    this.ctx.emit({ code: 'word_result', winnerName: winnerId ? this.name(winnerId) : null, length: this.chain.length - 1 })
    this.ctx.finish()
    this.ctx.changed()
  }

  action(playerId: string, action: GameAction, opts: { isHost: boolean }): ActionResult {
    if (this.stage !== 'turn') return fail('BAD_STATE', '진행 중이 아닙니다')
    if (action.type === 'word.submit') {
      if (this.order[this.turn] !== playerId) return fail('FORBIDDEN', '내 차례가 아닙니다')
      const word = action.word.replace(/\s+/g, '')
      const bad = validateWordFormat(word)
      if (bad) return fail('INVALID', bad)
      const allowed = this.allowed()
      if (!allowed.includes(word[0])) return fail('INVALID', `'${allowed.join("' 또는 '")}'(으)로 시작해야 합니다`)
      if (this.chain.some((c) => c.word === word)) return fail('INVALID', '이미 나온 단어입니다')
      this.chain.push({ playerId, word })
      this.ctx.emit({ code: 'word_played', name: this.name(playerId), word })
      this.beginTurn(this.turn + 1)
      return ok
    }
    if (action.type === 'word.reject') {
      if (!opts.isHost) return fail('FORBIDDEN', '세션 호스트만 무효 처리할 수 있습니다')
      const last = this.chain[this.chain.length - 1]
      if (!last.playerId) return fail('BAD_STATE', '무효 처리할 단어가 없습니다')
      this.chain.pop()
      this.eliminate(last.playerId, 'rejected')
      return ok
    }
    return fail('INVALID', '지원하지 않는 동작입니다')
  }

  playerLeft(playerId: string) {
    if (!this.order.includes(playerId) || this.stage === 'result') return
    if (this.order[this.turn] === playerId) return this.eliminate(playerId, 'left')
    if (!this.out.includes(playerId)) {
      this.out.push(playerId)
      this.ctx.emit({ code: 'word_out', name: this.name(playerId), reason: 'left' })
    }
    if (this.alive().length <= 1) return this.finish(this.alive()[0] ?? null)
    this.ctx.changed()
  }

  view(): WordchainView {
    const last = this.chain[this.chain.length - 1]
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
      canReject: this.stage === 'turn' && !!last.playerId,
      result: this.result,
    }
  }
}
