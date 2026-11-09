/** 세션 채팅/이벤트 → CLI 로그 라인 변환 (Terminal 테마 전용 표현) */
import { GAME_META, type ChatMessage, type LiarView, type QuizView, type RoomSnapshot } from '@relay/shared'
import { REPLY_LABEL } from '../../game-ui/model'
import type { Seg } from './shell'

export interface TLine {
  id: string
  ts: number
  scope: 'work' | 'session'
  segs: Seg[]
  cls?: string
  /** 인라인 이미지 (채팅 첨부) */
  img?: { src: string; w: number; h: number }
}

const NAME_COLORS = ['t-cyan', 't-magenta', 't-yellow', 't-green', 't-blue', 't-orange']
export function nameColor(name: string) {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return NAME_COLORS[h % NAME_COLORS.length]
}

const WIN = { liar: 'liar wins', citizens: 'reviewers win', none: 'void round' } as const

let seq = 0
const t = (text: string, cls?: string): Seg => ({ t: text, cls })
const L = (ts: number, segs: Seg[], cls?: string): TLine => ({ id: `s${ts}-${seq++}`, ts, scope: 'session', segs, cls })
const dim = (t: string): Seg => ({ t, cls: 't-dim' })
const tree = (ts: number, segs: Seg[], cls?: string) => L(ts, [dim('  ⎿  '), ...segs], cls)

/**
 * 개인 비밀 정보는 이벤트가 아니라 내 시점 스냅샷에서만 가져온다.
 * 다음 라운드가 시작되면 스냅샷이 바뀌므로, 라운드별로 처음 본 내 시점 정보를 기억해 둔다 (메모리만, 저장 안 함).
 */
const roundCache = new Map<string, RoomSnapshot>()
function privateLines(ts: number, live: RoomSnapshot | null, round: number): TLine[] {
  if (!live) return []
  const key = `${live.code}:${live.meId}:${round}`
  if (live.game?.round === round && !roundCache.has(key)) roundCache.set(key, live)
  const snap = roundCache.get(key)
  const g = snap?.game
  if (!g || g.round !== round) return []
  if (g.type === 'liar') {
    const v = g as LiarView
    if (v.myRole === 'citizen') return [tree(ts, [{ t: 'keyword: ' }, { t: v.word ?? '', cls: 't-bold t-green' }, dim(`   category: ${v.category}`)])]
    if (v.myRole === 'liar')
      return [
        tree(ts, [{ t: 'keyword: ' }, { t: '(none) — you are the liar', cls: 't-bold t-yellow' }, dim(`   category: ${v.category}`)]),
        L(ts, [dim('     blend in with your description, then guess the keyword if caught')]),
      ]
    return [tree(ts, [dim('spectating — you will join from the next round')])]
  }
  if (g.type === 'mafia') {
    if (g.myRole === 'mafia') {
      const mates = g.team.filter((id) => id !== snap!.meId).map((id) => snap!.players.find((p) => p.id === id)?.name ?? '?')
      return [tree(ts, [t('role: '), t('mafia', 't-bold t-red'), dim(`   team: ${mates.length ? mates.join(', ') : '(solo)'}`)]), L(ts, [dim('     pick a target each night with /kill <n>; win when mafia ≥ citizens')])]
    }
    if (g.myRole === 'citizen') return [tree(ts, [t('role: '), t('citizen', 't-bold t-green'), dim('   find every mafia by vote')])]
    return [tree(ts, [dim('spectating — you will join from the next round')])]
  }
  if (g.type === 'wordchain') return [tree(ts, [dim(`${g.order.length} players · type a word on your turn · Korean syllables, 2–8 chars`)])]
  if (g.type === 'baseball') return [tree(ts, [dim(`guess ${g.digits} distinct digits · max ${g.maxTurns} turns · type digits on each turn`)])]
  if (g.type === 'twenty') {
    const setter = snap!.players.find((p) => p.id === g.setterId)?.name ?? '?'
    if (g.myRole === 'setter') return [tree(ts, [t('you are the '), t('setter', 't-bold t-yellow'), dim(' — /setup <answer> <category>, then /reply y|n|m')])]
    return [tree(ts, [dim(`setter: ${setter} · type a yes/no question, /guess <answer> to solve`)])]
  }
  const q = g as QuizView
  return [tree(ts, [dim(`${q.total} questions · category ${q.category} · ${snap!.settings.quiz.seconds}s each`)])]
}

