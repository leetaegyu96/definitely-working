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
    expect(g.view(null).stage).toBe('night') // 전원 일치 → 2초 확정 대기
    clock.advance(2_001)
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
    clock.advance(2_001)
    clock.advance(10_001)
    const alive = g.view(null).alive
    const plan: Record<string, string> = { [mafia[0]]: citizens[1], [citizens[1]]: citizens[2], [citizens[2]]: citizens[1], [citizens[3]]: citizens[2] }
    for (const id of alive) act(g, id, { type: 'mafia.vote', targetId: plan[id] })
    expect(g.view(null).lastExecuted).toBeNull()
    expect(g.view(null).stage).toBe('night')
    act(g, mafia[0], { type: 'mafia.kill', targetId: citizens[1] }) // 1m 2c
    clock.advance(2_001)
    clock.advance(10_001)
    for (const id of g.view(null).alive) act(g, id, { type: 'mafia.vote', targetId: id === citizens[2] ? citizens[3] : citizens[2] })
    expect(g.view(null).result!.winner).toBe('mafia')
  })

  it('8일째 투표까지 승부가 안 나면 무승부; dead players are "out"; gone players are removed', () => {
    const { clock, g, h, mafia, citizens } = setup(7)
    for (let d = 1; d <= 8; d++) {
      expect(g.view(null).day).toBe(d)
      clock.advance(10_001) // 토론
      clock.advance(30_001) // 투표 무응답 → 처형 없음
      if (d < 8) clock.advance(30_001) // 밤 무지목 → 사망 없음
    }
    const v = g.view(null)
    expect(v.result!.winner).toBe('draw')
    expect(h.events.some((e) => e.code === 'mafia_night' && e.day === 8)).toBe(false)

    const s2 = setup(5)
    s2.g.playerGone!(s2.citizens[0])
    expect(s2.g.view(null).alive).not.toContain(s2.citizens[0])
    expect(s2.g.isOut!(s2.citizens[0])).toBe(true)
    expect(s2.g.isOut!(s2.citizens[1])).toBe(false)
    s2.g.playerGone!(s2.mafia[0])
    expect(s2.g.view(null).result!.winner).toBe('citizens')
    expect(s2.g.view(null).result!.reason).toContain('이탈')
    void mafia
    void citizens
  })
})

