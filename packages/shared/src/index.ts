/**
 * Shared contract between web client and server.
 * - Types for room / player / chat / game views
 * - Socket event names (client→server requests, server→client notifications)
 * - Zod schemas for every client→server payload (validated on the server)
 */
import { z } from 'zod'

/* ───────────────────────── Limits ───────────────────────── */

export const LIMITS = {
  nameMax: 16,
  sessionNameMax: 40,
  chatMax: 300,
  describeMax: 80,
  guessMax: 30,
  maxMembers: 16, // players + spectators
  chatHistory: 150,
  /** 이미지 data URL 최대 길이 (약 650KB) */
  imageMax: 900_000,
  /** 세션당 보관하는 최근 이미지 수 (서버 메모리 보호) */
  imagesKept: 8,
} as const

/* ───────────────────────── Games ───────────────────────── */

export type GameType = 'liar' | 'quiz' | 'mafia' | 'wordchain' | 'baseball' | 'twenty'
export const GAME_TYPES: GameType[] = ['liar', 'quiz', 'mafia', 'wordchain', 'baseball', 'twenty']

export interface GameMeta {
  id: GameType
  /** 실제 게임명 (세션 생성 화면 보조 설명에만 노출) */
  title: string
  /** 업무 화면에 노출되는 이름 */
  workTitle: string
  workDesc: string
  minPlayers: number
  maxPlayers: number
}

export const GAME_META: Record<GameType, GameMeta> = {
  liar: {
    id: 'liar',
    title: '라이어 게임',
    workTitle: 'Blind Review',
    workDesc: '키워드를 모르는 1명을 설명과 투표로 찾아냅니다.',
    minPlayers: 3,
    maxPlayers: 10,
  },
  quiz: {
    id: 'quiz',
    title: '퀴즈 대결',
    workTitle: 'Knowledge Check',
    workDesc: '4지선다 문항을 풀고 점수를 집계합니다. 혼자서도 진행할 수 있습니다.',
    minPlayers: 1,
    maxPlayers: 12,
  },
  mafia: {
    id: 'mafia',
    title: '마피아',
    workTitle: 'Access Audit',
    workDesc: '숨어 있는 내부자(마피아)를 낮 토론과 투표로 찾아냅니다.',
    minPlayers: 5,
    maxPlayers: 12,
  },
  wordchain: {
    id: 'wordchain',
    title: '끝말잇기',
    workTitle: 'Term Chain',
    workDesc: '앞 단어의 끝 글자로 시작하는 단어를 차례로 잇습니다.',
    minPlayers: 2,
    maxPlayers: 10,
  },
  baseball: {
    id: 'baseball',
    title: '숫자 야구',
    workTitle: 'Code Match',
    workDesc: '숨겨진 숫자 조합을 스트라이크·볼 힌트로 추리합니다. 혼자서도 진행할 수 있습니다.',
    minPlayers: 1,
    maxPlayers: 8,
  },
  twenty: {
    id: 'twenty',
    title: '스무고개',
    workTitle: 'Requirement Discovery',
    workDesc: '출제자가 정한 답을 예/아니오 질문으로 맞힙니다.',
    minPlayers: 2,
    maxPlayers: 10,
  },
}

export const LIAR_CATEGORIES = ['random', 'food', 'animal', 'place', 'job', 'object', 'sports', 'hobby', 'transport', 'work', 'nature', 'gadget', 'emotion'] as const
export type LiarCategory = (typeof LIAR_CATEGORIES)[number]
export const LIAR_CATEGORY_LABEL: Record<LiarCategory, string> = {
  random: '무작위',
  food: '음식',
  animal: '동물',
  place: '장소',
  job: '직업',
  object: '사물',
  sports: '스포츠',
  hobby: '취미',
  transport: '교통수단',
  work: '학교·회사',
  nature: '자연·날씨',
  gadget: '전자기기',
  emotion: '감정·상황',
}

