import {
  canStartGame,
  DEFAULT_SETTINGS,
  GAME_TYPES,
  LIMITS,
  SETTINGS_SCHEMAS,
  type ChatImage,
  type ChatMessage,
  type GameAction,
  type GameSettings,
  type GameType,
  type PlayerInfo,
  type RoomPhase,
  type RoomSnapshot,
  type SystemEvent,
} from '@relay/shared'
import { pickFresh } from '../games/fresh.js'
import { createEngine, startCheck } from '../games/registry.js'
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
/** 진행 중 연결이 끊겼을 때 게임별 미응답/이탈 처리까지 기다리는 시간 */
export const PRESENCE_GRACE_MS = 10_000
/** 결과 화면을 볼 시간 — 이 시간 안에는 다음 판을 시작할 수 없다 */
export const RESULT_COOLDOWN_MS = 5_000

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
  private graceTimers = new Map<string, () => void>()
  /** 콘텐츠 종류별 최근 출제 id (연속 반복 방지) */
  private recent = new Map<string, string[]>()
  private resultAt = 0
  /** 판 번호별로 관전 채팅을 받아 본 사람 — 판이 끝나도 이 사람들에게만 계속 보인다 */
  private outAudience = new Map<number, Set<string>>()
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
    this.graceTimers.get(p.id)?.()
    this.graceTimers.delete(p.id)
    this.lastOccupiedAt = this.clock.now()
    this.changed()
  }

  detachSocket(p: Player, socketId: string) {
    p.sockets.delete(socketId)
    if (p.sockets.size === 0) {
      p.disconnectedAt = this.clock.now()
      this.lastOccupiedAt = this.clock.now()
      if (this.phase === 'PLAYING' && this.game && !p.spectator && !this.graceTimers.has(p.id)) {
        const game = this.game
        this.graceTimers.set(
          p.id,
          this.clock.setTimer(PRESENCE_GRACE_MS, () => {
            this.graceTimers.delete(p.id)
            if (this.disposed || this.game !== game || this.phase !== 'PLAYING' || p.sockets.size > 0) return
            game.playerGone?.(p.id)
          }),
        )
      }
    }
    this.changed()
  }

  removePlayer(id: string, reason: 'leave' | 'timeout') {
    const p = this.players.get(id)
    if (!p) return
    this.players.delete(id)
    this.graceTimers.get(id)?.()
    this.graceTimers.delete(id)
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

  say(p: Player, text: string, image?: ChatImage) {
    if (image) this.expireOldImages()
    // 진행 중인 판에서 빠진 사람(관전자·사망·탈락)의 말은 같은 처지끼리만 본다
    const out = this.phase === 'PLAYING' && this.isOut(p.id)
    if (out) {
      const aud = this.outAudience.get(this.round) ?? new Set<string>()
      for (const m of this.players.values()) if (this.isOut(m.id)) aud.add(m.id)
      this.outAudience.set(this.round, aud)
    }
    this.push({
      id: newId(),
      ts: this.clock.now(),
      type: 'chat',
      authorId: p.id,
      authorName: p.name,
      text,
      ...(image ? { image } : {}),
      ...(out ? { scope: 'out' as const, round: this.round } : {}),
    })
  }

  /** 진행 중인 판에 영향을 줄 수 없는 사람 */
  isOut(id: string) {
    const p = this.players.get(id)
    if (!p) return true
    return p.spectator || !!this.game?.isOut?.(id)
  }

  /**
   * 이 사람이 볼 수 있는 메시지인지.
   * 관전 채팅은 진행 중에는 그 판에서 빠진 사람에게만 보이고, 판이 끝난 뒤에도 공개하지 않는다
   * (역할 추리 등 민감한 내용이 있을 수 있음). 판이 끝난 뒤의 새 채팅은 일반 채팅.
   */
  canSee(id: string, m: ChatMessage) {
    if (m.type !== 'chat' || m.scope !== 'out') return true
    if (this.phase === 'PLAYING' && m.round === this.round && this.isOut(id)) return true
    return m.round !== undefined && !!this.outAudience.get(m.round)?.has(id)
  }

  chatFor(id: string, limit = 100) {
    return this.chat.filter((m) => this.canSee(id, m)).slice(-limit)
  }

  /** 서버 메모리 보호: 최근 이미지 N장만 보관하고 나머지는 "만료" 표시만 남긴다 */
  private expireOldImages() {
    const withImage = this.chat.filter((m) => m.type === 'chat' && m.image)
    const excess = withImage.length - (LIMITS.imagesKept - 1)
    for (const m of withImage.slice(0, Math.max(0, excess))) {
      if (m.type !== 'chat') continue
      delete m.image
      m.imageExpired = true
    }
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
    if (this.phase === 'RESULT' && this.clock.now() - this.resultAt < RESULT_COOLDOWN_MS)
      return { ok: false, code: 'BAD_STATE', message: '결과를 확인한 뒤 잠시 후 시작할 수 있습니다' }
    const pre = startCheck(this.gameType, this.settings)
    if (!pre.ok) return { ok: false, code: 'BAD_STATE', message: pre.reason }
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
      // 재접속 유예(10초) 중인 사람도 "있는 사람"으로 본다 → 잠깐 끊긴 사이 투표·정답 공개가 앞당겨지지 않음
      isConnected: (id) => (this.players.get(id)?.sockets.size ?? 0) > 0 || this.graceTimers.has(id),
      emit: (e) => this.event(e),
      changed: () => this.changed(),
      finish: () => {
        this.phase = 'RESULT'
        this.resultAt = this.clock.now()
        this.clearGrace()
      },
      pickFresh: (key, pool, count) => {
        const r = pickFresh(this.recent.get(key) ?? [], pool, count, () => this.clock.random())
        this.recent.set(key, r.recent)
        return r.picked
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

  private clearGrace() {
    for (const c of this.graceTimers.values()) c()
    this.graceTimers.clear()
  }

  private resetToWaiting() {
    this.clearGrace()
    this.cancelStart()
    this.game?.dispose()
    this.game = null
    this.phase = 'WAITING'
    for (const p of this.players.values()) p.spectator = false
  }

  action(by: string, action: GameAction): RoomResult {
    if (this.phase !== 'PLAYING' || !this.game) return { ok: false, code: 'BAD_STATE', message: '진행 중인 작업이 없습니다' }
    // 마감 시각이 지난 입력은 타이머가 아직 돌기 전이라도 인정하지 않는다
    const d = this.game.deadline
    if (typeof d === 'number' && this.clock.now() > d) return { ok: false, code: 'BAD_STATE', message: '제한 시간이 지났습니다' }
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
    this.clearGrace()
    this.startTimer?.()
    this.game?.dispose()
  }
}
