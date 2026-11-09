import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '@relay/shared'
import { PRESENCE_GRACE_MS, RESULT_COOLDOWN_MS, Room, STARTING_MS } from '../src/rooms/Room.js'
import { FakeClock } from './fakeClock.js'

function makeRoom(game: 'mafia' | 'quiz' | 'wordchain' | 'liar', n: number) {
  const clock = new FakeClock()
  const sent: ChatMessage[] = []
  const room = new Room('ABCDEF', 'test', game, clock, { onChange() {}, onChat: (_r, m) => sent.push(m) })
  const ps = Array.from({ length: n }, (_, i) => {
    const p = room.addPlayer(`u${i}`)!
    room.attachSocket(p, `s${i}`)
    return p
  })
  return { clock, room, ps, sent }
}

describe('Room common rules', () => {
  it('a short disconnect is forgiven; staying away past the grace period removes a mafia player', () => {
    const { clock, room, ps } = makeRoom('mafia', 6)
    room.configure(ps[0].id, { settings: { mafia: { discussSeconds: 0 } } })
    expect(room.start(ps[0].id).ok).toBe(true)
    clock.advance(STARTING_MS)
    const alive = () => (room.snapshotFor(ps[0].id).game as { alive: string[] }).alive
    room.detachSocket(ps[1], 's1')
    clock.advance(PRESENCE_GRACE_MS - 1000)
    room.attachSocket(ps[1], 's1b') // 9초 만에 복귀
    clock.advance(5_000)
    expect(alive()).toContain(ps[1].id)
    room.detachSocket(ps[2], 's2')
    clock.advance(PRESENCE_GRACE_MS + 1)
    expect(alive()).not.toContain(ps[2].id)
  })

  it('dead players and spectators talk in a separate channel during play', () => {
    const { clock, room, ps, sent } = makeRoom('wordchain', 3)
    expect(room.start(ps[0].id).ok).toBe(true)
    clock.advance(STARTING_MS)
    const late = room.addPlayer('late')!
    room.attachSocket(late, 'sl')
    expect(late.spectator).toBe(true)
    room.say(late, '관전 중')
    const m = sent.at(-1)!
    expect(m.type === 'chat' && m.scope).toBe('out')
    expect(room.canSee(ps[0].id, m)).toBe(false)
    expect(room.canSee(late.id, m)).toBe(true)
    expect(room.chatFor(ps[0].id).some((x) => x.id === m.id)).toBe(false)
    room.say(ps[0], '일반')
    expect(sent.at(-1)!.type === 'chat' && (sent.at(-1) as { scope?: string }).scope).toBeFalsy()
    room.stop(ps[0].id)
    expect(room.canSee(ps[0].id, m)).toBe(true) // 판이 끝나면 공개
  })

  it('rejects input after the deadline and restarts only after the result cooldown', () => {
    const { clock, room, ps } = makeRoom('quiz', 1)
    room.configure(ps[0].id, { settings: { quiz: { questionCount: 3, seconds: 10 } } })
    expect(room.start(ps[0].id).ok).toBe(true)
    clock.advance(STARTING_MS)
    const g = room.game as unknown as { deadline: number }
    clock.t = g.deadline + 1 // 타이머가 돌기 직전 상황
    expect(room.action(ps[0].id, { type: 'quiz.answer', choice: 0 }).ok).toBe(false)
    while (room.phase !== 'RESULT') clock.advance(100)
    expect(room.start(ps[0].id).ok).toBe(false)
    clock.advance(RESULT_COOLDOWN_MS)
    expect(room.start(ps[0].id).ok).toBe(true)
  })

  it('refuses to start a quiz when the category has fewer questions than requested', () => {
    const { room, ps } = makeRoom('quiz', 1)
    room.configure(ps[0].id, { settings: { quiz: { category: 'media', questionCount: 15 } } })
    const r = room.start(ps[0].id)
    expect(r.ok).toBe(false)
  })
})
