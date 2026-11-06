import type { Clock } from '../src/services/clock.js'

export class FakeClock implements Clock {
  t = 1_000_000
  private timers: { at: number; fn: () => void; id: number }[] = []
  private seq = 0
  private seed = 42
  now = () => this.t
  random = () => {
    // deterministic LCG
    this.seed = (this.seed * 1664525 + 1013904223) % 4294967296
    return this.seed / 4294967296
  }
  setTimer = (ms: number, fn: () => void) => {
    const id = ++this.seq
    this.timers.push({ at: this.t + ms, fn, id })
    return () => {
      this.timers = this.timers.filter((x) => x.id !== id)
    }
  }
  advance(ms: number) {
    const end = this.t + ms
    for (;;) {
      this.timers.sort((a, b) => a.at - b.at || a.id - b.id)
      const next = this.timers[0]
      if (!next || next.at > end) break
      this.timers.shift()
      this.t = next.at
      next.fn()
    }
    this.t = end
  }
}