describe('MafiaGame night confirm', () => {
  it('전원 일치 후 2초 안에 지목을 바꾸면 확정이 취소되고 원래 밤 마감으로 돌아간다', () => {
    const clock = new FakeClock()
    const h = ctx(clock, { ...DEFAULT_SETTINGS.mafia, discussSeconds: 0 }, 7)
    const g = new MafiaGame(h.c)
    g.start()
    const ids = h.c.participants.map((p) => p.id)
    const mafia = ids.filter((id) => g.view(id).myRole === 'mafia')
    const cit = ids.filter((id) => !mafia.includes(id))
    clock.advance(30_001) // 무투표 → 밤
    expect(g.view(null).stage).toBe('night')
    const nightEnd = g.view(null).deadline!
    act(g, mafia[0], { type: 'mafia.kill', targetId: cit[0] })
    act(g, mafia[1], { type: 'mafia.kill', targetId: cit[0] })
    expect(g.view(null).deadline).toBeLessThan(nightEnd)
    clock.advance(1_000)
    act(g, mafia[1], { type: 'mafia.kill', targetId: cit[1] }) // 바꿈 → 확정 취소
    expect(g.view(null).deadline).toBe(nightEnd)
    clock.advance(1_500)
    expect(g.view(null).stage).toBe('night')
    act(g, mafia[1], { type: 'mafia.kill', targetId: cit[0] })
    clock.advance(2_001)
    expect(g.view(null).alive).not.toContain(cit[0])
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
    // 이의 제기 대기 중에는 다음 차례가 시작되지 않는다
    expect(v.currentTurnId).toBeNull()
    const next = v.nextTurnId!
    expect(act(g, next, { type: 'word.submit', word: v.allowed[0] + '리' }).ok).toBe(false)
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
    expect(v.currentTurnId).toBe(next)
    expect(h.events.some((e) => e.code === 'word_challenge_result' && e.upheld)).toBe(true)

    // 기각되면 미뤄 둔 다음 차례가 제한 시간 전체로 시작
    const a2 = v.currentTurnId!
    act(g, a2, { type: 'word.submit', word: v.allowed[0] + '다리' })
    const n2 = g.view().nextTurnId!
    clock.advance(3_000)
    act(g, n2, { type: 'word.challenge' })
    const voter = g.view().challenge!.voters.find((x) => x !== n2)!
    act(g, voter, { type: 'word.challengeVote', agree: false })
    v = g.view()
    expect(v.challenge).toBeNull()
    expect(v.out).toEqual([author])
    expect(v.currentTurnId).toBe(n2)
    expect(v.deadline).toBe(clock.now() + DEFAULT_SETTINGS.wordchain.turnSeconds * 1000)
    // 이의 제기 시간이 지나면 거부되고 다음 차례가 시작
    act(g, n2, { type: 'word.submit', word: v.allowed[0] + '무' })
    clock.advance(5_001)
    v = g.view()
    expect(v.challengeUntil).toBeNull()
    expect(v.currentTurnId).not.toBeNull()
    expect(act(g, v.currentTurnId!, { type: 'word.challenge' }).ok).toBe(false)
  })

  it('challenge majority: 3/4/5 survivors, voter leaving shrinks the denominator; challengeSeconds 0 disables', () => {
    for (const [n, need] of [[3, 2], [4, 2], [5, 3]] as const) {
      const clock = new FakeClock()
      const h = ctx(clock, DEFAULT_SETTINGS.wordchain, n)
      const g = new WordchainGame(h.c)
      g.start()
      const author = g.view().currentTurnId!
      act(g, author, { type: 'word.submit', word: g.view().allowed[0] + '뷁' })
      const by = g.view().nextTurnId!
      act(g, by, { type: 'word.challenge' })
      // 투표자 = 생존자 - 작성자 = n-1명, 과반 = floor((n-1)/2)+1
      expect(g.view().challenge!.needed, `n=${n}`).toBe(need)
    }
    // 5명: 투표자 4명(과반 3) 중 2명이 이탈하면 남은 2명 기준 과반 2
    const clock = new FakeClock()
    const h = ctx(clock, DEFAULT_SETTINGS.wordchain, 5)
    const g = new WordchainGame(h.c)
    g.start()
    const author = g.view().currentTurnId!
    act(g, author, { type: 'word.submit', word: g.view().allowed[0] + '뷁' })
    const by = g.view().nextTurnId!
    act(g, by, { type: 'word.challenge' })
    const others = g.view().challenge!.voters.filter((x) => x !== by)
    g.playerGone!(others[0])
    expect(g.view().challenge!.needed).toBe(2)
    g.playerGone!(others[1]) // 생존 3명: 판정 가능, 남은 투표자 by + others[2]
    expect(g.view().challenge!.voters).toHaveLength(2)
    act(g, others[2], { type: 'word.challengeVote', agree: true })
    expect(g.view().out).toContain(author)

    const c2 = new FakeClock()
    const h2 = ctx(c2, { ...DEFAULT_SETTINGS.wordchain, challengeSeconds: 0 }, 4)
    const g2 = new WordchainGame(h2.c)
    g2.start()
    act(g2, g2.view().currentTurnId!, { type: 'word.submit', word: g2.view().allowed[0] + '뷁' })
    expect(g2.view().challengeUntil).toBeNull()
    expect(g2.view().currentTurnId).not.toBeNull()
  })
})

