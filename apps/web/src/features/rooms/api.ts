import type {
  Ack,
  ClientToServerEvents,
  ConfigurePayload,
  CreateRoomPayload,
  GameAction,
  JoinResult,
  RoomPhase,
} from '@relay/shared'
import { homePath, sessionPath } from '../../lib/paths'
import { socket } from '../../lib/socket'
import { useSession } from '../../stores/session'

function call<T = undefined>(event: keyof ClientToServerEvents, payload: unknown, timeoutMs = 8000): Promise<Ack<T>> {
  return new Promise((resolve) => {
    if (!socket.connected) {
      resolve({ ok: false, error: { code: 'INTERNAL', message: '서버에 연결되어 있지 않습니다. 잠시 후 다시 시도하세요.' } })
      return
    }
    const timer = setTimeout(
      () => resolve({ ok: false, error: { code: 'INTERNAL', message: '응답 시간이 초과되었습니다' } }),
      timeoutMs,
    )
    ;(socket.emit as (...a: unknown[]) => void)(event, payload, (r: Ack<T>) => {
      clearTimeout(timer)
      resolve(r)
    })
  })
}

function adopt(r: Ack<JoinResult>) {
  if (!r.ok) return r
  const s = useSession.getState()
  s.setMembership({ code: r.data.snapshot.code, token: r.data.token })
  s.setSnapshot(r.data.snapshot)
  s.setChat(r.data.chat)
  s.setPendingInvite(null)
  s.setNotice(null)
  history.replaceState(null, '', sessionPath(r.data.snapshot.code))
  return r
}

export { inviteUrl } from '../../lib/paths'

export async function createSession(p: CreateRoomPayload) {
  return adopt(await call<JoinResult>('room:create', p))
}

export async function joinSession(code: string, name: string) {
  const m = useSession.getState().membership
  const token = m && m.code === code.toUpperCase() ? m.token : undefined
  return adopt(await call<JoinResult>('room:join', { code, name, token }))
}

export function peekSession(code: string) {
  return call<{ name: string; members: number; phase: RoomPhase }>('room:peek', { code })
}

export async function leaveSession() {
  const r = await call('room:leave', {})
  useSession.getState().clearRoom()
  history.replaceState(null, '', homePath())
  return r
}

export const configureSession = (p: ConfigurePayload) => call('room:configure', p)
export const sendChat = (text: string) => call('chat:send', { text })
export const startGame = () => call('game:start', {})
export const stopGame = () => call('game:stop', {})
export const gameAction = (a: GameAction) => call('game:action', a)
