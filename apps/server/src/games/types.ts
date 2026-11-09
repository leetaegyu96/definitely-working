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
  /** 방에서 최근에 나온 콘텐츠를 피해 count개를 뽑는다 (최근 min(10, 보유량/2)개 제외) */
  pickFresh<T extends { id: string }>(key: string, pool: readonly T[], count: number): T[]
}

export interface GameEngine {
  readonly type: GameType
  /** 현재 단계의 마감 시각 (서버 기준 절대 시각). 이후 도착한 입력은 거부된다 */
  readonly deadline?: number | null
  start(): void
  action(playerId: string, action: GameAction, opts: { isHost: boolean }): ActionResult
  /** playerId === null 이면 관전자 시점 */
  view(playerId: string | null): GameView
  playerLeft(playerId: string): void
  /** 연결이 끊긴 채 유예 시간(10초)이 지났을 때. 없으면 아무 처리도 하지 않는다 */
  playerGone?(playerId: string): void
  /** 진행 중인 판에서 이미 빠진 사람(사망·탈락) — 관전자 채팅으로 분리 */
  isOut?(playerId: string): boolean
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
