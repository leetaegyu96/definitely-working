function normalizeBase(v: string | undefined) {
  if (!v || v === '/') return '/'
  return '/' + v.replace(/^\/+|\/+$/g, '') + '/'
}

const num = (v: string | undefined, d: number) => (v && !Number.isNaN(Number(v)) ? Number(v) : d)

export const config = {
  port: num(process.env.PORT, 3001),
  /** 접속자가 아무도 없는 방을 정리하기까지의 시간 */
  roomIdleMs: num(process.env.ROOM_IDLE_MINUTES, 30) * 60_000,
  /** 호스트 연결이 끊긴 뒤 위임까지 대기 */
  hostGraceMs: num(process.env.HOST_GRACE_SECONDS, 20) * 1000,
  /** 대기/결과 단계에서 끊긴 참가자를 목록에서 제거하기까지 */
  waitingDropMs: num(process.env.WAITING_DROP_MINUTES, 3) * 60_000,
  maxRooms: num(process.env.MAX_ROOMS, 500),
  /** 쉼표로 여러 개 지정 가능. 비우면 모두 허용 */
  corsOrigin: process.env.CORS_ORIGIN?.trim() ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim()) : ('*' as string | string[]),
  /** 하위 경로 배포 (예: /definitely-working/) — 웹 빌드의 BASE_PATH 와 같아야 함 */
  basePath: normalizeBase(process.env.BASE_PATH),
}
