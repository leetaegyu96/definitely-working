import type { ChatMessage, RoomSnapshot } from '@relay/shared'
import { create } from 'zustand'
import { load, save } from '../lib/storage'

export type ConnStatus = 'connecting' | 'online' | 'reconnecting' | 'offline'

export interface Membership {
  code: string
  token: string
}

interface SessionState {
  status: ConnStatus
  snapshot: RoomSnapshot | null
  chat: ChatMessage[]
  /** serverNow - Date.now() */
  offset: number
  /** 초대 링크로 들어왔지만 아직 참여하지 않은 세션 코드 */
  pendingInvite: string | null
  notice: string | null
  membership: Membership | null
  resuming: boolean
  setStatus(s: ConnStatus): void
  setSnapshot(s: RoomSnapshot): void
  setChat(c: ChatMessage[]): void
  addChat(m: ChatMessage): void
  setPendingInvite(c: string | null): void
  setNotice(n: string | null): void
  setMembership(m: Membership | null): void
  setResuming(v: boolean): void
  clearRoom(notice?: string): void
}

const MEMBER_KEY = 'relay.membership.v1'

export const useSession = create<SessionState>((set) => ({
  status: 'connecting',
  snapshot: null,
  chat: [],
  offset: 0,
  pendingInvite: null,
  notice: null,
  membership: load<Membership | null>(MEMBER_KEY, null),
  resuming: false,
  setStatus: (status) => set({ status }),
  setSnapshot: (snapshot) => set({ snapshot, offset: snapshot.serverNow - Date.now() }),
  setChat: (chat) => set({ chat }),
  addChat: (m) =>
    set((s) => (s.chat.some((x) => x.id === m.id) ? s : { chat: [...s.chat, m].slice(-300) })),
  setPendingInvite: (pendingInvite) => set({ pendingInvite }),
  setNotice: (notice) => set({ notice }),
  setMembership: (membership) => {
    save(MEMBER_KEY, membership)
    set({ membership })
  },
  setResuming: (resuming) => set({ resuming }),
  clearRoom: (notice) => {
    save(MEMBER_KEY, null)
    set({ snapshot: null, chat: [], membership: null, notice: notice ?? null })
  },
}))
