import { shuffle } from './types.js'

/**
 * 최근 출제 이력을 피해서 뽑는다. 이력 길이는 min(10, floor(보유량/2)).
 * 후보가 부족하면 이력을 무시하고 전체에서 뽑는다.
 */
export function pickFresh<T extends { id: string }>(
  recent: string[],
  pool: readonly T[],
  count: number,
  random: () => number,
): { picked: T[]; recent: string[] } {
  const keep = Math.min(10, Math.floor(pool.length / 2))
  const blocked = new Set(recent.slice(-keep))
  let candidates = pool.filter((x) => !blocked.has(x.id))
  if (candidates.length < count) candidates = pool.slice()
  const picked = shuffle(candidates, random).slice(0, count)
  const next = [...recent, ...picked.map((p) => p.id)].slice(-Math.max(keep, 1))
  return { picked, recent: next }
}
