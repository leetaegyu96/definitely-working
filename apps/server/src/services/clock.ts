/** 시간/난수/타이머 추상화 — 테스트에서 가짜 시계로 교체 가능 */
export interface Clock {
  now(): number
  random(): number
  setTimer(ms: number, fn: () => void): () => void
}

export const realClock: Clock = {
  now: () => Date.now(),
  random: () => Math.random(),
  setTimer(ms, fn) {
    const t = setTimeout(fn, ms)
    return () => clearTimeout(t)
  },
}
