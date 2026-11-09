import { describe, expect, it } from 'vitest'
import type { GameAction, LiarView, QuizView, SystemEvent } from '@relay/shared'
import { DEFAULT_SETTINGS } from '@relay/shared'
import { LiarGame } from '../src/games/liar/LiarGame.js'
import { QuizGame } from '../src/games/quiz/QuizGame.js'
import type { GameContext } from '../src/games/types.js'
import { pickFresh } from '../src/games/fresh.js'
import { FakeClock } from './fakeClock.js'

function ctx<S>(clock: FakeClock, settings: S, n: number, offline: string[] = []) {
  const events: SystemEvent[] = []
  let finished = false
  const c: GameContext<S> = {
    participants: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `user${i}` })),
    settings,
    round: 1,
    now: clock.now,
    random: clock.random,
    setTimer: clock.setTimer,
    isConnected: (id) => !offline.includes(id),
    emit: (e) => events.push(e),
    changed: () => {},
    finish: () => (finished = true),
    pickFresh: (_k, pool, n) => pickFresh([], pool, n, clock.random).picked,
  }
  return { c, events, isFinished: () => finished }
}

const act = (g: { action: (id: string, a: GameAction, o: { isHost: boolean }) => unknown }, id: string, a: GameAction, isHost = false) =>
  g.action(id, a, { isHost }) as { ok: boolean; message?: string }

function liarSetup(n = 4) {
  const clock = new FakeClock()
  const h = ctx(clock, { ...DEFAULT_SETTINGS.liar, discussSeconds: 10 }, n)
  const g = new LiarGame(h.c)
  g.start()
  const anyView = g.view('p0')
  const liarId = anyView.order.find((id) => g.view(id).myRole === 'liar')!
  return { clock, g, h, liarId }
}

function describeAll(g: LiarGame) {
  for (;;) {
    const v = g.view(null)
    if (v.stage !== 'describe') break
    expect(act(g, v.currentTurnId!, { type: 'liar.describe', text: 'hint' }).ok).toBe(true)
  }
}

describe('LiarGame', () => {
  it('sends the word only to citizens, never to the liar or spectators', () => {
    const { g, liarId } = liarSetup(5)
    const word = g.view(g.view(null).order.find((id) => id !== liarId)!).word
    expect(word).toBeTruthy()
    expect(g.view(liarId).word).toBeNull()
    expect(g.view(liarId).myRole).toBe('liar')
    expect(g.view(null).word).toBeNull()
    expect(g.view(null).myRole).toBe('spectator')
    expect(JSON.stringify(g.view(liarId))).not.toContain(word!)
    expect(JSON.stringify(g.view(null))).not.toContain(word!)
  })

  it('enforces turn order and times out silent players', () => {
    const { clock, g } = liarSetup(3)
    const v = g.view(null)
    const notCurrent = v.order.find((id) => id !== v.currentTurnId)!
    expect(act(g, notCurrent, { type: 'liar.describe', text: 'x' }).ok).toBe(false)
    clock.advance(DEFAULT_SETTINGS.liar.describeSeconds * 1000 + 1)
    expect(g.view(null).descriptions[0]).toMatchObject({ playerId: v.order[0], timedOut: true })
    expect(g.view(null).currentTurnId).toBe(v.order[1])
  })

  it('citizens win when the liar is caught and guesses wrong', () => {
    const { clock, g, liarId } = liarSetup(4)
    describeAll(g)
    expect(g.view(null).stage).toBe('discuss')
    expect(act(g, 'p0', { type: 'liar.skipDiscussion' }, false).ok).toBe(false)
    clock.advance(10_001)
    expect(g.view(null).stage).toBe('vote')
    const order = g.view(null).order
    expect(act(g, liarId, { type: 'liar.vote', targetId: liarId }).ok).toBe(false) // self vote
    for (const id of order) {
      const target = id === liarId ? order.find((x) => x !== liarId)! : liarId
      expect(act(g, id, { type: 'liar.vote', targetId: target }).ok).toBe(true)
    }
    expect(g.view(null).stage).toBe('guess')
    expect(act(g, order.find((x) => x !== liarId)!, { type: 'liar.guess', word: 'a' }).ok).toBe(false)
    act(g, liarId, { type: 'liar.guess', word: '틀린답' })
    const r = g.view(null).result!
    expect(r.winner).toBe('citizens')
    expect(r.liarId).toBe(liarId)
  })

  it('liar wins by guessing the word (whitespace/case-insensitive)', () => {
    const { g, liarId } = liarSetup(3)
    describeAll(g)
    act(g, 'p0', { type: 'liar.skipDiscussion' }, true)
    const order = g.view(null).order
    for (const id of order) act(g, id, { type: 'liar.vote', targetId: id === liarId ? order.find((x) => x !== liarId)! : liarId })
    const word = g.view(order.find((x) => x !== liarId)!).word!
    act(g, liarId, { type: 'liar.guess', word: ` ${word.split('').join(' ')} ` })
    expect(g.view(null).result!.winner).toBe('liar')
  })

  it('liar wins when a citizen is accused', () => {
    const { g, liarId } = liarSetup(4)
    describeAll(g)
    act(g, 'p0', { type: 'liar.skipDiscussion' }, true)
    const order = g.view(null).order
    const victim = order.find((x) => x !== liarId)!
    for (const id of order) act(g, id, { type: 'liar.vote', targetId: id === victim ? liarId : victim })
    expect(g.view(null).result!.winner).toBe('liar')
  })

  it('tie → revote among tied; second tie → liar wins', () => {
    const { g } = liarSetup(4)
    describeAll(g)
    act(g, 'p0', { type: 'liar.skipDiscussion' }, true)
    const [a, b, c, d] = g.view(null).order
    act(g, a, { type: 'liar.vote', targetId: b })
    act(g, b, { type: 'liar.vote', targetId: a })
    act(g, c, { type: 'liar.vote', targetId: a })
    act(g, d, { type: 'liar.vote', targetId: b })
    let v = g.view(null)
    expect(v.stage).toBe('vote')
    expect(v.revote).toBe(true)
    expect(new Set(v.candidates)).toEqual(new Set([a, b]))
    expect(act(g, c, { type: 'liar.vote', targetId: d }).ok).toBe(false) // not a candidate
    act(g, a, { type: 'liar.vote', targetId: b })
    act(g, b, { type: 'liar.vote', targetId: a })
    act(g, c, { type: 'liar.vote', targetId: a })
    act(g, d, { type: 'liar.vote', targetId: b })
    v = g.view(null)
    expect(v.stage).toBe('result')
    expect(v.result!.winner).toBe('liar')
  })

  it('everyone abstaining → liar wins; abstain is final', () => {
    const { g } = liarSetup(3)
    describeAll(g)
    act(g, 'p0', { type: 'liar.skipDiscussion' }, true)
    const [a, b, c] = g.view(null).order
    expect(act(g, a, { type: 'liar.vote', targetId: null }).ok).toBe(true)
    expect(act(g, a, { type: 'liar.vote', targetId: b }).ok).toBe(false) // 변경 불가
    expect(g.view(a).myVote).toBeNull()
    act(g, b, { type: 'liar.vote', targetId: null })
    act(g, c, { type: 'liar.vote', targetId: null })
    const v = g.view(null)
    expect(v.result!.winner).toBe('liar')
    expect(v.result!.votes[a]).toBeNull()
  })

  it('vote stage ends at the deadline even if someone never votes', () => {
    const { clock, g, liarId } = liarSetup(4)
    describeAll(g)
    act(g, 'p0', { type: 'liar.skipDiscussion' }, true)
    const voter = g.view(null).order.find((x) => x !== liarId)!
    act(g, voter, { type: 'liar.vote', targetId: liarId })
    clock.advance(30_001)
    expect(g.view(null).stage).toBe('guess')
    clock.advance(20_001)
    expect(g.view(null).result!.winner).toBe('citizens')
  })

  it('hides individual vote targets until the result', () => {
    const { g, liarId } = liarSetup(4)
    describeAll(g)
    act(g, 'p0', { type: 'liar.skipDiscussion' }, true)
    const order = g.view(null).order
    const voter = order.find((x) => x !== liarId)!
    act(g, voter, { type: 'liar.vote', targetId: liarId })
    const other = order.find((x) => x !== voter)!
    const v = g.view(other) as LiarView
    expect(v.votedIds).toContain(voter)
    expect(v.myVote).toBeUndefined()
    expect(v.result).toBeNull()
    expect(g.view(voter).myVote).toBe(liarId)
  })

  it('ends the round when the liar leaves', () => {
    const { g, liarId } = liarSetup(4)
    g.playerLeft(liarId)
    expect(g.view(null).result!.winner).toBe('none')
  })
})