export const QUIZ_CATEGORIES = ['random', 'general', 'it', 'science', 'history', 'language', 'media', 'life'] as const
export type QuizCategory = (typeof QUIZ_CATEGORIES)[number]
export const QUIZ_CATEGORY_LABEL: Record<QuizCategory, string> = {
  random: '전체',
  general: '일반 상식',
  it: 'IT·개발',
  science: '과학',
  history: '역사',
  language: '언어·문학',
  media: '영화·게임',
  life: '음식·생활',
}

export const liarSettingsSchema = z.object({
  category: z.enum(LIAR_CATEGORIES).default('random'),
  describeSeconds: z.number().int().min(15).max(60).default(25),
  discussSeconds: z.number().int().min(0).max(180).default(60),
})
export const quizSettingsSchema = z.object({
  category: z.enum(QUIZ_CATEGORIES).default('random'),
  questionCount: z.number().int().min(3).max(15).default(7),
  seconds: z.number().int().min(10).max(45).default(20),
})
export const mafiaSettingsSchema = z.object({
  nightSeconds: z.number().int().min(15).max(60).default(30),
  discussSeconds: z.number().int().min(0).max(180).default(75),
  voteSeconds: z.number().int().min(15).max(60).default(30),
})
export const wordchainSettingsSchema = z.object({
  turnSeconds: z.number().int().min(5).max(45).default(15),
})
export const baseballSettingsSchema = z.object({
  digits: z.number().int().min(3).max(4).default(3),
  maxRounds: z.number().int().min(5).max(20).default(10),
  roundSeconds: z.number().int().min(15).max(90).default(30),
})
export const twentySettingsSchema = z.object({
  maxQuestions: z.number().int().min(10).max(30).default(20),
  setupSeconds: z.number().int().min(15).max(60).default(30),
  /** 출제자가 정답을 직접 입력하는 고급 옵션 (기본: 정답 은행에서 뽑기) */
  freeInput: z.boolean().default(false),
})
export type LiarSettings = z.infer<typeof liarSettingsSchema>
export type QuizSettings = z.infer<typeof quizSettingsSchema>
export type MafiaSettings = z.infer<typeof mafiaSettingsSchema>
export type WordchainSettings = z.infer<typeof wordchainSettingsSchema>
export type BaseballSettings = z.infer<typeof baseballSettingsSchema>
export type TwentySettings = z.infer<typeof twentySettingsSchema>
export interface GameSettings {
  liar: LiarSettings
  quiz: QuizSettings
  mafia: MafiaSettings
  wordchain: WordchainSettings
  baseball: BaseballSettings
  twenty: TwentySettings
}
export const SETTINGS_SCHEMAS = {
  liar: liarSettingsSchema,
  quiz: quizSettingsSchema,
  mafia: mafiaSettingsSchema,
  wordchain: wordchainSettingsSchema,
  baseball: baseballSettingsSchema,
  twenty: twentySettingsSchema,
} as const
export const DEFAULT_SETTINGS: GameSettings = {
  liar: liarSettingsSchema.parse({}),
  quiz: quizSettingsSchema.parse({}),
  mafia: mafiaSettingsSchema.parse({}),
  wordchain: wordchainSettingsSchema.parse({}),
  baseball: baseballSettingsSchema.parse({}),
  twenty: twentySettingsSchema.parse({}),
}
/** 클라이언트가 보내는 부분 설정 */
export const partialSettingsSchema = z
  .object({
    liar: liarSettingsSchema.partial().optional(),
    quiz: quizSettingsSchema.partial().optional(),
    mafia: mafiaSettingsSchema.partial().optional(),
    wordchain: wordchainSettingsSchema.partial().optional(),
    baseball: baseballSettingsSchema.partial().optional(),
    twenty: twentySettingsSchema.partial().optional(),
  })
  .optional()

/* ───────────────────────── Room / player ───────────────────────── */

/** WAITING → STARTING → PLAYING → RESULT → (WAITING | STARTING) */
export type RoomPhase = 'WAITING' | 'STARTING' | 'PLAYING' | 'RESULT'