describe('BaseballGame', () => {
  it('leading zero: 012 stays a string and wins; 001 is rejected; guesses hidden until resolve', () => {
    const clock = new FakeClock()
    const h = ctx(clock, DEFAULT_SETTINGS.baseball, 2)
    const g = new BaseballGame(h.c)
    g.start()
    ;(g as unknown as { secret: string }).secret = '012'
    const [p1, p2] = h.c.participants.map((p) => p.id)
    expect(act(g, p1, { type: 'baseball.guess', guess: '001' }).ok).toBe(false)
    expect(act(g, p1, { type: 'baseball.guess', guess: '012' }).ok).toBe(true)
    expect(JSON.stringify(g.view(p2))).not.toContain('012')
    act(g, p2, { type: 'baseball.guess', guess: '210' })
    const v = g.view(null)
    expect(v.result!.winners).toEqual([p1])
    expect(v.result!.secret).toBe('012')
    expect(v.history[0].entries.find((e) => e.playerId === p2)).toMatchObject({ strike: 1, ball: 2 })
  })

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

  it('passes use up questions → setter wins; reply timeout is free (same asker), 3 timeouts → aborted', () => {
    const { clock, g } = setup(3, { maxQuestions: 10 })
    clock.advance(30_001) // 준비 시간 초과 → 첫 후보로 자동 출제
    expect(g.view(null).stage).toBe('asking')
    for (let i = 0; i < 10; i++) clock.advance(20_001) // 질문 시간 초과 → 포기(1회 차감)
    let v = g.view(null)
    expect(v.result!.winner).toBe('setter')
    expect(v.questions.filter((q) => q.kind === 'pass')).toHaveLength(10)

    const b = setup(3)
    b.clock.advance(30_001)
    const asker = turn(b.g)
    act(b.g, asker, { type: 'twenty.ask', text: 'q1' })
    b.clock.advance(15_001) // 무응답 → 애매함, 횟수 안 씀, 같은 사람이 다시
    v = b.g.view(null)
    expect(v.questions[0].reply).toBe('maybe')
    expect(v.questions[0].free).toBe(true)
    expect(turn(b.g)).toBe(asker)
    act(b.g, asker, { type: 'twenty.ask', text: 'q2' })
    b.clock.advance(15_001)
    act(b.g, turn(b.g), { type: 'twenty.ask', text: 'q3' })
    b.clock.advance(15_001)
    v = b.g.view(null)
    expect(v.result!.winner).toBe('none')
    expect(v.result!.reason).toContain('답하지 않아')
  })

  it("'애매함' is limited to 2 per game and does not use a question", () => {
    const { g, setter, guessers } = setup(3)
    expect(act(g, setter, { type: 'twenty.setup', optionId: g.view(setter).options![0].id }).ok).toBe(true)
    const ask = () => {
      const t = turn(g)
      act(g, t, { type: 'twenty.ask', text: '질문' })
      return { t, qid: g.view(null).pendingId! }
    }
    let q = ask()
    expect(act(g, setter, { type: 'twenty.reply', questionId: q.qid, reply: 'maybe' }).ok).toBe(true)
    expect(turn(g)).toBe(q.t) // 같은 사람이 고쳐서 다시 질문
    q = ask()
    expect(act(g, setter, { type: 'twenty.reply', questionId: q.qid, reply: 'maybe' }).ok).toBe(true)
    expect(g.view(setter).maybeLeft).toBe(0)
    q = ask()
    expect(act(g, setter, { type: 'twenty.reply', questionId: q.qid, reply: 'maybe' }).ok).toBe(false)
    expect(act(g, setter, { type: 'twenty.reply', questionId: q.qid, reply: 'yes' }).ok).toBe(true)
    expect(turn(g)).not.toBe(q.t)
    const used = g.view(null).questions.filter((x) => !x.free).length
    expect(used).toBe(1)
    void guessers
  })

  it('options come from different categories and a reroll shows new ones', () => {
    const { g, setter } = setup(3)
    const first = g.view(setter).options!
    expect(new Set(first.map((o) => o.category)).size).toBe(3)
    act(g, setter, { type: 'twenty.reroll' })
    const second = g.view(setter).options!
    expect(new Set(second.map((o) => o.category)).size).toBe(3)
    expect(second.some((o) => first.some((f) => f.id === o.id))).toBe(false)
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
