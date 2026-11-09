import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type GameAction, type SystemEvent } from '@relay/shared'
import { BaseballGame, judge } from '../src/games/baseball/BaseballGame.js'
import { MafiaGame, mafiaCount } from '../src/games/mafia/MafiaGame.js'
import { TwentyGame } from '../src/games/twenty/TwentyGame.js'
import type { GameContext } from '../src/games/types.js'
import { pickFresh } from '../src/games/fresh.js'
import { allowedStarts, validateWordFormat, WordchainGame } from '../src/games/wordchain/WordchainGame.js'
import { FakeClock } from './fakeClock.js'

function ctx<S>(clock: FakeClock, settings: S, n: number) {
  const events: SystemEvent[] = []
  let finished = false
  const c: GameContext<S> = {
    participants: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `user${i}` })),
    settings,
    round: 1,
    now: clock.now,
    random: clock.random,
    setTimer: clock.setTimer,
    isConnected: () => true,
    emit: (e) => events.push(e),
    changed: () => {},
    finish: () => (finished = true),
    pickFresh: (_k, pool, n) => pickFresh([], pool, n, clock.random).picked,
  }
  return { c, events, isFinished: () => finished }
}
type G = { action(id: string, a: GameAction, o: { isHost: boolean }): { ok: boolean; message?: string } }
const act = (g: G, id: string, a: GameAction, isHost = false) => g.action(id, a, { isHost })