export interface PlayerInfo {
  id: string
  name: string
  connected: boolean
  /** 진행 중 합류한 관전자 — 다음 라운드부터 참여 */
  spectator: boolean
  joinedAt: number
}

export interface RoomSnapshot {
  code: string
  name: string
  createdAt: number
  hostId: string
  meId: string
  phase: RoomPhase
  /** STARTING 단계 종료 시각 */
  startsAt: number | null
  gameType: GameType
  settings: GameSettings
  players: PlayerInfo[]
  /** 이 사용자 시점으로 필터링된 게임 상태 (비밀 정보는 본인 것만) */
  game: GameView | null
  serverNow: number
}

/* ───────────────────────── Chat / events ───────────────────────── */

export type SystemEvent =
  | { code: 'room_created'; name: string }
  | { code: 'joined'; name: string; spectator: boolean }
  | { code: 'left'; name: string }
  | { code: 'host_changed'; name: string }
  | { code: 'game_selected'; game: GameType }
  | { code: 'game_starting'; game: GameType }
  | { code: 'game_started'; game: GameType; round: number }
  | { code: 'game_stopped'; by: string }
  | { code: 'game_aborted'; reason: string }
  | { code: 'liar_turn'; name: string }
  | { code: 'liar_described'; name: string; text: string; timedOut: boolean }
  | { code: 'liar_discuss'; seconds: number }
  | { code: 'liar_vote_open'; revote: boolean; candidates: string[] }
  | { code: 'liar_no_accused'; revote: boolean }
  | { code: 'liar_accused'; name: string; votes: number }
  | { code: 'liar_guess_open'; name: string }
  | {
      code: 'liar_result'
      winner: 'liar' | 'citizens' | 'none'
      liarName: string
      word: string
      guess: string | null
      reason: string
    }
  | { code: 'quiz_question'; index: number; total: number; text: string }
  | { code: 'quiz_reveal'; index: number; answer: string; correctNames: string[] }
  | { code: 'quiz_result'; ranking: { name: string; score: number; rank: number }[] }
  | { code: 'mafia_day'; day: number; maxDays: number }
  | { code: 'mafia_night'; day: number }
  | { code: 'mafia_dawn'; day: number; killedName: string | null }
  | { code: 'mafia_vote_open'; day: number }
  | { code: 'mafia_executed'; name: string | null; votes: number }
  | { code: 'mafia_gone'; name: string }
  | { code: 'mafia_result'; winner: 'mafia' | 'citizens' | 'none'; mafiaNames: string[]; reason: string }
  | { code: 'word_played'; name: string; word: string }
  | { code: 'word_out'; name: string; reason: 'timeout' | 'rejected' | 'left' }
  | { code: 'word_challenge'; by: string; word: string; author: string; seconds: number }
  | { code: 'word_challenge_result'; word: string; upheld: boolean; yes: number; needed: number }
  | { code: 'word_result'; winnerName: string | null; length: number }
  | { code: 'baseball_round'; round: number; results: { name: string; guess: string; strike: number; ball: number }[] }
  | { code: 'baseball_result'; winners: string[]; secret: string }
  | { code: 'twenty_ready'; setterName: string; category: string }
  | { code: 'twenty_asked'; name: string; text: string; kind: 'question' | 'guess' }
  | { code: 'twenty_replied'; text: string; reply: TwentyReply; kind: 'question' | 'guess'; correct: boolean }
  /** 오답 도전은 내용을 공개하지 않는다 */
  | { code: 'twenty_guessed'; name: string; correct: boolean }
  | { code: 'twenty_passed'; name: string }
  | { code: 'twenty_result'; winner: 'guessers' | 'setter' | 'none'; answer: string; solverName: string | null; reason?: string }

export interface ChatImage {
  dataUrl: string
  w: number
  h: number
}

