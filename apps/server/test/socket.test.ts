import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { io as ioc, type Socket } from 'socket.io-client'
import type { AddressInfo } from 'node:net'
import type {
  Ack,
  ChatMessage,
  ClientToServerEvents,
  JoinResult,
  LiarView,
  QuizView,
  RoomSnapshot,
  ServerToClientEvents,
} from '@relay/shared'
import { createApp } from '../src/app.js'

type C = Socket<ServerToClientEvents, ClientToServerEvents>

let url = ''
let server: ReturnType<typeof createApp>

beforeAll(async () => {
  server = createApp()
  await new Promise<void>((r) => server.httpServer.listen(0, r))
  url = `http://localhost:${(server.httpServer.address() as AddressInfo).port}`
})
afterAll(() => {
  server.rooms.stop()
  server.io.close()
})

class Client {
  s: C
  states: RoomSnapshot[] = []
  raw: string[] = []
  chat: ChatMessage[] = []
  constructor() {
    this.s = ioc(url, { transports: ['websocket'], forceNew: true }) as C
    this.s.on('room:state', (st) => {
      this.states.push(st)
      this.raw.push(JSON.stringify(st))
    })
    this.s.on('chat:message', (m) => this.chat.push(m))
  }
  get last() {
    return this.states[this.states.length - 1]
  }
  emit<T>(ev: keyof ClientToServerEvents, payload: unknown): Promise<Ack<T>> {
    return new Promise((res) => (this.s.emit as any)(ev, payload, res))
  }
  async waitFor(pred: (s: RoomSnapshot) => boolean, ms = 10_000): Promise<RoomSnapshot> {
    const start = Date.now()
    while (Date.now() - start < ms) {
      if (this.last && pred(this.last)) return this.last
      await new Promise((r) => setTimeout(r, 20))
    }
    throw new Error('timeout waiting for state; last=' + JSON.stringify(this.last?.game))
  }
  close() {
    this.s.close()
  }
}