describe('QuizGame', () => {
  function setup(n = 3) {
    const clock = new FakeClock()
    const h = ctx(clock, { ...DEFAULT_SETTINGS.quiz, questionCount: 3, category: 'it' as const }, n)
    const g = new QuizGame(h.c)
    g.start()
    return { clock, g, h }
  }

  it('hides other answers until reveal and scores correct ones', () => {
    const { clock, g } = setup(3)
    expect(act(g, 'p0', { type: 'quiz.answer', choice: 1 }).ok).toBe(true)
    expect(act(g, 'p0', { type: 'quiz.answer', choice: 2 }).ok).toBe(false) // duplicate
    const v1 = g.view('p1') as QuizView
    expect(v1.answeredIds).toEqual(['p0'])
    expect(v1.myAnswer).toBeNull()
    expect(v1.reveal).toBeNull()
    expect(JSON.stringify(v1)).not.toContain('correctIndex')
    clock.advance(1000)
    act(g, 'p1', { type: 'quiz.answer', choice: 0 })
    act(g, 'p2', { type: 'quiz.answer', choice: 3 })
    const v = g.view('p0') as QuizView
    expect(v.stage).toBe('reveal')
    const ci = v.reveal!.correctIndex
    for (const id of ['p0', 'p1', 'p2']) {
      const ans = v.reveal!.answers[id]
      expect(v.reveal!.gained[id] > 0).toBe(ans === ci)
    }
  })

  it('times out unanswered questions, advances, and produces a ranking', () => {
    const { clock, g, h } = setup(2)
    for (let i = 0; i < 3; i++) {
      act(g, 'p0', { type: 'quiz.answer', choice: 0 })
      clock.advance(DEFAULT_SETTINGS.quiz.seconds * 1000 + 1) // reveal
      clock.advance(5_001) // next
    }
    const v = g.view('p0') as QuizView
    expect(v.stage).toBe('result')
    expect(v.ranking).toHaveLength(2)
    expect(h.isFinished()).toBe(true)
    expect(v.ranking![0].score).toBeGreaterThanOrEqual(v.ranking![1].score)
  })

  it('rejects answers from non-participants and after time is up', () => {
    const { clock, g } = setup(2)
    expect(act(g, 'stranger', { type: 'quiz.answer', choice: 0 }).ok).toBe(false)
    clock.advance(DEFAULT_SETTINGS.quiz.seconds * 1000 + 1)
    expect(act(g, 'p0', { type: 'quiz.answer', choice: 0 }).ok).toBe(false)
  })
})