export type ChatMessage =
  | {
      id: string
      ts: number
      type: 'chat'
      authorId: string
      authorName: string
      text: string
      image?: ChatImage
      /** 보관 개수를 넘어 서버에서 지워진 이미지 */
      imageExpired?: boolean
      /** 관전자·탈락자 전용 대화 (진행 중인 판에 영향을 주지 않도록 생존자에게는 보내지 않음) */
      scope?: 'out'
    }
  | { id: string; ts: number; type: 'event'; event: SystemEvent }

/* ───────────────────────── Game views (per player) ───────────────────────── */

export type LiarStage = 'describe' | 'discuss' | 'vote' | 'guess' | 'result'

export interface LiarView {
  type: 'liar'
  round: number
  stage: LiarStage
  category: string
  myRole: 'citizen' | 'liar' | 'spectator'
  /** 일반 참가자에게만 전달 (결과 단계에서는 result.word로 공개) */
  word: string | null
  order: string[]
  currentTurnId: string | null
  descriptions: { playerId: string; text: string; timedOut: boolean }[]
  deadline: number | null
  revote: boolean
  candidates: string[]
  votedIds: string[]
  /** undefined = 아직 투표 안 함, null = 기권 */
  myVote: string | null | undefined
  accusedId: string | null
  result: {
    winner: 'liar' | 'citizens' | 'none'
    liarId: string
    word: string
    guess: string | null
    reason: string
    /** 마지막 투표 내역 (null = 기권) */
    votes: Record<string, string | null>
  } | null
}

export type QuizStage = 'question' | 'reveal' | 'result'

export interface QuizView {
  type: 'quiz'
  round: number
  stage: QuizStage
  category: string
  index: number
  total: number
  question: { text: string; choices: string[] } | null
  deadline: number | null
  participants: string[]
  answeredIds: string[]
  myAnswer: number | null
  reveal: { correctIndex: number; answers: Record<string, number | null>; gained: Record<string, number> } | null
  scores: Record<string, number>
  /** 총점 → 정답 수 → 정답 소요 시간 합(짧을수록 위) 순. 모두 같으면 공동 순위 */
  ranking: { playerId: string; score: number; correct: number; timeMs: number; rank: number }[] | null
}

export type MafiaStage = 'night' | 'day' | 'vote' | 'result'

export interface MafiaView {
  type: 'mafia'
  round: number
  stage: MafiaStage
  day: number
  maxDays: number
  myRole: 'citizen' | 'mafia' | 'spectator'
  /** 마피아에게만: 동료 마피아 */
  team: string[]
  players: string[]
  alive: string[]
  deadline: number | null
  /** 직전 밤 결과 */
  lastKilled: string | null
  /** 낮 투표 진행 상황 (대상은 비공개) */
  votedIds: string[]
  myVote: string | null | undefined
  /** 마피아에게만: 밤 지목 현황 */
  nightVotes: Record<string, string>
  lastExecuted: string | null | undefined
  result: { winner: 'mafia' | 'citizens' | 'none'; roles: Record<string, 'mafia' | 'citizen'>; reason: string } | null
}

export interface WordchainView {
  type: 'wordchain'
  round: number
  stage: 'turn' | 'result'
  order: string[]
  out: string[]
  currentTurnId: string | null
  chain: { playerId: string | null; word: string }[]
  /** 다음 단어가 시작해야 하는 글자 (두음법칙 포함) */
  allowed: string[]
  deadline: number | null
  /** 사전이 없는 간편 모드: 직전 단어에 이의를 제기할 수 있는 마감 시각 (없으면 null) */
  challengeUntil: number | null
  /** 이의 제기 투표 (생존자 과반 찬성 시 무효 → 낸 사람 탈락) */
  challenge: {
    byId: string
    authorId: string
    word: string
    voters: string[]
    votedIds: string[]
    myVote: boolean | undefined
    needed: number
    deadline: number
  } | null
  result: { winnerId: string | null } | null
}

export interface BaseballView {
  type: 'baseball'
  round: number
  stage: 'guess' | 'result'
  digits: number
  turn: number
  maxTurns: number
  participants: string[]
  deadline: number | null
  submittedIds: string[]
  myGuess: string | null
  history: { turn: number; entries: { playerId: string; guess: string; strike: number; ball: number }[] }[]
  result: { winners: string[]; secret: string } | null
}