export function formatChat(msgs: ChatMessage[], snap: RoomSnapshot | null): TLine[] {
  const out: TLine[] = []
  const me = snap?.meId
  for (const m of msgs) {
    const ts = m.ts
    if (m.type === 'chat') {
      const head: Seg[] = m.authorId === me ? [dim('> ')] : [{ t: m.authorName, cls: `${nameColor(m.authorName)} t-bold` }, dim(' › ')]
      if (m.image || m.imageExpired) {
        const meta = m.image ? `[image ${m.image.w}×${m.image.h} · ${Math.round((m.image.dataUrl.length * 3) / 4 / 1024)}KB]` : '[image expired]'
        out.push(L(ts, [...head, dim(meta), ...(m.text ? [{ t: ' ' + m.text }] : [])], m.authorId === me ? 'tl-user' : undefined))
        if (m.image) out.push({ ...L(ts, []), img: { src: m.image.dataUrl, w: m.image.w, h: m.image.h }, cls: 'tl-img' })
        continue
      }
      if (m.authorId === me) out.push(L(ts, [dim('> '), { t: m.text }], 'tl-user'))
      else out.push(L(ts, [...head, { t: m.text }]))
      continue
    }
    const e = m.event
    switch (e.code) {
      case 'room_created':
        out.push(L(ts, [{ t: '◆ ', cls: 't-accent' }, { t: `session "${e.name}" created` }]))
        break
      case 'joined':
        out.push(L(ts, [dim(`  + ${e.name} joined${e.spectator ? ' (spectator)' : ''}`)]))
        break
      case 'left':
        out.push(L(ts, [dim(`  - ${e.name} left`)]))
        break
      case 'host_changed':
        out.push(L(ts, [dim(`  ~ host is now ${e.name}`)]))
        break
      case 'game_selected':
        out.push(L(ts, [{ t: '● ', cls: 't-accent' }, { t: `task type → ${GAME_META[e.game].workTitle}` }]))
        break
      case 'game_starting':
        out.push(L(ts, [{ t: '● ', cls: 't-accent' }, { t: `Preparing ${GAME_META[e.game].workTitle}…` }]))
        break
      case 'game_started':
        out.push(L(ts, [{ t: '● ', cls: 't-accent' }, { t: `${GAME_META[e.game].workTitle} · round ${e.round}`, cls: 't-bold' }]))
        out.push(...privateLines(ts, snap, e.round))
        break
      case 'game_stopped':
        out.push(L(ts, [{ t: '● ', cls: 't-yellow' }, { t: `task stopped by ${e.by}` }]))
        break
      case 'game_aborted':
        out.push(L(ts, [{ t: '● ', cls: 't-yellow' }, { t: `task cancelled — ${e.reason}` }]))
        break
      case 'liar_turn':
        break
      case 'liar_described':
        out.push(tree(ts, e.timedOut ? [{ t: e.name, cls: nameColor(e.name) }, dim(': (timed out)')] : [{ t: e.name, cls: nameColor(e.name) }, dim(': '), { t: `"${e.text}"` }]))
        break
      case 'liar_discuss':
        out.push(L(ts, [{ t: '● ', cls: 't-accent' }, { t: `Discussion open (${e.seconds}s)` }, dim(' — type to chat · host can /next')]))
        break
      case 'liar_vote_open':
        out.push(L(ts, [{ t: '● ', cls: 't-accent' }, { t: e.revote ? 'Re-vote (tie)' : 'Vote: who is the liar?' }, dim(`  candidates: ${e.candidates.join(', ')}`)]))
        break
      case 'liar_accused':
        out.push(tree(ts, [{ t: e.name, cls: 't-bold' }, { t: ` accused with ${e.votes} vote${e.votes > 1 ? 's' : ''}` }]))
        break
      case 'liar_guess_open':
        out.push(tree(ts, [{ t: `${e.name} is the liar — guessing the keyword…` }]))
        break
      case 'liar_result':
        out.push(L(ts, [{ t: '● ', cls: e.winner === 'none' ? 't-yellow' : 't-green' }, { t: `Result: ${WIN[e.winner]}`, cls: 't-bold' }]))
        out.push(L(ts, [dim('  liar     '), { t: e.liarName }]))
        out.push(L(ts, [dim('  keyword  '), { t: e.word }]))
        if (e.guess !== null) out.push(L(ts, [dim('  guess    '), { t: e.guess }]))
        out.push(L(ts, [dim(`  ${e.reason}`)]))
        break
      case 'quiz_question':
        out.push(L(ts, [{ t: '● ', cls: 't-accent' }, { t: `Q${e.index + 1}/${e.total}  `, cls: 't-bold' }, { t: e.text }]))
        break
      case 'quiz_reveal':
        out.push(tree(ts, [dim('answer: '), { t: e.answer, cls: 't-green' }, dim(` · correct: ${e.correctNames.length ? e.correctNames.join(', ') : 'none'}`)]))
        break
      case 'quiz_result':
        out.push(L(ts, [{ t: '● ', cls: 't-green' }, { t: 'Final ranking', cls: 't-bold' }]))
        e.ranking.forEach((r, i) => out.push(L(ts, [dim(`  ${String(i + 1).padStart(2)}. `), { t: r.name }, dim('  '), { t: `${r.score}`, cls: 't-yellow' }])))
        break
      case 'mafia_night':
        out.push(L(ts, [t('● ', 't-accent'), t(`Night ${e.day}`, 't-bold'), dim(' — mafia is choosing a target')]))
        break
      case 'mafia_dawn':
        out.push(tree(ts, e.killedName ? [t(e.killedName, 't-bold'), t(' was removed overnight')] : [dim('nobody was removed overnight')]))
        break
      case 'mafia_vote_open':
        out.push(L(ts, [t('● ', 't-accent'), t(`Day ${e.day} vote`, 't-bold'), dim(' — /vote <n> or /vote skip')]))
        break
      case 'mafia_executed':
        out.push(tree(ts, e.name ? [t(e.name, 't-bold'), t(` voted out (${e.votes})`)] : [dim('tie or abstain — nobody voted out')]))
        break
      case 'mafia_result':
        out.push(L(ts, [t('● ', 't-green'), t(`Result: ${e.winner === 'mafia' ? 'mafia wins' : e.winner === 'citizens' ? 'citizens win' : 'void'}`, 't-bold')]))
        out.push(L(ts, [dim('  mafia    '), t(e.mafiaNames.join(', '))]))
        out.push(L(ts, [dim(`  ${e.reason}`)]))
        break
      case 'word_played':
        out.push(tree(ts, [t(e.name, e.name === '시작 단어' ? 't-dim' : nameColor(e.name)), dim(': '), t(e.word, 't-bold')]))
        break
      case 'word_out':
        out.push(tree(ts, [t(e.name, 't-red'), dim(` out (${e.reason === 'timeout' ? 'timed out' : e.reason === 'rejected' ? 'word rejected by host' : 'left'})`)]))
        break
      case 'word_result':
        out.push(L(ts, [t('● ', 't-green'), t(`Result: ${e.winnerName ? `${e.winnerName} wins` : 'no winner'}`, 't-bold'), dim(`  · chain length ${e.length}`)]))
        break
      case 'baseball_round':
        out.push(L(ts, [t('● ', 't-accent'), t(`Turn ${e.round}`, 't-bold')]))
        if (!e.results.length) out.push(tree(ts, [dim('no submissions')]))
        e.results.forEach((r, i) => out.push(L(ts, [dim(i === 0 ? '  ⎿  ' : '     '), t(r.name, nameColor(r.name)), dim('  '), t(r.guess, 't-bold'), dim('  →  '), t(`${r.strike}S ${r.ball}B`, r.strike + r.ball === 0 ? 't-dim' : 't-yellow')])))
        break
      case 'baseball_result':
        out.push(L(ts, [t('● ', 't-green'), t(`Result: answer ${e.secret}`, 't-bold'), dim(`  · ${e.winners.length ? e.winners.join(', ') + ' solved it' : 'nobody solved it'}`)]))
        break
      case 'twenty_ready':
        out.push(L(ts, [t('● ', 't-accent'), t('Questions open', 't-bold'), dim(`  setter ${e.setterName} · category ${e.category}`)]))
        break
      case 'twenty_asked':
        out.push(tree(ts, [t(e.name, nameColor(e.name)), dim(e.kind === 'guess' ? ' guesses: ' : ' asks: '), t(e.text, e.kind === 'guess' ? 't-bold' : undefined)]))
        break
      case 'twenty_replied':
        out.push(L(ts, [dim('     → '), t(e.kind === 'guess' ? (e.correct ? 'correct!' : 'wrong') : REPLY_LABEL[e.reply], e.reply === 'yes' ? 't-green' : e.reply === 'no' ? 't-red' : 't-yellow')]))
        break
      case 'twenty_result':
        out.push(L(ts, [t('● ', 't-green'), t(`Result: ${e.winner === 'guessers' ? 'guessers win' : e.winner === 'setter' ? 'setter wins' : 'void'}`, 't-bold'), dim(`  · answer ${e.answer}${e.solverName ? ` · solved by ${e.solverName}` : ''}`)]))
        break
    }
  }
  return out
}

