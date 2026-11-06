import {
  chatSendSchema,
  configureSchema,
  createRoomSchema,
  gameActionSchema,
  joinRoomSchema,
  resumeSchema,
  type Ack,
  type ClientToServerEvents,
  type ErrorCode,
  type JoinResult,
  type ServerToClientEvents,
} from '@relay/shared'
import type { Server, Socket } from 'socket.io'
import type { ZodType } from 'zod'
import type { Room, Player } from '../rooms/Room.js'
import type { RoomManager } from '../rooms/RoomManager.js'
import { createLimits } from '../services/rateLimit.js'

type IO = Server<ClientToServerEvents, ServerToClientEvents>
type S = Socket<ClientToServerEvents, ServerToClientEvents>

const err = (code: ErrorCode, message: string): Ack<never> => ({ ok: false, error: { code, message } })
const roomChannel = (code: string) => `room:${code}`

export function defaultSessionName(code: string) {
  return `공유 세션 ${code.slice(0, 3)}`
}

export function registerSocketHandlers(io: IO, rooms: RoomManager) {
  io.on('connection', (socket: S) => {
    const limits = createLimits()
    let current: { room: Room; player: Player } | null = null

    /** 콜백 누락/예외에 안전한 래퍼 */
    function handle<P, R>(
      event: keyof ClientToServerEvents,
      schema: ZodType<P, any, any> | null,
      fn: (payload: P) => Ack<R> | Promise<Ack<R>>,
    ) {
      socket.on(event as any, async (raw: unknown, ack: unknown) => {
        const reply = typeof ack === 'function' ? (ack as (r: Ack<R>) => void) : () => {}
        try {
          let payload = raw as P
          if (schema) {
            const parsed = schema.safeParse(raw ?? {})
            if (!parsed.success) return reply(err('INVALID', parsed.error.issues[0]?.message ?? '잘못된 요청입니다'))
            payload = parsed.data
          }
          reply(await fn(payload))
        } catch (e) {
          console.error(`[socket] ${String(event)} failed`, e)
          reply(err('INTERNAL', '처리 중 오류가 발생했습니다'))
        }
      })
    }

    function bind(room: Room, player: Player): JoinResult {
      if (current && (current.room !== room || current.player !== player)) detach()
      current = { room, player }
      socket.join(roomChannel(room.code))
      room.attachSocket(player, socket.id)
      return { token: player.token, snapshot: room.snapshotFor(player.id), chat: room.chat.slice(-100) }
    }

    function detach() {
      if (!current) return
      socket.leave(roomChannel(current.room.code))
      current.room.detachSocket(current.player, socket.id)
      current = null
    }

    function need(): { room: Room; player: Player } | Ack<never> {
      if (!current || current.room.disposed || !current.room.players.has(current.player.id))
        return err('NOT_IN_ROOM', '참여 중인 세션이 없습니다')
      return current
    }

    handle('room:create', createRoomSchema, (p) => {
      if (!limits.room.take()) return err('RATE_LIMITED', '잠시 후 다시 시도하세요')
      const room = rooms.create('', p.gameType)
      if (!room) return err('FULL', '서버가 혼잡합니다. 잠시 후 다시 시도하세요')
      room.name = p.sessionName?.trim() || defaultSessionName(room.code)
      room.event({ code: 'room_created', name: room.name })
      const player = room.addPlayer(p.name)!
      if (p.settings) room.configure(player.id, { settings: p.settings })
      return { ok: true, data: bind(room, player) }
    })

    handle('room:join', joinRoomSchema, (p) => {
      if (!limits.room.take()) return err('RATE_LIMITED', '잠시 후 다시 시도하세요')
      const room = rooms.get(p.code)
      if (!room) return err('NOT_FOUND', '세션을 찾을 수 없습니다. 코드를 확인하세요')
      const existing = p.token ? room.findByToken(p.token) : undefined
      if (existing) return { ok: true, data: bind(room, existing) }
      const player = room.addPlayer(p.name)
      if (!player) return err('FULL', '세션 인원이 가득 찼습니다')
      return { ok: true, data: bind(room, player) }
    })

    handle('session:resume', resumeSchema, (p) => {
      const room = rooms.get(p.code)
      if (!room) return err('NOT_FOUND', '세션이 종료되었습니다')
      const player = room.findByToken(p.token)
      if (!player) return err('NOT_FOUND', '세션 참가 정보가 만료되었습니다')
      return { ok: true, data: bind(room, player) }
    })

    handle('room:peek', null, (p: { code?: unknown }) => {
      const code = typeof p?.code === 'string' ? p.code.trim().toUpperCase() : ''
      const room = rooms.get(code)
      if (!room) return err('NOT_FOUND', '세션을 찾을 수 없습니다')
      return { ok: true, data: { name: room.name, members: room.players.size, phase: room.phase } }
    })

    handle('room:leave', null, () => {
      const c = need()
      if ('ok' in c) return c
      const { room, player } = c
      detach()
      room.removePlayer(player.id, 'leave')
      if (room.players.size === 0) rooms.dispose(room, 'empty')
      return { ok: true, data: undefined }
    })

    handle('room:configure', configureSchema, (p) => {
      const c = need()
      if ('ok' in c) return c
      const r = c.room.configure(c.player.id, p)
      return r.ok ? { ok: true, data: undefined } : err(r.code, r.message)
    })

    handle('chat:send', chatSendSchema, (p) => {
      const c = need()
      if ('ok' in c) return c
      if (!limits.chat.take()) return err('RATE_LIMITED', '메시지를 너무 빠르게 보내고 있습니다')
      c.room.say(c.player, p.text)
      return { ok: true, data: undefined }
    })

    handle('game:start', null, () => {
      const c = need()
      if ('ok' in c) return c
      const r = c.room.start(c.player.id)
      return r.ok ? { ok: true, data: undefined } : err(r.code, r.message)
    })

    handle('game:stop', null, () => {
      const c = need()
      if ('ok' in c) return c
      const r = c.room.stop(c.player.id)
      return r.ok ? { ok: true, data: undefined } : err(r.code, r.message)
    })

    handle('game:action', gameActionSchema, (a) => {
      const c = need()
      if ('ok' in c) return c
      if (!limits.action.take()) return err('RATE_LIMITED', '요청이 너무 많습니다')
      const r = c.room.action(c.player.id, a)
      return r.ok ? { ok: true, data: undefined } : err(r.code, r.message)
    })

    socket.on('disconnect', () => detach())
  })
}

/** 방의 상태 변화를 참가자별 개인화 스냅샷으로 전송 (같은 tick 변경은 1회로 합침) */
export function createBroadcaster(io: IO) {
  const pending = new Set<Room>()
  return {
    onChange(room: Room) {
      if (pending.has(room)) return
      pending.add(room)
      queueMicrotask(() => {
        pending.delete(room)
        if (room.disposed) return
        for (const p of room.players.values()) {
          if (p.sockets.size === 0) continue
          const snap = room.snapshotFor(p.id)
          for (const sid of p.sockets) io.to(sid).emit('room:state', snap)
        }
      })
    },
    onChat(room: Room, msg: Parameters<ServerToClientEvents['chat:message']>[0]) {
      io.to(roomChannel(room.code)).emit('chat:message', msg)
    },
    onDispose(room: Room) {
      io.to(roomChannel(room.code)).emit('room:closed', { reason: '세션이 종료되었습니다' })
      io.in(roomChannel(room.code)).socketsLeave(roomChannel(room.code))
    },
  }
}