export type TwentyReply = 'yes' | 'no' | 'maybe'

export interface TwentyView {
  type: 'twenty'
  round: number
  stage: 'setup' | 'asking' | 'result'
  setterId: string
  /** 질문 순서와 현재 질문 차례 */
  order: string[]
  turnId: string | null
  /** 출제자에게만, 준비 단계에서 고를 수 있는 정답 후보 */
  options: { id: string; answer: string; category: string }[] | null
  rerollsLeft: number
  freeInput: boolean
  /** 판 전체 제한 시각 */
  endsAt: number | null
  myRole: 'setter' | 'guesser' | 'spectator'
  category: string
  /** 출제자에게만 (결과 단계에서는 result.answer) */
  answer: string | null
  maxQuestions: number
  /** 오답 도전의 text는 도전자·출제자에게만 보이고 나머지에게는 빈 문자열 */
  questions: { id: string; askerId: string; text: string; kind: 'question' | 'guess' | 'pass'; reply: TwentyReply | null; correct: boolean }[]
  pendingId: string | null
  deadline: number | null
  result: { winner: 'guessers' | 'setter' | 'none'; answer: string; solverId: string | null; reason: string } | null
}

export type GameView = LiarView | QuizView | MafiaView | WordchainView | BaseballView | TwentyView

/* ───────────────────────── Client → server payloads ───────────────────────── */

const nameSchema = z
  .string()
  .transform((s) => s.replace(/\s+/g, ' ').trim())
  .pipe(z.string().min(1, '닉네임을 입력하세요').max(LIMITS.nameMax, `닉네임은 ${LIMITS.nameMax}자 이하`))

const codeSchema = z
  .string()
  .transform((s) => s.trim().toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9]{6}$/, '코드 형식이 올바르지 않습니다'))

export const createRoomSchema = z.object({
  name: nameSchema,
  sessionName: z.string().trim().max(LIMITS.sessionNameMax).optional(),
  gameType: z.enum(GAME_TYPES as [GameType, ...GameType[]]),
  settings: partialSettingsSchema,
})
export const joinRoomSchema = z.object({ code: codeSchema, name: nameSchema, token: z.string().max(64).optional() })
export const resumeSchema = z.object({ code: codeSchema, token: z.string().min(10).max(64) })
export const configureSchema = z.object({
  gameType: z.enum(GAME_TYPES as [GameType, ...GameType[]]).optional(),
  sessionName: z.string().trim().min(1).max(LIMITS.sessionNameMax).optional(),
  settings: partialSettingsSchema,
})
export const chatImageSchema = z.object({
  // 래스터 이미지만 허용 (SVG 제외)
  dataUrl: z
    .string()
    .max(LIMITS.imageMax, '이미지가 너무 큽니다')
    .regex(/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/, '지원하지 않는 이미지 형식입니다'),
  w: z.number().int().min(1).max(4096),
  h: z.number().int().min(1).max(4096),
})
export const chatSendSchema = z
  .object({
    text: z
      .string()
      .default('')
      .transform((s) => s.trim())
      .pipe(z.string().max(LIMITS.chatMax)),
    image: chatImageSchema.optional(),
  })
  .refine((v) => v.text.length > 0 || !!v.image, '메시지를 입력하세요')