describe('socket flow', () => {
  it('create → join ×2 → chat → liar game end to end, secrets never leak', async () => {
    const a = new Client(), b = new Client(), c = new Client()
    const created = await a.emit<JoinResult>('room:create', { name: '민수', gameType: 'liar', settings: { liar: { discussSeconds: 30 } } })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const code = created.data.snapshot.code
    expect(code).toMatch(/^[A-Z0-9]{6}$/)

    // too few players
    const early = await a.emit('game:start', {})
    expect(early.ok).toBe(false)

    const jb = await b.emit<JoinResult>('room:join', { code: code.toLowerCase(), name: '지우' })
    const jc = await c.emit<JoinResult>('room:join', { code, name: '민수' }) // duplicate name → suffixed
    expect(jb.ok && jc.ok).toBe(true)
    if (!jc.ok || !jb.ok) return
    expect(jc.data.snapshot.players.find((p) => p.id === jc.data.snapshot.meId)!.name).toBe('민수 (2)')

    // non-host cannot start
    expect((await b.emit('game:start', {})).ok).toBe(false)

    // chat + XSS-ish text passes through as plain data
    await b.emit('chat:send', { text: '<img src=x onerror=alert(1)> 안녕' })
    await new Promise((r) => setTimeout(r, 100))
    expect(a.chat.some((m) => m.type === 'chat' && m.text.includes('안녕'))).toBe(true)
    expect((await b.emit('chat:send', { text: '   ' })).ok).toBe(false)

    expect((await a.emit('game:start', {})).ok).toBe(true)
    const clients = [a, b, c]
    await a.waitFor((s) => s.phase === 'PLAYING')
    const views = await Promise.all(clients.map((x) => x.waitFor((s) => s.game?.type === 'liar')))
    const roles = views.map((v) => (v.game as LiarView).myRole)
    expect(roles.filter((r) => r === 'liar')).toHaveLength(1)
    const liarIdx = roles.indexOf('liar')
    const word = (views.find((v) => (v.game as LiarView).myRole === 'citizen')!.game as LiarView).word!
    expect(word).toBeTruthy()

    const byId = new Map(clients.map((x, i) => [views[i].meId, x]))
    // describe in server order
    for (;;) {
      const g = (await a.waitFor(() => true)).game as LiarView
      if (g.stage !== 'describe') break
      const cur = g.currentTurnId!
      const r = await byId.get(cur)!.emit('game:action', { type: 'liar.describe', text: '빨갛다' })
      expect(r.ok).toBe(true)
      await a.waitFor((s) => (s.game as LiarView).currentTurnId !== cur)
    }
    await a.waitFor((s) => (s.game as LiarView).stage === 'discuss')
    expect((await b.emit('game:action', { type: 'liar.skipDiscussion' })).ok).toBe(false)
    expect((await a.emit('game:action', { type: 'liar.skipDiscussion' })).ok).toBe(true)
    await a.waitFor((s) => (s.game as LiarView).stage === 'vote')

    const liarId = views[liarIdx].meId
    const someCitizen = views.find((v) => v.meId !== liarId)!.meId
    for (const [i, x] of clients.entries()) {
      const target = views[i].meId === liarId ? someCitizen : liarId
      const r = await x.emit('game:action', { type: 'liar.vote', targetId: target })
      expect(r.ok).toBe(true)
    }
    await a.waitFor((s) => (s.game as LiarView).stage === 'guess')
    await clients[liarIdx].emit('game:action', { type: 'liar.guess', word })
    const fin = await a.waitFor((s) => s.phase === 'RESULT')
    expect((fin.game as LiarView).result!.winner).toBe('liar')

    // the liar's socket never received the word before the result
    const liarRaw = clients[liarIdx].raw
    const firstResult = liarRaw.findIndex((r) => r.includes('"phase":"RESULT"'))
    expect(liarRaw.slice(0, firstResult).some((r) => r.includes(word))).toBe(false)

    // restart → quiz
    expect((await a.emit('room:configure', { gameType: 'quiz', settings: { quiz: { questionCount: 3 } } })).ok).toBe(true)
    await a.waitFor((s) => s.phase === 'WAITING' && s.gameType === 'quiz')

    // reconnect: c drops and resumes with token
    c.close()
    await a.waitFor((s) => s.players.some((p) => !p.connected))
    const c2 = new Client()
    const resumed = await c2.emit<JoinResult>('session:resume', { code, token: jc.data.token })
    expect(resumed.ok).toBe(true)
    if (!resumed.ok) return
    expect(resumed.data.snapshot.meId).toBe(jc.data.snapshot.meId)
    expect(resumed.data.chat.length).toBeGreaterThan(0)
    // a forged token is rejected
    expect((await new Client().emit('session:resume', { code, token: 'x'.repeat(32) })).ok).toBe(false)

    const qc = [a, b, c2]
    expect((await a.emit('game:start', {})).ok).toBe(true)
    for (let i = 0; i < 3; i++) {
      await Promise.all(qc.map((x) => x.waitFor((s) => s.game?.type === 'quiz' && (s.game as QuizView).stage === 'question' && (s.game as QuizView).index === i)))
      const hidden = qc[1].last.game as QuizView
      expect(hidden.reveal).toBeNull()
      for (const x of qc) expect((await x.emit('game:action', { type: 'quiz.answer', choice: i % 4 })).ok).toBe(true)
      await a.waitFor((s) => (s.game as QuizView).stage !== 'question' || (s.game as QuizView).index !== i)
    }
    const qr = await a.waitFor((s) => s.phase === 'RESULT', 15_000)
    expect((qr.game as QuizView).ranking).toHaveLength(3)

    // host leaves → delegated
    const hostId = qr.hostId
    expect((await a.emit('room:leave', {})).ok).toBe(true)
    const after = await b.waitFor((s) => s.hostId !== hostId)
    expect(after.players).toHaveLength(2)
    expect(b.chat.some((m) => m.type === 'event' && m.event.code === 'host_changed')).toBe(true)

    // mid-game joiner becomes spectator
    ;[a, b, c2].forEach((x) => x.close())
  }, 60_000)

  it('mid-game joiners are spectators and receive no secrets', async () => {
    const hs = [new Client(), new Client(), new Client()]
    const cr = await hs[0].emit<JoinResult>('room:create', { name: 'h', gameType: 'liar' })
    if (!cr.ok) throw new Error()
    const code = cr.data.snapshot.code
    await hs[1].emit('room:join', { code, name: 'b' })
    await hs[2].emit('room:join', { code, name: 'c' })
    await hs[0].emit('game:start', {})
    await hs[0].waitFor((s) => s.phase === 'PLAYING')
    const late = new Client()
    const j = await late.emit<JoinResult>('room:join', { code, name: 'late' })
    if (!j.ok) throw new Error()
    const me = j.data.snapshot.players.find((p) => p.id === j.data.snapshot.meId)!
    expect(me.spectator).toBe(true)
    const g = j.data.snapshot.game as LiarView
    expect(g.myRole).toBe('spectator')
    expect(g.word).toBeNull()
    expect((await late.emit('game:action', { type: 'liar.vote', targetId: hs[0].last.meId })).ok).toBe(false)
    ;[...hs, late].forEach((x) => x.close())
  }, 20_000)

  it('quiz can be played solo from start to result', async () => {
    const x = new Client()
    const cr = await x.emit<JoinResult>('room:create', { name: 'solo', gameType: 'quiz', settings: { quiz: { questionCount: 3 } } })
    expect(cr.ok).toBe(true)
    expect((await x.emit('game:start', {})).ok).toBe(true)
    for (let i = 0; i < 3; i++) {
      await x.waitFor((s) => s.game?.type === 'quiz' && (s.game as QuizView).stage === 'question' && (s.game as QuizView).index === i)
      expect((await x.emit('game:action', { type: 'quiz.answer', choice: 0 })).ok).toBe(true)
      // 혼자면 응답 즉시 정답 공개
      await x.waitFor((s) => (s.game as QuizView).stage !== 'question' || (s.game as QuizView).index !== i, 2000)
    }
    const r = await x.waitFor((s) => s.phase === 'RESULT', 15_000)
    expect((r.game as QuizView).ranking).toHaveLength(1)
    // 라이어 게임은 여전히 3명 필요
    expect((await x.emit('room:configure', { gameType: 'liar' })).ok).toBe(true)
    const liar = await x.emit('game:start', {})
    expect(liar.ok).toBe(false)
    x.close()
  }, 30_000)

  it('rejects malformed payloads and unknown rooms', async () => {
    const x = new Client()
    expect((await x.emit('room:join', { code: 'ZZZZZZ', name: 'a' })).ok).toBe(false)
    expect((await x.emit('room:join', { code: '../../', name: 'a' })).ok).toBe(false)
    expect((await x.emit('room:create', { name: '', gameType: 'liar' })).ok).toBe(false)
    expect((await x.emit('room:create', { name: 'a', gameType: 'poker' })).ok).toBe(false)
    expect((await x.emit('chat:send', { text: 'hi' })).ok).toBe(false)
    x.close()
  })
})
