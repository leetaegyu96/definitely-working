import type { ChatMessage, GameType } from '@relay/shared'
import { config } from '../config.js'
import type { Clock } from '../services/clock.js'
import { newRoomCode } from '../services/ids.js'
import { Room, type RoomHooks } from './Room.js'

export class RoomManager {
  readonly rooms = new Map<string, Room>()
  private sweepTimer: NodeJS.Timeout | null = null

  constructor(
    private clock: Clock,
    private hooks: RoomHooks & { onDispose(room: Room): void },
  ) {}

  create(sessionName: string, gameType: GameType): Room | null {
    if (this.rooms.size >= config.maxRooms) return null
    let code = newRoomCode()
    while (this.rooms.has(code)) code = newRoomCode()
    const room = new Room(code, sessionName, gameType, this.clock, this.hooks)
    this.rooms.set(code, room)
    return room
  }

  get(code: string) {
    return this.rooms.get(code)
  }

  dispose(room: Room, reason: string) {
    if (room.disposed) return
    room.dispose()
    this.rooms.delete(room.code)
    this.hooks.onDispose(room)
    void reason
  }

  /** 호스트 위임 / 끊긴 대기자 정리 / 빈 방 정리 */
  sweep() {
    const now = this.clock.now()
    for (const room of [...this.rooms.values()]) {
      if (room.players.size === 0) {
        this.dispose(room, 'empty')
        continue
      }
      if (room.connectedCount() === 0) {
        if (now - room.lastOccupiedAt > config.roomIdleMs) this.dispose(room, 'idle')
        continue
      }
      const host = room.players.get(room.hostId)
      if (host && host.sockets.size === 0 && host.disconnectedAt && now - host.disconnectedAt > config.hostGraceMs) {
        room.transferHost()
        room.changed()
      }
      if (room.phase === 'WAITING' || room.phase === 'RESULT') {
        for (const p of room.members) {
          if (p.sockets.size === 0 && p.disconnectedAt && now - p.disconnectedAt > config.waitingDropMs) {
            room.removePlayer(p.id, 'timeout')
          }
        }
      }
    }
  }

  startSweeping(intervalMs = 5_000) {
    this.sweepTimer = setInterval(() => this.sweep(), intervalMs)
    this.sweepTimer.unref()
  }

  stop() {
    if (this.sweepTimer) clearInterval(this.sweepTimer)
    for (const r of [...this.rooms.values()]) this.dispose(r, 'shutdown')
  }
}

export type { ChatMessage }