export const gameActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('liar.describe'), text: z.string().trim().min(1).max(LIMITS.describeMax) }),
  z.object({ type: z.literal('liar.vote'), targetId: z.string().min(1).max(32).nullable() }),
  z.object({ type: z.literal('liar.guess'), word: z.string().trim().min(1).max(LIMITS.guessMax) }),
  z.object({ type: z.literal('liar.skipDiscussion') }),
  z.object({ type: z.literal('quiz.answer'), choice: z.number().int().min(0).max(3) }),
  z.object({ type: z.literal('mafia.kill'), targetId: z.string().min(1).max(32) }),
  z.object({ type: z.literal('mafia.vote'), targetId: z.string().min(1).max(32).nullable() }),
  z.object({ type: z.literal('mafia.skip') }),
  z.object({ type: z.literal('word.submit'), word: z.string().trim().min(1).max(20) }),
  z.object({ type: z.literal('word.challenge') }),
  z.object({ type: z.literal('word.challengeVote'), agree: z.boolean() }),
  z.object({ type: z.literal('baseball.guess'), guess: z.string().regex(/^\d{3,4}$/, '숫자 3~4자리를 입력하세요') }),
  z.object({
    type: z.literal('twenty.setup'),
    optionId: z.string().min(1).max(40).optional(),
    answer: z.string().trim().min(1).max(30).optional(),
    category: z.string().trim().min(1).max(20).optional(),
  }),
  z.object({ type: z.literal('twenty.reroll') }),
  z.object({ type: z.literal('twenty.ask'), text: z.string().trim().min(1).max(100) }),
  z.object({ type: z.literal('twenty.guess'), text: z.string().trim().min(1).max(30) }),
  z.object({ type: z.literal('twenty.reply'), questionId: z.string().min(1).max(32), reply: z.enum(['yes', 'no', 'maybe']) }),
])

export type CreateRoomPayload = z.input<typeof createRoomSchema>
export type JoinRoomPayload = z.input<typeof joinRoomSchema>
export type ResumePayload = z.input<typeof resumeSchema>
export type ConfigurePayload = z.input<typeof configureSchema>
export type ChatSendPayload = z.input<typeof chatSendSchema>
export type GameAction = z.infer<typeof gameActionSchema>

/* ───────────────────────── Acks / events ───────────────────────── */

export type ErrorCode =
  | 'INVALID'
  | 'NOT_FOUND'
  | 'FULL'
  | 'FORBIDDEN'
  | 'BAD_STATE'
  | 'RATE_LIMITED'
  | 'NOT_IN_ROOM'
  | 'INTERNAL'

export type Ack<T = undefined> = { ok: true; data: T } | { ok: false; error: { code: ErrorCode; message: string } }

export interface JoinResult {
  token: string
  snapshot: RoomSnapshot
  chat: ChatMessage[]
}

/** 클라이언트 → 서버 (모두 ack 콜백으로 응답) */
export interface ClientToServerEvents {
  'room:create': (p: CreateRoomPayload, ack: (r: Ack<JoinResult>) => void) => void
  'room:join': (p: JoinRoomPayload, ack: (r: Ack<JoinResult>) => void) => void
  'session:resume': (p: ResumePayload, ack: (r: Ack<JoinResult>) => void) => void
  'room:leave': (p: Record<string, never>, ack: (r: Ack) => void) => void
  'room:configure': (p: ConfigurePayload, ack: (r: Ack) => void) => void
  'room:peek': (p: { code: string }, ack: (r: Ack<{ name: string; members: number; phase: RoomPhase }>) => void) => void
  'chat:send': (p: ChatSendPayload, ack: (r: Ack) => void) => void
  'game:start': (p: Record<string, never>, ack: (r: Ack) => void) => void
  'game:action': (p: GameAction, ack: (r: Ack) => void) => void
  'game:stop': (p: Record<string, never>, ack: (r: Ack) => void) => void
}

/** 서버 → 클라이언트 알림 */
export interface ServerToClientEvents {
  'room:state': (s: RoomSnapshot) => void
  'chat:message': (m: ChatMessage) => void
  'room:closed': (p: { reason: string }) => void
}

export function canStartGame(gameType: GameType, playerCount: number): { ok: boolean; reason?: string } {
  const meta = GAME_META[gameType]
  if (playerCount < meta.minPlayers) return { ok: false, reason: `최소 ${meta.minPlayers}명이 필요합니다 (현재 ${playerCount}명)` }
  if (playerCount > meta.maxPlayers) return { ok: false, reason: `최대 ${meta.maxPlayers}명까지 가능합니다 (현재 ${playerCount}명)` }
  return { ok: true }
}
