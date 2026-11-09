import type { GameAction, MafiaSettings, MafiaStage, MafiaView } from '@relay/shared'
import { fail, ok, shuffle, type ActionResult, type GameContext, type GameEngine } from '../types.js'

/** 판이 끝없이 길어지지 않도록: 8일째 낮 투표까지 승부가 안 나면 시민 승리 */
export const MAX_DAYS = 8

/** 인원별 마피아 수 (시민·마피아만 사용하는 간소화 규칙) */
export function mafiaCount(n: number) {
  return n <= 6 ? 1 : n <= 9 ? 2 : 3
}

export class MafiaGame implements GameEngine {
  readonly type = 'mafia' as const
  private stage: MafiaStage = 'day'
  private day = 1
  private players: string[] = []
  private mafia = new Set<string>()
  private alive = new Set<string>()
  private nightVotes = new Map<string, string>()
  private dayVotes = new Map<string, string | null>()
  private lastKilled: string | null = null
  private lastExecuted: string | null | undefined = undefined
  deadline: number | null = null
  private result: MafiaView['result'] = null
  private cancel: (() => void) | null = null

  constructor(private ctx: GameContext<MafiaSettings>) {}

  start() {
    this.players = this.ctx.participants.map((p) => p.id)
    const shuffled = shuffle(this.players, this.ctx.random)
    for (const id of shuffled.slice(0, mafiaCount(this.players.length))) this.mafia.add(id)
    this.alive = new Set(this.players)
    this.ctx.emit({ code: 'game_started', game: 'mafia', round: this.ctx.round })
    // 첫날은 낮 토론부터: 말 한마디 못 하고 밤에 제거되는 일을 막는다
    this.beginDay()
  }

  dispose() {
    this.cancel?.()
  }

  private name(id: string | null) {
    return id ? (this.ctx.participants.find((p) => p.id === id)?.name ?? '알 수 없음') : ''
  }

  private schedule(ms: number, fn: () => void) {
    this.cancel?.()
    this.deadline = this.ctx.now() + ms
    this.cancel = this.ctx.setTimer(ms, () => {
      this.cancel = null
      fn()
    })
  }

  private aliveMafia() {
    return [...this.alive].filter((id) => this.mafia.has(id))
  }

  private aliveCitizens() {
    return [...this.alive].filter((id) => !this.mafia.has(id))
  }

  /** 승리 조건 확인 — 끝났으면 true */
  private checkWin(): boolean {
    const m = this.aliveMafia().length
    const c = this.aliveCitizens().length
    if (m === 0) {
      this.finish('citizens', '모든 마피아를 찾아냈습니다.')
      return true
    }
    if (m >= c) {
      this.finish('mafia', '마피아 수가 시민 수 이상이 되었습니다.')
      return true
    }
    return false
  }

  private beginNight() {
    this.stage = 'night'
    this.nightVotes.clear()
    this.ctx.emit({ code: 'mafia_night', day: this.day })
    this.schedule(this.ctx.settings.nightSeconds * 1000, () => this.resolveNight())
    this.ctx.changed()
  }

  private resolveNight() {
    this.cancel?.()
    const counts = new Map<string, number>()
    for (const [voter, target] of this.nightVotes) {
      if (this.alive.has(voter) && this.alive.has(target)) counts.set(target, (counts.get(target) ?? 0) + 1)
    }
    let killed: string | null = null
    if (counts.size) {
      const max = Math.max(...counts.values())
      const top = [...counts.keys()].filter((k) => counts.get(k) === max)
      killed = top[Math.floor(this.ctx.random() * top.length)]
      this.alive.delete(killed)
    }
    this.lastKilled = killed
    this.ctx.emit({ code: 'mafia_dawn', day: this.day, killedName: killed ? this.name(killed) : null })
    if (this.checkWin()) return
    this.day++
    this.beginDay()
  }

  private beginDay() {
    this.ctx.emit({ code: 'mafia_day', day: this.day, maxDays: MAX_DAYS })
    const secs = this.ctx.settings.discussSeconds
    if (secs <= 0) return this.beginVote()
    this.stage = 'day'
    this.schedule(secs * 1000, () => this.beginVote())
    this.ctx.changed()
  }

  private beginVote() {
    this.stage = 'vote'
    this.dayVotes.clear()
    this.ctx.emit({ code: 'mafia_vote_open', day: this.day })
    this.schedule(this.ctx.settings.voteSeconds * 1000, () => this.resolveVote())
    this.ctx.changed()
  }

  private resolveVote() {
    this.cancel?.()
    const counts = new Map<string, number>()
    for (const t of this.dayVotes.values()) if (t && this.alive.has(t)) counts.set(t, (counts.get(t) ?? 0) + 1)
    let executed: string | null = null
    let votes = 0
    if (counts.size) {
      votes = Math.max(...counts.values())
      const top = [...counts.keys()].filter((k) => counts.get(k) === votes)
      // 동률이면 처형 없음
      if (top.length === 1) executed = top[0]
    }
    if (executed) this.alive.delete(executed)
    this.lastExecuted = executed
    this.ctx.emit({ code: 'mafia_executed', name: executed ? this.name(executed) : null, votes })
    if (this.checkWin()) return
    if (this.day >= MAX_DAYS) return this.finish('citizens', `${MAX_DAYS}일 동안 마피아가 이기지 못해 시민이 승리했습니다.`)
    this.beginNight()
  }

