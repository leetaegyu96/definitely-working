import type { GameType } from '@relay/shared'
import { BaseballGame } from './baseball/BaseballGame.js'
import { LiarGame } from './liar/LiarGame.js'
import { MafiaGame } from './mafia/MafiaGame.js'
import { QuizGame } from './quiz/QuizGame.js'
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
