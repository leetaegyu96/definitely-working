export type Difficulty = 'easy' | 'normal' | 'hard'

export interface WordEntry {
  id: string
  categoryId: string
  text: string
  /** 정답으로 함께 인정하는 표기 (다른 독립 정답과 겹치면 안 된다) */
  aliases: string[]
  difficulty: Difficulty
  enabled: boolean
}

export interface QuizEntry {
  id: string
  categoryId: string
  difficulty: Difficulty
  question: string
  choices: [string, string, string, string] | string[]
  correctIndex: 0 | 1 | 2 | 3 | number
  explanation?: string
  enabled: boolean
}