  private finish(winner: 'mafia' | 'citizens' | 'none', reason: string) {
    this.cancel?.()
    this.stage = 'result'
    this.deadline = null
    const roles: Record<string, 'mafia' | 'citizen'> = {}
    for (const id of this.players) roles[id] = this.mafia.has(id) ? 'mafia' : 'citizen'
    this.result = { winner, roles, reason }
    this.ctx.emit({ code: 'mafia_result', winner, mafiaNames: [...this.mafia].map((id) => this.name(id)), reason })
    this.ctx.finish()
    this.ctx.changed()
  }

  action(playerId: string, action: GameAction, opts: { isHost: boolean }): ActionResult {
    const aliveMe = this.alive.has(playerId)
    switch (action.type) {
      case 'mafia.kill': {
        if (this.stage !== 'night') return fail('BAD_STATE', '밤이 아닙니다')
        if (!this.mafia.has(playerId) || !aliveMe) return fail('FORBIDDEN', '살아 있는 마피아만 지목할 수 있습니다')
        if (!this.alive.has(action.targetId) || this.mafia.has(action.targetId)) return fail('INVALID', '지목할 수 없는 대상입니다')
        this.nightVotes.set(playerId, action.targetId)
        // 마피아 전원이 같은 대상을 고르면 즉시 진행
        const am = this.aliveMafia()
        const targets = new Set(am.map((m) => this.nightVotes.get(m)))
        if (am.every((m) => this.nightVotes.has(m)) && targets.size === 1) this.resolveNight()
        else this.ctx.changed()
        return ok
      }
      case 'mafia.skip': {
        if (this.stage !== 'day') return fail('BAD_STATE', '토론 중이 아닙니다')
        if (!opts.isHost) return fail('FORBIDDEN', '세션 호스트만 진행할 수 있습니다')
        this.beginVote()
        return ok
      }
      case 'mafia.vote': {
        if (this.stage !== 'vote') return fail('BAD_STATE', '투표 중이 아닙니다')
        if (!aliveMe) return fail('FORBIDDEN', '살아 있는 참여자만 투표할 수 있습니다')
        if (this.dayVotes.has(playerId)) return fail('BAD_STATE', '이미 투표했습니다')
        if (action.targetId !== null && (!this.alive.has(action.targetId) || action.targetId === playerId))
          return fail('INVALID', '투표할 수 없는 대상입니다')
        this.dayVotes.set(playerId, action.targetId)
        const pending = [...this.alive].filter((id) => !this.dayVotes.has(id) && this.ctx.isConnected(id))
        if (pending.length === 0) this.resolveVote()
        else this.ctx.changed()
        return ok
      }
      default:
        return fail('INVALID', '지원하지 않는 동작입니다')
    }
  }

  isOut(playerId: string) {
    return this.players.includes(playerId) && !this.alive.has(playerId) && this.stage !== 'result'
  }

  /** 연결이 끊긴 채 유예 시간이 지나면 이탈로 보고 판에서 제외 (역할은 공개하지 않음) */
  playerGone(playerId: string) {
    if (!this.alive.has(playerId) || this.stage === 'result') return
    this.ctx.emit({ code: 'mafia_gone', name: this.name(playerId) })
    this.playerLeft(playerId)
  }

  playerLeft(playerId: string) {
    if (!this.players.includes(playerId) || this.stage === 'result') return
    this.alive.delete(playerId)
    this.nightVotes.delete(playerId)
    this.dayVotes.delete(playerId)
    if (this.checkWin()) return
    if (this.stage === 'vote' && [...this.alive].every((id) => this.dayVotes.has(id) || !this.ctx.isConnected(id))) return this.resolveVote()
    this.ctx.changed()
  }

  view(playerId: string | null): MafiaView {
    const inGame = playerId !== null && this.players.includes(playerId)
    const isMafia = inGame && this.mafia.has(playerId!)
    const done = this.stage === 'result'
    return {
      type: 'mafia',
      round: this.ctx.round,
      stage: this.stage,
      day: this.day,
      maxDays: MAX_DAYS,
      myRole: !inGame ? 'spectator' : isMafia ? 'mafia' : 'citizen',
      team: isMafia || done ? [...this.mafia] : [],
      players: this.players.slice(),
      alive: [...this.alive],
      deadline: done ? null : this.deadline,
      lastKilled: this.lastKilled,
      votedIds: this.stage === 'vote' ? [...this.dayVotes.keys()] : [],
      myVote: playerId && this.stage === 'vote' ? this.dayVotes.get(playerId) : undefined,
      nightVotes: isMafia && this.stage === 'night' ? Object.fromEntries(this.nightVotes) : {},
      lastExecuted: this.lastExecuted,
      result: this.result,
    }
  }
}
