import type { GameSettings, GameType } from '@relay/shared'
import { BaseballGame } from './baseball/BaseballGame.js'
import { LiarGame } from './liar/LiarGame.js'
import { MafiaGame } from './mafia/MafiaGame.js'
import { QuizGame, quizPool } from './quiz/QuizGame.js'
import { TwentyGame } from './twenty/TwentyGame.js'
import type { GameContext, GameEngine } from './types.js'
import { WordchainGame } from './wordchain/WordchainGame.js'

/** 게임 추가 시 여기에만 등록하면 된다 (테마는 game-ui 모델을 통해 표시) */
export function createEngine(type: GameType, ctx: GameContext<never>): GameEngine {
  const c = ctx as GameContext<any>
  switch (type) {
    case 'liar':
      return new LiarGame(c)
    case 'quiz':
      return new QuizGame(c)
    case 'mafia':
      return new MafiaGame(c)
    case 'wordchain':
      return new WordchainGame(c)
    case 'baseball':
      return new BaseballGame(c)
    case 'twenty':
      return new TwentyGame(c)
  }
}

/** 시작 전 콘텐츠 검사 (예: 고른 카테고리의 문항 수가 출제 개수보다 적으면 시작 거부) */
export function startCheck(type: GameType, settings: GameSettings): { ok: true } | { ok: false; reason: string } {
  if (type === 'quiz') {
    const n = quizPool(settings.quiz.category).length
    if (n < settings.quiz.questionCount)
      return { ok: false, reason: `이 분야의 문항이 ${n}개뿐입니다. 출제 개수를 ${n}개 이하로 줄이세요` }
  }
  return { ok: true }
}