describe('MafiaGame', () => {
  function setup(n = 5) {
    const clock = new FakeClock()
    const h = ctx(clock, { ...DEFAULT_SETTINGS.mafia, discussSeconds: 10 }, n)
    const g = new MafiaGame(h.c)
    g.start()
    const ids = h.c.participants.map((p) => p.id)
    const mafia = ids.filter((id) => g.view(id).myRole === 'mafia')
    return { clock, g, h, ids, mafia, citizens: ids.filter((id) => !mafia.includes(id)) }
  }

  it('assigns mafia count by size and hides roles', () => {
    expect([mafiaCount(5), mafiaCount(7), mafiaCount(10)]).toEqual([1, 2, 3])
    const { g, mafia, citizens } = setup(7)
    expect(mafia).toHaveLength(2)
    const cv = g.view(citizens[0])
    expect(cv.team).toEqual([])
    expect(cv.result).toBeNull()
    expect(cv.nightVotes).toEqual({})
    expect(JSON.stringify(cv)).not.toMatch(/"(team|roles)":\[?"?p/)
    expect(g.view(mafia[0]).team.sort()).toEqual(mafia.sort())
    expect(g.view(null).myRole).toBe('spectator')
  })

  it('starts with day discussion, then vote → night kill → next day; vote out mafia → citizens win', () => {
    const { clock, g, mafia, citizens } = setup(5)
    expect(g.view(null).stage).toBe('day')
    expect(g.view(null).day).toBe(1)
    expect(act(g, mafia[0], { type: 'mafia.kill', targetId: citizens[0] }).ok).toBe(false) // 낮
    clock.advance(10_001)
    expect(g.view(null).stage).toBe('vote')
    for (const id of g.view(null).alive) expect(act(g, id, { type: 'mafia.vote', targetId: null }).ok).toBe(true) // 전원 기권
    expect(g.view(null).lastExecuted).toBeNull()
    expect(g.view(null).stage).toBe('night')
    expect(act(g, citizens[0], { type: 'mafia.kill', targetId: citizens[1] }).ok).toBe(false)
    expect(act(g, mafia[0], { type: 'mafia.kill', targetId: mafia[0] }).ok).toBe(false)
    act(g, mafia[0], { type: 'mafia.kill', targetId: citizens[0] })
    let v = g.view(citizens[1])
    expect(v.stage).toBe('day')
    expect(v.day).toBe(2)
    expect(v.lastKilled).toBe(citizens[0])
    expect(v.alive).not.toContain(citizens[0])
    clock.advance(10_001)
    expect(act(g, citizens[0], { type: 'mafia.vote', targetId: mafia[0] }).ok).toBe(false) // dead
    for (const id of g.view(null).alive) act(g, id, { type: 'mafia.vote', targetId: id === mafia[0] ? citizens[1] : mafia[0] })
    v = g.view(null)
    expect(v.stage).toBe('result')
    expect(v.result!.winner).toBe('citizens')
  })

  it('mafia wins when they reach parity; tie vote executes nobody', () => {
    const { clock, g, mafia, citizens } = setup(5)
    clock.advance(10_001) // 1일 낮 → 투표
    clock.advance(30_001) // 무투표 → 밤
    act(g, mafia[0], { type: 'mafia.kill', targetId: citizens[0] }) // 4 alive: 1m 3c
    clock.advance(10_001)
    const alive = g.view(null).alive
    const plan: Record<string, string> = { [mafia[0]]: citizens[1], [citizens[1]]: citizens[2], [citizens[2]]: citizens[1], [citizens[3]]: citizens[2] }
    for (const id of alive) act(g, id, { type: 'mafia.vote', targetId: plan[id] })
    expect(g.view(null).lastExecuted).toBeNull()
    expect(g.view(null).stage).toBe('night')
    act(g, mafia[0], { type: 'mafia.kill', targetId: citizens[1] }) // 1m 2c
    clock.advance(10_001)
    for (const id of g.view(null).alive) act(g, id, { type: 'mafia.vote', targetId: id === citizens[2] ? citizens[3] : citizens[2] })
    expect(g.view(null).result!.winner).toBe('mafia')
  })

  it('citizens win after the 8th day vote; dead players are "out"; gone players are removed', () => {
    const { clock, g, h, mafia, citizens } = setup(7)
    for (let d = 1; d <= 8; d++) {
      expect(g.view(null).day).toBe(d)
      clock.advance(10_001) // 토론
      clock.advance(30_001) // 투표 무응답 → 처형 없음
      if (d < 8) clock.advance(30_001) // 밤 무지목 → 사망 없음
    }
    const v = g.view(null)
    expect(v.result!.winner).toBe('citizens')
    expect(h.events.some((e) => e.code === 'mafia_night' && e.day === 8)).toBe(false)

    const s2 = setup(5)
    s2.g.playerGone!(s2.citizens[0])
    expect(s2.g.view(null).alive).not.toContain(s2.citizens[0])
    expect(s2.g.isOut!(s2.citizens[0])).toBe(true)
    expect(s2.g.isOut!(s2.citizens[1])).toBe(false)
    s2.g.playerGone!(s2.mafia[0])
    expect(s2.g.view(null).result!.winner).toBe('citizens')
    void mafia
    void citizens
  })
})

describe('WordchainGame', () => {
  it('applies 두음법칙 and validates format', () => {
    expect(allowedStarts('력')).toEqual(['력', '역'])
    expect(allowedStarts('라')).toEqual(['라', '나'])
    expect(allowedStarts('녀')).toEqual(['녀', '여'])
    expect(allowedStarts('기')).toEqual(['기'])
    expect(validateWordFormat('가')).not.toBeNull()
    expect(validateWordFormat('abc')).not.toBeNull()
    expect(validateWordFormat('ㄱㄴ')).not.toBeNull()
    expect(validateWordFormat('사과')).toBeNull()
  })

  it('enforces chain, duplicates, turns; timeout eliminates; last one wins', () => {
    const clock = new FakeClock()
    const h = ctx(clock, DEFAULT_SETTINGS.wordchain, 2)
    const g = new WordchainGame(h.c)
    g.start()
    let v = g.view()
    const cur = v.currentTurnId!
    const other = v.order.find((x) => x !== cur)!
    expect(act(g, other, { type: 'word.submit', word: v.allowed[0] + '리' }).ok).toBe(false) // not your turn
    expect(act(g, cur, { type: 'word.submit', word: v.allowed[0] + '리' }).ok).toBe(true)
    v = g.view()
    expect(v.chain.length).toBe(2)
    expect(v.challengeUntil).toBeNull() // 2명이면 이의 제기 없음
    expect(act(g, other, { type: 'word.challenge' }).ok).toBe(false)
    expect(act(g, other, { type: 'word.submit', word: v.chain[1].word }).ok).toBe(false) // 중복/연결
    clock.advance(DEFAULT_SETTINGS.wordchain.turnSeconds * 1000 + 1)
    v = g.view()
    expect(v.stage).toBe('result')
    expect(v.result!.winnerId).toBe(cur)
    expect(h.isFinished()).toBe(true)
  })

  it('challenge: majority of survivors (excluding the author) invalidates the word', () => {
    const clock = new FakeClock()
    const h = ctx(clock, DEFAULT_SETTINGS.wordchain, 4)
    const g = new WordchainGame(h.c)
    g.start()
    let v = g.view()
    const author = v.currentTurnId!
    act(g, author, { type: 'word.submit', word: v.allowed[0] + '뷁' })
    v = g.view()
    expect(v.challengeUntil).not.toBeNull()
    const next = v.currentTurnId!
    expect(act(g, author, { type: 'word.challenge' }).ok).toBe(false) // 자기 단어
    expect(act(g, next, { type: 'word.challenge' }).ok).toBe(true)
    v = g.view(next)
    expect(v.challenge!.needed).toBe(2) // 투표자 3명 → 과반 2
    expect(v.challenge!.myVote).toBe(true)
    expect(act(g, next, { type: 'word.submit', word: v.allowed[0] + '리' }).ok).toBe(false) // 투표 중
    expect(act(g, author, { type: 'word.challengeVote', agree: false }).ok).toBe(false) // 작성자 제외
    const third = v.challenge!.voters.find((x) => x !== next)!
    act(g, third, { type: 'word.challengeVote', agree: true })
    v = g.view()
    expect(v.challenge).toBeNull()
    expect(v.out).toEqual([author])
    expect(v.chain).toHaveLength(1)
    expect(h.events.some((e) => e.code === 'word_challenge_result' && e.upheld)).toBe(true)

    // 기각되면 멈췄던 차례를 이어서 진행
    v = g.view()
    const a2 = v.currentTurnId!
    act(g, a2, { type: 'word.submit', word: v.allowed[0] + '다리' })
    const n2 = g.view().currentTurnId!
    clock.advance(3_000)
    act(g, n2, { type: 'word.challenge' })
    const voter = g.view().challenge!.voters.find((x) => x !== n2)!
    act(g, voter, { type: 'word.challengeVote', agree: false })
    v = g.view()
    expect(v.challenge).toBeNull()
    expect(v.out).toEqual([author])
    expect(v.currentTurnId).toBe(n2)
    // 이의 제기 시간이 지나면 거부
    act(g, n2, { type: 'word.submit', word: v.allowed[0] + '무' })
    clock.advance(5_001)
    expect(act(g, g.view().currentTurnId!, { type: 'word.challenge' }).ok).toBe(false)
  })
})

describe('BaseballGame', () => {
  it('judges strikes and balls', () => {
    expect(judge('123', '123')).toEqual({ strike: 3, ball: 0 })
    expect(judge('123', '321')).toEqual({ strike: 1, ball: 2 })
    expect(judge('123', '456')).toEqual({ strike: 0, ball: 0 })
  })

  it('hides guesses until everyone submits, then a correct guess wins', () => {
    const clock = new FakeClock()
    const h = ctx(clock, DEFAULT_SETTINGS.baseball, 2)
    const g = new BaseballGame(h.c)
    g.start()
    expect(act(g, 'p0', { type: 'baseball.guess', guess: '112' }).ok).toBe(false) // duplicate digits
    expect(act(g, 'p0', { type: 'baseball.guess', guess: '1234' }).ok).toBe(false) // wrong length
    expect(act(g, 'p0', { type: 'baseball.guess', guess: '123' }).ok).toBe(true)
    const v1 = g.view('p1')
    expect(v1.submittedIds).toEqual(['p0'])
    expect(JSON.stringify(v1)).not.toContain('"123"')
    expect(v1.result).toBeNull()
    act(g, 'p1', { type: 'baseball.guess', guess: '456' })
    const v = g.view('p0')
    expect(v.history).toHaveLength(1)
    expect(v.turn).toBe(2)
    // brute force: p0 tries all permutations until solved (bounded by maxRounds)
    const secretKnown = (g as unknown as { secret: string }).secret
    act(g, 'p0', { type: 'baseball.guess', guess: secretKnown })
    act(g, 'p1', { type: 'baseball.guess', guess: secretKnown === '789' ? '780' : '789' })
    const r = g.view('p0')
    expect(r.result!.winners).toEqual(['p0'])
    expect(r.result!.secret).toBe(secretKnown)
  })

  it('solo play times out to a draw after max rounds', () => {
    const clock = new FakeClock()
    const h = ctx(clock, { ...DEFAULT_SETTINGS.baseball, maxRounds: 5 }, 1)
    const g = new BaseballGame(h.c)
    g.start()
    for (let i = 0; i < 5; i++) clock.advance(DEFAULT_SETTINGS.baseball.roundSeconds * 1000 + 1)
    expect(g.view('p0').result!.winners).toEqual([])
  })
})

describe('TwentyGame', () => {
  function setup(n = 3, extra: Partial<typeof DEFAULT_SETTINGS.twenty> = {}) {
    const clock = new FakeClock()
    const h = ctx(clock, { ...DEFAULT_SETTINGS.twenty, maxQuestions: 10, ...extra }, n)
    const g = new TwentyGame(h.c)
    g.start()
    const setter = g.view(null).setterId
    const guessers = h.c.participants.map((p) => p.id).filter((id) => id !== setter)
    return { clock, g, h, setter, guessers }
  }
  const turn = (g: TwentyGame) => g.view(null).turnId!

  it('setter picks from bank options; only the setter sees the answer; turn order; alias guess wins', () => {
    const { g, setter, guessers } = setup()
    expect(g.view(guessers[0]).options).toBeNull()
    const opts = g.view(setter).options!
    expect(opts).toHaveLength(3)
    expect(act(g, setter, { type: 'twenty.setup', answer: '고양이', category: '동물' }).ok).toBe(false) // 직접 입력 꺼짐
    expect(act(g, setter, { type: 'twenty.reroll' }).ok).toBe(true)
    expect(g.view(setter).rerollsLeft).toBe(1)
    const pick = g.view(setter).options![0]
    expect(act(g, guessers[0], { type: 'twenty.setup', optionId: pick.id }).ok).toBe(false)
    expect(act(g, setter, { type: 'twenty.setup', optionId: pick.id }).ok).toBe(true)
    expect(g.view(setter).answer).toBe(pick.answer)
    expect(g.view(guessers[0]).answer).toBeNull()
    expect(JSON.stringify(g.view(guessers[0]))).not.toContain(`"${pick.answer}"`)
    const t1 = turn(g)
    const t2 = guessers.find((x) => x !== t1)!
    expect(act(g, t2, { type: 'twenty.ask', text: '먹는 건가요?' }).ok).toBe(false) // 차례 아님
    expect(act(g, t1, { type: 'twenty.ask', text: '먹는 건가요?' }).ok).toBe(true)
    const qid = g.view(null).pendingId!
    act(g, setter, { type: 'twenty.reply', questionId: qid, reply: 'no' })
    expect(turn(g)).toBe(t2)
    act(g, t2, { type: 'twenty.guess', text: '틀린답' })
    // 오답 내용은 도전자·출제자만 본다
    expect(g.view(t1).questions.at(-1)!.text).toBe('')
    expect(g.view(t2).questions.at(-1)!.text).toBe('틀린답')
    expect(g.view(setter).questions.at(-1)!.text).toBe('틀린답')
    expect(turn(g)).toBe(t1)
    act(g, t1, { type: 'twenty.guess', text: ` ${pick.answer} ` })
    const r = g.view(null).result!
    expect(r.winner).toBe('guessers')
    expect(r.solverId).toBe(t1)
  })

  it('free-input answers have no aliases (exact match only)', () => {
    const { g, setter } = setup(2, { freeInput: true })
    expect(act(g, setter, { type: 'twenty.setup', answer: '자장면', category: '음식' }).ok).toBe(true)
    // 직접 입력 정답은 별칭이 없다 → 정확히 일치해야
    act(g, turn(g), { type: 'twenty.guess', text: '짜장면' })
    expect(g.view(null).stage).toBe('asking')
  })

  it('setup/question/reply time out; questions run out → setter wins', () => {
    const { clock, g } = setup()
    clock.advance(30_001) // 준비 시간 초과 → 첫 후보로 자동 출제
    expect(g.view(null).stage).toBe('asking')
    for (let i = 0; i < 5; i++) {
      act(g, turn(g), { type: 'twenty.ask', text: `q${i}` })
      clock.advance(15_001) // 답변 시간 초과 → 애매함
    }
    for (let i = 0; i < 5; i++) clock.advance(20_001) // 질문 시간 초과 → 포기(1회 차감)
    const v = g.view(null)
    expect(v.result!.winner).toBe('setter')
    expect(v.questions.filter((q) => q.kind === 'question').every((q) => q.reply === 'maybe')).toBe(true)
    expect(v.questions.filter((q) => q.kind === 'pass')).toHaveLength(5)
  })

  it('8-minute limit → setter wins; setter gone → aborted', () => {
    const a = setup(3, { maxQuestions: 30 })
    a.clock.advance(30_001)
    for (let t = 0; t < 8 * 60_000; t += 20_000) a.clock.advance(20_000)
    a.clock.advance(1_000)
    expect(a.g.view(null).result!.winner).toBe('setter')
    const b = setup(3)
    b.clock.advance(30_001)
    b.g.playerGone!(b.setter)
    expect(b.g.view(null).result!.winner).toBe('none')
  })
})
