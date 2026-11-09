import {
  QUIZ_CATEGORY_LABEL,
  type GameAction,
  type QuizCategory,
  type QuizSettings,
  type QuizStage,
  type QuizView,
} from '@relay/shared'
import { fail, ok, shuffle, type ActionResult, type GameContext, type GameEngine } from '../types.js'
import { QUIZ_BANK } from '../../content/index.js'

export const REVEAL_MS = 3_000
const BASE_POINTS = 100
const SPEED_BONUS = 50

interface PreparedQuestion {
  text: string
  choices: string[]
  correctIndex: number
}

export class QuizGame implements GameEngine {
  readonly type = 'quiz' as const
  private stage: QuizStage = 'question'
  private questions: PreparedQuestion[] = []
  private index = 0
  private participants: string[] = []
  private answers = new Map<string, { choice: number; at: number }>()
  private questionStartedAt = 0
  deadline: number | null = null
  private scores = new Map<string, number>()
  private correctCount = new Map<string, number>()
  /** 정답을 맞힌 문항의 소요 시간 합 (동점 순위 결정용) */
  private correctTime = new Map<string, number>()
  private reveal: QuizView['reveal'] = null
  private ranking: QuizView['ranking'] = null
  private cancelTimer: (() => void) | null = null
  private categoryLabel = ''

  constructor(private ctx: GameContext<QuizSettings>) {}

  start() {
    const r = this.ctx.random
    const cat: QuizCategory = this.ctx.settings.category
    this.categoryLabel = QUIZ_CATEGORY_LABEL[cat]
    const pool = quizPool(cat)
    const picked = this.ctx.pickFresh(`quiz:${cat}`, pool, Math.min(this.ctx.settings.questionCount, pool.length))
    this.questions = picked.map((q) => {
      const order = shuffle([0, 1, 2, 3], r)
      return { text: q.question, choices: order.map((i) => q.choices[i]), correctIndex: order.indexOf(q.correctIndex) }
    })
    this.participants = this.ctx.participants.map((p) => p.id)
    for (const id of this.participants) {
      this.scores.set(id, 0)
      this.correctCount.set(id, 0)
    }
    this.ctx.emit({ code: 'game_started', game: 'quiz', round: this.ctx.round })
    this.ask(0)
  }

  dispose() {
    this.clearTimer()
  }

  private clearTimer() {
    this.cancelTimer?.()
    this.cancelTimer = null
  }

  private schedule(ms: number, fn: () => void) {
    this.clearTimer()
    this.deadline = this.ctx.now() + ms
    this.cancelTimer = this.ctx.setTimer(ms, () => {
      this.cancelTimer = null
      fn()
    })
  }

  private name(id: string) {
    return this.ctx.participants.find((p) => p.id === id)?.name ?? '알 수 없음'
  }

  private ask(i: number) {
    this.index = i
    this.stage = 'question'
    this.answers.clear()
    this.reveal = null
    this.questionStartedAt = this.ctx.now()
    const q = this.questions[i]
    this.ctx.emit({ code: 'quiz_question', index: i, total: this.questions.length, text: q.text })
    this.schedule(this.ctx.settings.seconds * 1000, () => this.doReveal())
    this.ctx.changed()
  }

  private doReveal() {
    this.clearTimer()
    const q = this.questions[this.index]
    const total = this.ctx.settings.seconds * 1000
    const answers: Record<string, number | null> = {}
    const gained: Record<string, number> = {}
    for (const id of this.participants) {
      const a = this.answers.get(id)
      answers[id] = a ? a.choice : null
      let g = 0
      if (a && a.choice === q.correctIndex) {
        const elapsed = Math.max(0, a.at - this.questionStartedAt)
        g = BASE_POINTS + Math.floor((SPEED_BONUS * Math.max(0, total - elapsed)) / total)
        this.correctCount.set(id, (this.correctCount.get(id) ?? 0) + 1)
        this.correctTime.set(id, (this.correctTime.get(id) ?? 0) + Math.min(elapsed, total))
      }
      gained[id] = g
      this.scores.set(id, (this.scores.get(id) ?? 0) + g)
    }
    this.reveal = { correctIndex: q.correctIndex, answers, gained }
    this.stage = 'reveal'
    this.ctx.emit({
      code: 'quiz_reveal',
      index: this.index,
      answer: q.choices[q.correctIndex],
      correctNames: this.participants.filter((id) => gained[id] > 0).map((id) => this.name(id)),
    })
    const last = this.index >= this.questions.length - 1
    this.schedule(REVEAL_MS, () => (last ? this.finishGame() : this.ask(this.index + 1)))
    this.ctx.changed()
  }

