import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type GameAction, type SystemEvent } from '@relay/shared'
import { BaseballGame, judge } from '../src/games/baseball/BaseballGame.js'
import { MafiaGame, mafiaCount } from '../src/games/mafia/MafiaGame.js'
import { TwentyGame } from '../src/games/twenty/TwentyGame.js'
import type { GameContext } from '../src/games/types.js'
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

  it('night kill → day → vote out mafia → citizens win', () => {
    const { clock, g, mafia, citizens } = setup(5)
    expect(act(g, citizens[0], { type: 'mafia.kill', targetId: citizens[1] }).ok).toBe(false)
    expect(act(g, mafia[0], { type: 'mafia.kill', targetId: mafia[0] }).ok).toBe(false)
    act(g, mafia[0], { type: 'mafia.kill', targetId: citizens[0] })
    let v = g.view(citizens[1])
    expect(v.stage).toBe('day')
    expect(v.lastKilled).toBe(citizens[0])
    expect(v.alive).not.toContain(citizens[0])
    clock.advance(10_001)
    expect(g.view(null).stage).toBe('vote')
    expect(act(g, citizens[0], { type: 'mafia.vote', targetId: mafia[0] }).ok).toBe(false) // dead
    for (const id of g.view(null).alive) act(g, id, { type: 'mafia.vote', targetId: id === mafia[0] ? citizens[1] : mafia[0] })
    v = g.view(null)
    expect(v.stage).toBe('result')
    expect(v.result!.winner).toBe('citizens')
  })

  it('mafia wins when they reach parity; tie vote executes nobody', () => {
    const { clock, g, mafia, citizens } = setup(5)
    act(g, mafia[0], { type: 'mafia.kill', targetId: citizens[0] }) // 4 alive: 1m 3c
    clock.advance(10_001)
    const alive = g.view(null).alive
    // 2-2 tie between citizens[1] and citizens[2]
    const plan: Record<string, string> = { [mafia[0]]: citizens[1], [citizens[1]]: citizens[2], [citizens[2]]: citizens[1], [citizens[3]]: citizens[2] }
    for (const id of alive) act(g, id, { type: 'mafia.vote', targetId: plan[id] })
    expect(g.view(null).lastExecuted).toBeNull()
    expect(g.view(null).stage).toBe('night')
    act(g, mafia[0], { type: 'mafia.kill', targetId: citizens[1] }) // 1m 2c
    clock.advance(10_001)
    for (const id of g.view(null).alive) act(g, id, { type: 'mafia.vote', targetId: id === citizens[2] ? citizens[3] : citizens[2] })
    expect(g.view(null).result!.winner).toBe('mafia')
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
    const h = ctx(clock, DEFAULT_SETTINGS.wordchain, 3)
    const g = new WordchainGame(h.c)
    g.start()
    let v = g.view()
    const first = v.chain[0].word
    const cur = v.currentTurnId!
    const other = v.order.find((x) => x !== cur)!
    expect(act(g, other, { type: 'word.submit', word: first.at(-1) + '가' }).ok).toBe(false) // not your turn
    expect(act(g, cur, { type: 'word.submit', word: '가나다' }).ok).toBe(v.allowed.includes('가'))
    v = g.view()
    if (v.currentTurnId === cur) {
      const w = v.allowed[0] + '리'
      expect(act(g, cur, { type: 'word.submit', word: w }).ok).toBe(true)
      v = g.view()
    }
    expect(v.chain.length).toBe(2)
    const dup = v.chain[1].word
    // duplicate check only applies if it would chain; just check host reject
    expect(act(g, v.currentTurnId!, { type: 'word.reject' }, false).ok).toBe(false)
    expect(act(g, v.currentTurnId!, { type: 'word.reject' }, true).ok).toBe(true)
    v = g.view()
    expect(v.out).toHaveLength(1)
    expect(v.chain.map((c) => c.word)).not.toContain(dup)
    // remaining 2: time out one of them
    clock.advance(DEFAULT_SETTINGS.wordchain.turnSeconds * 1000 + 1)
    v = g.view()
    expect(v.stage).toBe('result')
    expect(v.result!.winnerId).toBeTruthy()
    expect(h.isFinished()).toBe(true)
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
  function setup(n = 3) {
    const clock = new FakeClock()
    const h = ctx(clock, { maxQuestions: 10 }, n)
    const g = new TwentyGame(h.c)
    g.start()
    const setter = g.view(null).setterId
    const guessers = h.c.participants.map((p) => p.id).filter((id) => id !== setter)
    return { clock, g, setter, guessers }
  }

  it('only the setter sees the answer; guessers ask, setter replies, correct guess wins', () => {
    const { g, setter, guessers } = setup()
    expect(act(g, guessers[0], { type: 'twenty.setup', answer: 'x', category: 'y' }).ok).toBe(false)
    act(g, setter, { type: 'twenty.setup', answer: '고양이', category: '동물' })
    expect(g.view(setter).answer).toBe('고양이')
    expect(g.view(guessers[0]).answer).toBeNull()
    expect(JSON.stringify(g.view(guessers[0]))).not.toContain('고양이')
    expect(act(g, setter, { type: 'twenty.ask', text: '?' }).ok).toBe(false)
    expect(act(g, guessers[0], { type: 'twenty.ask', text: '동물인가요?' }).ok).toBe(true)
    expect(act(g, guessers[1], { type: 'twenty.ask', text: '다리 4개?' }).ok).toBe(false) // pending
    const qid = g.view(null).pendingId!
    expect(act(g, guessers[0], { type: 'twenty.reply', questionId: qid, reply: 'yes' }).ok).toBe(false)
    act(g, setter, { type: 'twenty.reply', questionId: qid, reply: 'yes' })
    act(g, guessers[1], { type: 'twenty.guess', text: '강아지' })
    expect(g.view(null).stage).toBe('asking')
    act(g, guessers[1], { type: 'twenty.guess', text: '고 양 이' })
    const r = g.view(null).result!
    expect(r.winner).toBe('guessers')
    expect(r.solverId).toBe(guessers[1])
  })

  it('setter wins when questions run out; setup and reply time out automatically', () => {
    const { clock, g, guessers } = setup()
    clock.advance(60_001) // setup timeout → fallback answer
    expect(g.view(null).stage).toBe('asking')
    for (let i = 0; i < 10; i++) {
      act(g, guessers[i % 2], { type: 'twenty.ask', text: `q${i}` })
      clock.advance(60_001) // reply timeout → maybe
    }
    const r = g.view(null).result!
    expect(r.winner).toBe('setter')
    expect(g.view(null).questions.every((q) => q.reply === 'maybe')).toBe(true)
  })
})
