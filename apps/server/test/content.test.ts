import { describe, expect, it } from 'vitest'
import { LIAR_CATEGORIES, QUIZ_CATEGORIES } from '@relay/shared'
import { LIAR_WORDS, QUIZ_BANK, START_WORDS, TWENTY_BANK, matchesAnswer, normalizeAnswer, type WordEntry } from '../src/content/index.js'
import { pickFresh } from '../src/games/fresh.js'
import { validateWordFormat } from '../src/games/wordchain/WordchainGame.js'
import { rankQuiz } from '../src/games/quiz/QuizGame.js'

function checkWords(list: WordEntry[], minPerCategory: number) {
  const ids = new Set<string>()
  const byCat = new Map<string, Set<string>>()
  for (const w of list) {
    expect(ids.has(w.id), `id 중복 ${w.id}`).toBe(false)
    ids.add(w.id)
    expect(w.text.trim(), w.id).toBe(w.text)
    expect(w.text.length).toBeGreaterThan(0)
    const set = byCat.get(w.categoryId) ?? new Set()
    // 같은 카테고리 안에서 정답·별칭이 서로 겹치면 안 된다
    for (const form of [w.text, ...w.aliases].map(normalizeAnswer)) {
      expect(set.has(form), `${w.categoryId}: '${form}' 충돌`).toBe(false)
      set.add(form)
    }
    byCat.set(w.categoryId, set)
  }
  for (const [cat, set] of byCat) expect(set.size, cat).toBeGreaterThanOrEqual(minPerCategory)
  return byCat
}

describe('content data', () => {
  it('liar words: 12 categories, 331 words, unique ids, no alias conflicts', () => {
    const cats = checkWords(LIAR_WORDS, 20)
    expect(LIAR_WORDS).toHaveLength(331)
    expect(new Set(cats.keys())).toEqual(new Set(LIAR_CATEGORIES.filter((c) => c !== 'random')))
  })

  it('quiz bank: 125 questions, 4 unique choices, valid answer index, enough per category', () => {
    expect(QUIZ_BANK).toHaveLength(125)
    const ids = new Set<string>()
    for (const q of QUIZ_BANK) {
      expect(ids.has(q.id)).toBe(false)
      ids.add(q.id)
      expect(q.question.trim().length).toBeGreaterThan(0)
      expect(q.choices).toHaveLength(4)
      expect(new Set(q.choices.map((c) => c.trim())).size, q.id).toBe(4)
      expect(q.correctIndex).toBeGreaterThanOrEqual(0)
      expect(q.correctIndex).toBeLessThan(4)
    }
    for (const c of QUIZ_CATEGORIES.filter((c) => c !== 'random')) {
      expect(QUIZ_BANK.filter((q) => q.categoryId === c).length, c).toBeGreaterThanOrEqual(10)
    }
  })

  it('twenty bank: 120 answers; start words: 60 valid unique words', () => {
    checkWords(TWENTY_BANK, 20)
    expect(TWENTY_BANK).toHaveLength(120)
    expect(new Set(START_WORDS).size).toBe(60)
    for (const w of START_WORDS) expect(validateWordFormat(w), w).toBeNull()
  })

  it('answer matching: NFC, spaces, case, aliases only — no partial matches', () => {
    expect(matchesAnswer(' 짜 장 면 ', '짜장면')).toBe(true)
    expect(matchesAnswer('자장면', '짜장면', ['자장면'])).toBe(true)
    expect(matchesAnswer('ktx', 'KTX')).toBe(true)
    expect(matchesAnswer('짜장', '짜장면')).toBe(false)
    expect(matchesAnswer('', '짜장면')).toBe(false)
    expect(matchesAnswer('짜장면'.normalize('NFD'), '짜장면')).toBe(true)
  })

  it('pickFresh avoids recent items and falls back when the pool is small', () => {
    const pool = Array.from({ length: 30 }, (_, i) => ({ id: `x${i}` }))
    let recent: string[] = []
    let seed = 1
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    const seen: string[] = []
    for (let i = 0; i < 10; i++) {
      const r = pickFresh(recent, pool, 1, rnd)
      seen.push(r.picked[0].id)
      recent = r.recent
    }
    expect(new Set(seen).size).toBe(10) // 최근 10개 안에서 반복 없음
    expect(pickFresh(['a'], [{ id: 'a' }], 1, rnd).picked).toEqual([{ id: 'a' }])
  })

  it('quiz ranking: score → correct count → time; full ties share a rank', () => {
    const r = rankQuiz([
      { playerId: 'a', score: 300, correct: 2, timeMs: 5000 },
      { playerId: 'b', score: 300, correct: 2, timeMs: 3000 },
      { playerId: 'c', score: 300, correct: 3, timeMs: 9000 },
      { playerId: 'd', score: 300, correct: 2, timeMs: 5000 },
      { playerId: 'e', score: 100, correct: 1, timeMs: 1000 },
    ])
    expect(r.map((x) => [x.playerId, x.rank])).toEqual([
      ['c', 1],
      ['b', 2],
      ['a', 3],
      ['d', 3],
      ['e', 5],
    ])
  })
})

describe('v2.1 review checks', () => {
  it('QUIZ_POOL_SIZE in shared matches the real bank (UI shows the right per-category max)', async () => {
    const { QUIZ_POOL_SIZE } = await import('@relay/shared')
    for (const c of QUIZ_CATEGORIES) {
      const n = QUIZ_BANK.filter((q) => q.enabled && (c === 'random' || q.categoryId === c)).length
      expect(QUIZ_POOL_SIZE[c], c).toBe(n)
    }
  })

  it('multiple aliases are separate array items and each matches', () => {
    const w = LIAR_WORDS.find((x) => x.text === '철인3종')!
    expect(w.aliases).toEqual(['철인삼종', '트라이애슬론'])
    for (const t of ['철인3종', '철인 삼종', '트라이애슬론']) expect(matchesAnswer(t, w.text, w.aliases), t).toBe(true)
    expect(matchesAnswer('철인삼종/트라이애슬론', w.text, w.aliases)).toBe(false)
  })

  it('twenty free-input answers are validated by the action schema', async () => {
    const { gameActionSchema } = await import('@relay/shared')
    const ok = (answer: string, category = '음식') => gameActionSchema.safeParse({ type: 'twenty.setup', answer, category }).success
    expect(ok('김치찌개')).toBe(true)
    expect(ok('a')).toBe(false)
    expect(ok('가'.repeat(21))).toBe(false)
    expect(ok('<script>')).toBe(false)
    expect(ok('김치', '음식<>')).toBe(false)
  })
})
