/** 소켓별 토큰 버킷. capacity개까지 즉시 허용, refillPerSec 속도로 회복 */
export class TokenBucket {
  private tokens: number
  private last = Date.now()
  constructor(
    private capacity: number,
    private refillPerSec: number,
  ) {
    this.tokens = capacity
  }
  take(): boolean {
    const now = Date.now()
    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.last) / 1000) * this.refillPerSec)
    this.last = now
    if (this.tokens < 1) return false
    this.tokens -= 1
    return true
  }
}

export function createLimits() {
  return {
    chat: new TokenBucket(6, 1.2),
    action: new TokenBucket(10, 4),
    room: new TokenBucket(6, 0.1),
    /** 이미지: 연속 3장, 이후 약 7초에 1장 */
    image: new TokenBucket(3, 0.15),
  }
}
