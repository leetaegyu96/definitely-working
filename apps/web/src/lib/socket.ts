import type { ClientToServerEvents, ServerToClientEvents } from '@relay/shared'
import { io, type Socket } from 'socket.io-client'
import { useSession } from '../stores/session'
import { BASE, resetToHome } from './paths'

const SERVER_URL = (import.meta.env.VITE_SERVER_URL as string | undefined) || undefined

export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(SERVER_URL ?? '', {
  path: `${BASE}socket.io`,
  transports: ['websocket', 'polling'],
  reconnectionDelay: 800,
  reconnectionDelayMax: 5000,
})

const st = () => useSession.getState()

socket.on('connect', () => {
  st().setStatus('online')
  const m = st().membership
  if (!m) return
  st().setResuming(true)
  socket.emit('session:resume', { code: m.code, token: m.token }, (r) => {
    st().setResuming(false)
    if (r.ok) {
      st().setSnapshot(r.data.snapshot)
      st().setChat(r.data.chat)
    } else {
      st().clearRoom(r.error.code === 'NOT_FOUND' ? '이전 세션이 종료되어 연결할 수 없습니다.' : r.error.message)
      resetToHome()
    }
  })
})

socket.on('disconnect', () => st().setStatus(st().snapshot ? 'reconnecting' : 'offline'))
socket.io.on('reconnect_attempt', () => st().setStatus(st().snapshot ? 'reconnecting' : 'connecting'))
socket.on('room:state', (s) => st().setSnapshot(s))
socket.on('chat:message', (m) => st().addChat(m))
socket.on('room:closed', ({ reason }) => {
  st().clearRoom(reason)
  resetToHome()
})