/** 업무 로그 (세션과 무관, 업무 보기에서도 유지) */
export const WORK_LOG: { segs: Seg[]; cls?: string }[] = [
  { segs: [dim('> '), { t: '정산 배치 테스트 실패 원인 찾아줘' }], cls: 'tl-user' },
  { segs: [] },
  { segs: [{ t: '● ', cls: 't-green' }, { t: 'Read', cls: 't-bold' }, { t: '(src/settlement/batch.ts)' }] },
  { segs: [dim('  ⎿  Read 14 lines')] },
  { segs: [] },
  { segs: [{ t: '● ', cls: 't-green' }, { t: 'Bash', cls: 't-bold' }, { t: '(pnpm test batch)' }] },
  { segs: [dim('  ⎿  '), { t: 'FAIL', cls: 't-red t-bold' }, { t: ' test/batch.test.ts > settleDaily > does not pay twice when markSettled fails' }] },
  { segs: [dim('     Expected payout.send to be called 1 time, but it was called 2 times')] },
  { segs: [] },
  { segs: [{ t: '● ', cls: 't-fg' }, { t: 'markSettled 가 실패하면 행이 PENDING 으로 남아 다음 루프에서 다시 지급됩니다. 지급 전에 행을 선점하고 멱등 키를 전달하도록 수정하겠습니다.' }] },
  { segs: [] },
  { segs: [{ t: '● ', cls: 't-green' }, { t: 'Update', cls: 't-bold' }, { t: '(src/settlement/batch.ts)' }] },
  { segs: [dim('  ⎿  Updated src/settlement/batch.ts with '), { t: '6 additions', cls: 't-green' }, dim(' and '), { t: '2 removals', cls: 't-red' }] },
  { segs: [] },
  { segs: [{ t: '● ', cls: 't-green' }, { t: 'Bash', cls: 't-bold' }, { t: '(pnpm test batch)' }] },
  { segs: [dim('  ⎿  '), { t: '✓', cls: 't-green' }, { t: ' test/batch.test.ts (4 tests) 22ms' }] },
  { segs: [] },
  { segs: [{ t: '● ', cls: 't-fg' }, { t: '테스트 4건이 모두 통과합니다. 변경 사항은 아직 커밋하지 않았습니다 (git diff 로 확인 가능).' }] },
  { segs: [] },
]