  private finishGame() {
    this.clearTimer()
    this.stage = 'result'
    this.deadline = null
    const all = new Set([...this.scores.keys()])
    this.ranking = rankQuiz(
      [...all].map((id) => ({
        playerId: id,
        score: this.scores.get(id) ?? 0,
        correct: this.correctCount.get(id) ?? 0,
        timeMs: this.correctTime.get(id) ?? 0,
      })),
    )
    this.ctx.emit({
      code: 'quiz_result',
      ranking: this.ranking.map((r) => ({ name: this.name(r.playerId), score: r.score, rank: r.rank })),
    })
    this.ctx.finish()
    this.ctx.changed()
  }

  action(playerId: string, action: GameAction): ActionResult {
    if (action.type !== 'quiz.answer') return fail('INVALID', '지원하지 않는 동작입니다')
    if (this.stage !== 'question') return fail('BAD_STATE', '응답을 받는 중이 아닙니다')
    if (!this.participants.includes(playerId)) return fail('FORBIDDEN', '참가자만 응답할 수 있습니다')
    if (this.answers.has(playerId)) return fail('BAD_STATE', '이미 응답을 제출했습니다')
    if (this.deadline !== null && this.ctx.now() > this.deadline) return fail('BAD_STATE', '제한 시간이 지났습니다')
    this.answers.set(playerId, { choice: action.choice, at: this.ctx.now() })
    if (this.allAnswered()) this.doReveal()
    else this.ctx.changed()
    return ok
  }

  private allAnswered() {
    return this.participants.every((id) => this.answers.has(id) || !this.ctx.isConnected(id))
  }

  playerGone() {
    if (this.stage === 'question' && this.allAnswered()) this.doReveal()
  }

  playerLeft(playerId: string) {
    if (!this.participants.includes(playerId) || this.stage === 'result') return
    this.participants = this.participants.filter((p) => p !== playerId)
    this.answers.delete(playerId)
    if (this.participants.length === 0) return this.finishGame()
    if (this.stage === 'question' && this.allAnswered()) return this.doReveal()
    this.ctx.changed()
  }

  view(playerId: string | null): QuizView {
    const q = this.questions[this.index]
    return {
      type: 'quiz',
      round: this.ctx.round,
      stage: this.stage,
      category: this.categoryLabel,
      index: this.index,
      total: this.questions.length,
      question: this.stage === 'result' || !q ? null : { text: q.text, choices: q.choices.slice() },
      deadline: this.stage === 'result' ? null : this.deadline,
      participants: this.participants.slice(),
      answeredIds: this.stage === 'question' ? [...this.answers.keys()] : [],
      myAnswer: playerId ? (this.answers.get(playerId)?.choice ?? this.reveal?.answers[playerId] ?? null) : null,
      reveal: this.reveal,
      scores: Object.fromEntries(this.scores),
      ranking: this.ranking,
    }
  }
}

export function quizPool(cat: QuizCategory) {
  return QUIZ_BANK.filter((q) => q.enabled && (cat === 'random' || q.categoryId === cat))
}

/** 총점 ↓ → 정답 수 ↓ → 정답 소요 시간 합 ↑. 세 값이 모두 같으면 공동 순위 */
export function rankQuiz(rows: { playerId: string; score: number; correct: number; timeMs: number }[]) {
  const sorted = rows.slice().sort((a, b) => b.score - a.score || b.correct - a.correct || a.timeMs - b.timeMs)
  return sorted.map((r, i) => {
    let rank = i + 1
    for (let j = i - 1; j >= 0; j--) {
      const p = sorted[j]
      if (p.score === r.score && p.correct === r.correct && p.timeMs === r.timeMs) rank = j + 1
      else break
    }
    return { ...r, rank }
  })
}
