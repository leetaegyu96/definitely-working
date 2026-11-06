import {
  canStartGame,
  DEFAULT_SETTINGS,
  GAME_TYPES,
  LIMITS,
  SETTINGS_SCHEMAS,
  type ChatMessage,
  type GameAction,
  type GameSettings,
  type GameType,
  type PlayerInfo,
  type RoomPhase,
  type RoomSnapshot,
  type SystemEvent,
} from '@relay/shared'
import { createEngine } from '../games/registry.js'
import type { GameEngine } from '../games/types.js'
import { newId, newToken } from '../services/ids.js'
import type { Clock } from '../services/clock.js'

export interface Player {
  id: string
  token: string
  name: string
  joinedAt: number
  sockets: Set<string>
  spectator: boolean
  disconnectedAt: number | null
}

export interface RoomHooks {
  /** 참가자별 상태 재전송 요청 */
  onChange(room: Room): void
  onChat(room: Room, msg: ChatMessage): void
}

export type RoomResult = { ok: true } | { ok: false; code: 'BAD_STATE' | 'FORBIDDEN' | 'INVALID' | 'FULL'; message: string }

export const STARTING_MS = 3_000

export class Room {
  readonly createdAt: number
  name: string
  hostId = ''
  players = new Map<string, Player>()
  phase: RoomPhase = 'WAITING'
  startsAt: number | null = null
  gameType: GameType
  settings: GameSettings = structuredClone(DEFAULT_SETTINGS)
  game: GameEngine | null = null
  chat: ChatMessage[] = []
  round = 0
  /** 마지막으로 접속자가 있었던 시각 (빈 방 정리용) */
  lastOccupiedAt: number
  private startTimer: (() => void) | null = null
  disposed = false

  constructor(
    readonly code: string,
    name: string,
    gameType: GameType,
    private clock: Clock,
    private hooks: RoomHooks,
  ) {
    this.createdAt = clock.now()
    this.lastOccupiedAt = this.createdAt
    this.name = name
    this.gameType = gameType
  }

  /* ── members ── */

  get members() {
    return [...this.players.values()].sort((a, b) => a.joinedAt - b.joinedAt)
  }

  get activePlayers() {
    return this.members.filter((p) => !p.spectator)
  }

  connectedCount() {
    return this.members.filter((p) => p.sockets.size > 0).length
  }

  uniqueName(raw: string) {
    const names = new Set(this.members.map((p) => p.name))
    if (!names.has(raw)) return raw
    for (let i = 2; ; i++) {
      const base = raw.slice(0, LIMITS.nameMax - 3)
      const candidate = `${base} (${i})`
      if (!names.has(candidate)) return candidate
    }
  }

  addPlayer(rawName: string): Player | null {
    if (this.players.size >= LIMITS.maxMembers) return null
    const p: Player = {
      id: newId(),
      token: newToken(),
      name: this.uniqueName(rawName),
      joinedAt: this.clock.now() + this.players.size * 0.001,
      sockets: new Set(),
      // 게임 진행 중 합류 → 관전자 (다음 게임부터 참가)
      spectator: this.phase === 'PLAYING' || this.phase === 'STARTING',
      disconnectedAt: null,
    }
    this.players.set(p.id, p)
    if (!this.hostId) this.hostId = p.id
    this.event({ code: 'joined', name: p.name, spectator: p.spectator })
    this.changed()
    return p
  }

  findByToken(token: string) {
    for (const p of this.players.values()) if (p.token === token) return p
    return undefined
  }

  attachSocket(p: Player, socketId: string) {
    p.sockets.add(socketId)
    p.disconnectedAt = null
    this.lastOccupiedAt = this.clock.now()
    this.changed()
  }

  detachSocket(p: Player, socketId: string) {
    p.sockets.delete(socketId)
    if (p.sockets.size === 0) {
      p.disconnectedAt = this.clock.now()
      this.lastOccupiedAt = this.clock.now()
    }
    this.changed()
  }

  removePlayer(id: string, reason: 'leave' | 'timeout') {
    const p = this.players.get(id)
    if (!p) return
    this.players.delete(id)
    this.event({ code: 'left', name: p.name })
    void reason
    this.game?.playerLeft(id)
    if (this.hostId === id) this.transferHost()
    // 시작 대기 중 인원이 부족해지면 취소
    if (this.phase === 'STARTING' && !canStartGame(this.gameType, this.activePlayers.length).ok) {
      this.cancelStart()
      this.event({ code: 'game_aborted', reason: '참가 인원이 부족해 시작이 취소되었습니다.' })
    }
    this.changed()
  }

  transferHost() {
    const candidates = this.members.filter((p) => p.id !== this.hostId)
    const next = candidates.find((p) => p.sockets.size > 0) ?? candidates[0]
    this.hostId = next?.id ?? ''
    if (next) this.event({ code: 'host_changed', name: next.name })
  }

  /* ── chat ── */

  event(e: SystemEvent) {
    this.push({ id: newId(), ts: this.clock.now(), type: 'event', event: e })
  }

  say(p: Player, text: string) {
    this.push({ id: newId(), ts: this.clock.now(), type: 'chat', authorId: p.id, authorName: p.name, text })
  }

  private push(msg: ChatMessage) {
    this.chat.push(msg)
    if (this.chat.length > LIMITS.chatHistory) this.chat.splice(0, this.chat.length - LIMITS.chatHistory)
    this.hooks.onChat(this, msg)
  }

  changed() {
    if (!this.disposed) this.hooks.onChange(this)
  }

  /* ── configuration ── */

