import type { GameAction, GameType, GameView, SystemEvent } from '@relay/shared'

export interface Participant {
  id: string
  name: string
}

export type ActionResult = { ok: true } | { ok: false; code: 'BAD_STATE' | 'FORBIDDEN' | 'INVALID'; message: string }

/** 엔진이 방(Room)과 소통하는 유일한 통로. 테마/소켓은 전혀 모른다. */
export interface GameContext<S> {
  participants: Participant[]
  settings: S
  round: number
  now(): number
  random(): number
  setTimer(ms: number, fn: () => void): () => void
  isConnected(playerId: string): boolean
  emit(event: SystemEvent): void
  /** 상태가 바뀌었음을 알림 → 방이 참가자별 뷰를 재전송 */
  changed(): void
  /** 결과 단계 도달 */
  finish(): void
}

export interface GameEngine {
  readonly type: GameType
  start(): void
  action(playerId: string, action: GameAction, opts: { isHost: boolean }): ActionResult
  /** playerId === null 이면 관전자 시점 */
  view(playerId: string | null): GameView
  playerLeft(playerId: string): void
  dispose(): void
}

export const ok: ActionResult = { ok: true }
export const fail = (code: 'BAD_STATE' | 'FORBIDDEN' | 'INVALID', message: string): ActionResult => ({
  ok: false,
  code,
  message,
})

export function shuffle<T>(arr: T[], random: () => number): T[] {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