  configure(by: string, cfg: { gameType?: GameType; sessionName?: string; settings?: Partial<Record<GameType, object>> }): RoomResult {
    if (by !== this.hostId) return { ok: false, code: 'FORBIDDEN', message: '세션 호스트만 변경할 수 있습니다' }
    if (cfg.sessionName) this.name = cfg.sessionName
    const gameChanging = (cfg.gameType && cfg.gameType !== this.gameType) || cfg.settings
    if (gameChanging && (this.phase === 'PLAYING' || this.phase === 'STARTING'))
      return { ok: false, code: 'BAD_STATE', message: '진행 중에는 유형을 바꿀 수 없습니다' }
    for (const g of GAME_TYPES) {
      const patch = cfg.settings?.[g]
      if (patch) (this.settings as Record<GameType, unknown>)[g] = SETTINGS_SCHEMAS[g].parse({ ...this.settings[g], ...patch })
    }
    if (cfg.gameType && cfg.gameType !== this.gameType) {
      this.gameType = cfg.gameType
      this.resetToWaiting()
      this.event({ code: 'game_selected', game: cfg.gameType })
    }
    this.changed()
    return { ok: true }
  }

  /* ── game lifecycle ── */

  start(by: string): RoomResult {
    if (by !== this.hostId) return { ok: false, code: 'FORBIDDEN', message: '세션 호스트만 시작할 수 있습니다' }
    if (this.phase === 'PLAYING' || this.phase === 'STARTING')
      return { ok: false, code: 'BAD_STATE', message: '이미 진행 중입니다' }
    // 관전자는 다음 게임부터 참가자로 전환
    for (const p of this.players.values()) p.spectator = false
    const eligible = this.activePlayers.filter((p) => p.sockets.size > 0)
    const check = canStartGame(this.gameType, eligible.length)
    if (!check.ok) return { ok: false, code: 'BAD_STATE', message: check.reason! }
    this.game?.dispose()
    this.game = null
    this.phase = 'STARTING'
    this.startsAt = this.clock.now() + STARTING_MS
    this.event({ code: 'game_starting', game: this.gameType })
    this.startTimer = this.clock.setTimer(STARTING_MS, () => this.beginGame())
    this.changed()
    return { ok: true }
  }

  private cancelStart() {
    this.startTimer?.()
    this.startTimer = null
    this.startsAt = null
    this.phase = 'WAITING'
  }

  private beginGame() {
    this.startTimer = null
    this.startsAt = null
    // 시작 시점에 접속해 있는 참가자만 게임에 참여, 나머지는 관전자 처리
    const participants = this.activePlayers.filter((p) => p.sockets.size > 0)
    for (const p of this.activePlayers) if (p.sockets.size === 0) p.spectator = true
    const check = canStartGame(this.gameType, participants.length)
    if (!check.ok) {
      this.phase = 'WAITING'
      this.event({ code: 'game_aborted', reason: check.reason! })
      this.changed()
      return
    }
    this.round++
    this.phase = 'PLAYING'
    this.game = createEngine(this.gameType, {
      participants: participants.map((p) => ({ id: p.id, name: p.name })),
      settings: this.settings[this.gameType] as never,
      round: this.round,
      now: () => this.clock.now(),
      random: () => this.clock.random(),
      setTimer: (ms, fn) => this.clock.setTimer(ms, () => !this.disposed && fn()),
      isConnected: (id) => (this.players.get(id)?.sockets.size ?? 0) > 0,
      emit: (e) => this.event(e),
      changed: () => this.changed(),
      finish: () => {
        this.phase = 'RESULT'
      },
    })
    this.game.start()
    this.changed()
  }

  stop(by: string): RoomResult {
    if (by !== this.hostId) return { ok: false, code: 'FORBIDDEN', message: '세션 호스트만 중단할 수 있습니다' }
    if (this.phase === 'WAITING') return { ok: false, code: 'BAD_STATE', message: '진행 중인 작업이 없습니다' }
    const name = this.players.get(by)?.name ?? ''
    const wasRunning = this.phase !== 'RESULT'
    this.resetToWaiting()
    if (wasRunning) this.event({ code: 'game_stopped', by: name })
    this.changed()
    return { ok: true }
  }

  private resetToWaiting() {
    this.cancelStart()
    this.game?.dispose()
    this.game = null
    this.phase = 'WAITING'
    for (const p of this.players.values()) p.spectator = false
  }

  action(by: string, action: GameAction): RoomResult {
    if (this.phase !== 'PLAYING' || !this.game) return { ok: false, code: 'BAD_STATE', message: '진행 중인 작업이 없습니다' }
    const r = this.game.action(by, action, { isHost: by === this.hostId })
    return r.ok ? { ok: true } : r
  }

  /* ── snapshot ── */

  snapshotFor(playerId: string): RoomSnapshot {
    const me = this.players.get(playerId)
    const players: PlayerInfo[] = this.members.map((p) => ({
      id: p.id,
      name: p.name,
      connected: p.sockets.size > 0,
      spectator: p.spectator,
      joinedAt: p.joinedAt,
    }))
    return {
      code: this.code,
      name: this.name,
      createdAt: this.createdAt,
      hostId: this.hostId,
      meId: playerId,
      phase: this.phase,
      startsAt: this.startsAt,
      gameType: this.gameType,
      settings: this.settings,
      players,
      game: this.game ? this.game.view(me && !me.spectator ? playerId : null) : null,
      serverNow: this.clock.now(),
    }
  }

  dispose() {
    this.disposed = true
    this.startTimer?.()
    this.game?.dispose()
  }
}
