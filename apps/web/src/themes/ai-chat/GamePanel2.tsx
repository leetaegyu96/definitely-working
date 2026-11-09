/** AI Chat 테마 — 마피아 / 끝말잇기 / 숫자 야구 / 스무고개 작업 블록 */
import { LIMITS, type TwentyReply } from '@relay/shared'
import { Check, Loader2, X } from 'lucide-react'
import { useState } from 'react'
import { gameAction, stopGame } from '../../features/rooms/api'
import { fmtClock, MAFIA_WINNER, REPLY_LABEL, TWENTY_WINNER, useRemaining, useServerNow, type SessionModel } from '../../game-ui/model'
import { AfterResult, run, Timer } from './GamePanel'

type P = { m: SessionModel; toast(s: string): void }

function StopLink({ m, toast }: P) {
  if (!m.isHost || m.snap.phase !== 'PLAYING') return null
  return (
    <div className="gp-foot">
      <button type="button" className="gp-link muted" onClick={() => void run(stopGame(), toast)}>
        <X size={12} /> 작업 중단
      </button>
    </div>
  )
}

/** 대상 1명 선택 + 제출 (투표/지목 공용) */
function PickOne({
  options,
  submitLabel,
  onSubmit,
  extra,
}: {
  options: { id: string; name: string; note?: string }[]
  submitLabel: string
  onSubmit(id: string): void
  extra?: React.ReactNode
}) {
  const [sel, setSel] = useState<string | null>(null)
  return (
    <>
      <div className="gp-options" role="radiogroup">
        {options.map((p) => (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={sel === p.id}
            className={`gp-option${sel === p.id ? ' sel' : ''}`}
            onClick={() => setSel(p.id)}
            onDoubleClick={() => onSubmit(p.id)}
          >
            <span className="gp-radio" />
            {p.name}
            {p.note && <span className="gp-pickers">{p.note}</span>}
          </button>
        ))}
      </div>
      <div className="gp-actions">
        <button type="button" className="gp-btn primary" disabled={!sel} onClick={() => sel && onSubmit(sel)}>
          {submitLabel}
        </button>
        {extra}
      </div>
    </>
  )
}

/* ───────────── 마피아 ───────────── */

export function MafiaBlock({ m, toast }: P) {
  const v = m.mafia!
  const me = m.snap.meId
  const dead = v.myRole !== 'spectator' && !v.alive.includes(me)
  const dayTag = `${v.day}/${v.maxDays}일차`
  const stageLabel = { night: `${dayTag} 밤`, day: `${dayTag} 낮 · 토론`, vote: `${dayTag} 투표`, result: '결과' }[v.stage]
  const t = m.task
  return (
    <div className="gp">
      <div className="gp-title">
        <span>{m.meta.workTitle} · {stageLabel}</span>
        <span className="gp-sub">생존 {v.alive.length}/{v.players.length}</span>
        {v.stage !== 'result' && <Timer deadline={v.deadline} />}
      </div>

      <div className={`gp-assign ${v.myRole === 'mafia' ? 'liar' : ''}`}>
        {v.myRole === 'mafia' && (
          <>
            역할 <strong>마피아</strong>
            <span className="gp-muted">동료: {v.team.filter((id) => id !== me).map((id) => m.name(id)).join(', ') || '없음 (단독)'} · 밤마다 제외할 사람을 함께 고릅니다. 마피아 수가 시민 수 이상이 되면 승리, {v.maxDays}일째 투표까지 못 이기면 패배.</span>
          </>
        )}
        {v.myRole === 'citizen' && (
          <>
            역할 <strong>시민</strong>
            <span className="gp-muted">낮 토론과 투표로 마피아를 모두 찾아내거나 {v.maxDays}일째 투표까지 버티면 승리합니다.</span>
          </>
        )}
        {v.myRole === 'spectator' && <>관전 중 <span className="gp-muted">다음 라운드부터 참여합니다.</span></>}
        {dead && v.stage !== 'result' && <span className="gp-muted">이미 제외되어 투표에 참여할 수 없습니다. 채팅은 계속 가능합니다.</span>}
      </div>

      {v.stage !== 'result' && (
        <div className="gp-people gp-alive">
          {v.players.map((id) => (
            <span key={id} className={`gp-person${v.alive.includes(id) ? '' : ' off strike'}`}>
              {m.name(id)}
              {id === me && <em>나</em>}
              {v.myRole === 'mafia' && v.team.includes(id) && <em>마피아</em>}
            </span>
          ))}
        </div>
      )}

      {v.stage === 'night' &&
        (t.kind === 'mafia.kill' ? (
          <>
            <p className="gp-text">제외할 대상을 고르세요. 마피아가 여럿이면 가장 많이 지목된 사람이 제외됩니다. 모두 같은 사람을 고르면 2초 뒤 확정되며, 그 전에는 바꿀 수 있습니다.</p>
            <PickOne
              options={t.options.map((p) => ({
                id: p.id,
                name: p.name,
                note: Object.entries(v.nightVotes).filter(([, tg]) => tg === p.id).map(([who]) => m.name(who)).join(', ') || undefined,
              }))}
              submitLabel={t.myPick ? '지목 변경' : '지목'}
              onSubmit={(id) => void run(gameAction({ type: 'mafia.kill', targetId: id }), toast)}
            />
          </>
        ) : (
          <p className="gp-text gp-status"><Loader2 size={14} className="spin" /> 밤입니다. 마피아가 대상을 고르고 있습니다.</p>
        ))}

      {v.stage === 'day' && (
        <div className="gp-row">
          <p className="gp-text">
            {v.day === 1 ? '첫날입니다. 대화로 서로를 살펴보세요. ' : v.lastKilled ? <>지난밤 <b>{m.name(v.lastKilled)}</b>님이 제외되었습니다. </> : '지난밤 아무도 제외되지 않았습니다. '}
            채팅으로 의심 가는 사람을 이야기하세요.
          </p>
          {m.isHost && (
            <button type="button" className="gp-btn" onClick={() => void run(gameAction({ type: 'mafia.skip' }), toast)}>바로 투표 열기</button>
          )}
        </div>
      )}

      {v.stage === 'vote' && (
        <>
          <p className="gp-text">
            제외할 사람에게 투표하세요. 최다 득표가 동률이면 아무도 제외되지 않습니다. <span className="gp-muted">· {v.votedIds.length}/{v.alive.length}명 완료</span>
          </p>
          {t.kind === 'mafia.vote' ? (
            <PickOne
              options={t.options.map((p) => ({ id: p.id, name: p.name }))}
              submitLabel="투표 제출"
              onSubmit={(id) => void run(gameAction({ type: 'mafia.vote', targetId: id }), toast)}
              extra={<button type="button" className="gp-btn" onClick={() => void run(gameAction({ type: 'mafia.vote', targetId: null }), toast)}>기권</button>}
            />
          ) : v.myVote !== undefined ? (
            <p className="gp-text gp-status"><Check size={14} /> {v.myVote ? `${m.name(v.myVote)}님에게 투표했습니다` : '기권했습니다'}. 다른 참여자를 기다리는 중입니다.</p>
          ) : null}
        </>
      )}

      {v.stage === 'result' && v.result && (
        <div className="gp-result">
          <p className="gp-text"><strong>{MAFIA_WINNER[v.result.winner]}</strong> — {v.result.reason}</p>
          <table className="gp-table">
            <thead><tr><th>참여자</th><th>역할</th><th>상태</th></tr></thead>
            <tbody>
              {v.players.map((id) => (
                <tr key={id} className={id === me ? 'me' : ''}>
                  <td>{m.name(id)}</td>
                  <td>{v.result!.roles[id] === 'mafia' ? '마피아' : '시민'}</td>
                  <td className="gp-muted">{v.alive.includes(id) ? '생존' : '제외'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <AfterResult m={m} toast={toast} />
        </div>
      )}
      <StopLink m={m} toast={toast} />
    </div>
  )
}

/* ───────────── 끝말잇기 ───────────── */

export function WordchainBlock({ m, toast }: P) {
  const v = m.wordchain!
  const recent = v.chain.slice(-12)
  return (
    <div className="gp">
      <div className="gp-title">
        <span>{m.meta.workTitle}</span>
        <span className="gp-sub">{v.chain.length - 1}개 연결 · 남은 인원 {v.order.length - v.out.length}</span>
        {v.stage === 'turn' && <Timer deadline={v.deadline} />}
      </div>
      <div className="gp-chain">
        {v.chain.length > recent.length && <span className="gp-muted">… </span>}
        {recent.map((c, i) => (
          <span key={i} className="gp-chain-word">
            {i > 0 && <span className="gp-chain-arrow">→</span>}
            <b>{c.word}</b>
            <em>{c.playerId ? m.name(c.playerId) : '시작'}</em>
          </span>
        ))}
      </div>
      {v.stage === 'turn' && (
        <p className="gp-text">
          {m.task.kind === 'word.submit' ? (
            <><b>내 차례</b>입니다. '<b>{v.allowed.join("' 또는 '")}</b>'(으)로 시작하는 단어를 아래 입력창에 입력하세요.</>
          ) : v.challenge ? (
            <>이의 제기 투표 중 · 끝나면 {m.name(v.nextTurnId)}님 차례</>
          ) : v.challengeUntil ? (
            <>이의 제기 확인 중 · 다음은 {m.name(v.nextTurnId)}님 ('<b>{v.allowed.join("' 또는 '")}</b>'(으)로 시작)</>
          ) : (
            <>{m.name(v.currentTurnId)}님 차례 · '<b>{v.allowed.join("' 또는 '")}</b>'(으)로 시작</>
          )}
        </p>
      )}
      <div className="gp-people">
        {v.order.map((id) => (
          <span key={id} className={`gp-person${v.out.includes(id) ? ' off strike' : ''}${v.currentTurnId === id ? ' cur' : ''}`}>
            {m.name(id)}
            {id === m.snap.meId && <em>나</em>}
          </span>
        ))}
      </div>
      <WordChallenge m={m} toast={toast} />
      <p className="gp-muted gp-note">
        간편 모드: 사전이 없어 형식(완성형 한글 2~8자, 끝 글자, 중복)만 확인합니다.
        {v.order.length - v.out.length >= 3
          ? m.snap.settings.wordchain.challengeSeconds > 0
            ? ` 단어가 나오면 ${m.snap.settings.wordchain.challengeSeconds}초 동안 이의를 받고, 생존자 과반이 찬성하면 무효(낸 사람 탈락)입니다. 실제 단어인지는 서버가 보장하지 않습니다.`
            : ' 이의 제기가 꺼져 있습니다.'
          : ' 2명일 때는 판정할 사람이 없어 이의 제기가 없습니다 (연습용).'}
      </p>
      {v.stage === 'result' && v.result && (
        <div className="gp-result">
          <p className="gp-text">
            <strong>{v.result.winnerId ? `${m.name(v.result.winnerId)} 승리` : '승자 없음'}</strong> — 총 {v.chain.length - 1}개 단어를 이었습니다.
          </p>
          <AfterResult m={m} toast={toast} />
        </div>
      )}
      <StopLink m={m} toast={toast} />
    </div>
  )
}

function WordChallenge({ m, toast }: P) {
  const v = m.wordchain!
  const now = useServerNow()
  const c = v.challenge
  const last = v.chain[v.chain.length - 1]
  const me = m.snap.meId
  if (c) {
    const t = m.task.kind === 'word.challengeVote' ? m.task : null
    return (
      <div className="gp-reply-box">
        <p className="gp-text">
          {m.name(c.byId)}님이 <b>{m.name(c.authorId)}</b>님의 단어 '<b>{c.word}</b>'에 이의를 제기했습니다. 실제로 없는 단어인가요?
          <span className="gp-muted"> · 무효 {c.needed}표 필요 · {c.votedIds.length}/{c.voters.length}명 투표</span>
        </p>
        {t ? (
          <div className="gp-actions">
            <button type="button" className="gp-btn primary" onClick={() => void run(gameAction({ type: 'word.challengeVote', agree: true }), toast)}>무효 (없는 단어)</button>
            <button type="button" className="gp-btn" onClick={() => void run(gameAction({ type: 'word.challengeVote', agree: false }), toast)}>인정</button>
            <Timer deadline={c.deadline} />
          </div>
        ) : (
          <p className="gp-muted">{c.authorId === me ? '내 단어에 대한 투표입니다. 결과를 기다리세요.' : c.myVote !== undefined ? '투표했습니다. 결과를 기다리는 중입니다.' : '관전 중'}</p>
        )}
      </div>
    )
  }
  const canChallenge =
    v.stage === 'turn' && v.challengeUntil !== null && now < v.challengeUntil && !!last.playerId && last.playerId !== me && !v.out.includes(me) && v.order.includes(me)
  if (!canChallenge) return null
  return (
    <div className="gp-actions">
      <button type="button" className="gp-btn" onClick={() => void run(gameAction({ type: 'word.challenge' }), toast)}>
        '{last.word}' 이의 제기 · {Math.max(0, Math.ceil((v.challengeUntil! - now) / 1000))}초
      </button>
    </div>
  )
}

/* ───────────── 숫자 야구 ───────────── */

export function BaseballBlock({ m, toast }: P) {
  const v = m.baseball!
  const me = m.snap.meId
  const mine = v.history.flatMap((h) => h.entries.filter((e) => e.playerId === me).map((e) => ({ ...e, turn: h.turn })))
  return (
    <div className="gp">
      <div className="gp-title">
        <span>{m.meta.workTitle} · {v.stage === 'result' ? '결과' : `${v.turn}/${v.maxTurns}턴`}</span>
        <span className="gp-sub">서로 다른 숫자 {v.digits}자리</span>
        {v.stage === 'guess' && <Timer deadline={v.deadline} />}
      </div>
      {v.stage === 'guess' && (
        <p className="gp-text">
          {m.task.kind === 'baseball.guess'
            ? '추측한 숫자를 아래 입력창에 입력하세요. 모두 제출하면 한꺼번에 판정합니다.'
            : v.myGuess
              ? <><Check size={13} /> <b>{v.myGuess}</b> 제출 완료 · 다른 참여자를 기다리는 중</>
              : '관전 중'}
          <span className="gp-muted"> · {v.submittedIds.length}/{v.participants.length}명 제출</span>
        </p>
      )}
      {v.history.length > 0 && (
        <table className="gp-table">
          <thead>
            <tr>
              <th style={{ width: 48 }}>턴</th>
              {v.participants.length > 1 ? <th>참여자</th> : null}
              <th>추측</th>
              <th className="al-r">판정</th>
            </tr>
          </thead>
          <tbody>
            {[...v.history].reverse().slice(0, 8).flatMap((h) =>
              h.entries.map((e, i) => (
                <tr key={`${h.turn}-${e.playerId}`} className={e.playerId === me ? 'me' : ''}>
                  <td className="gp-muted">{i === 0 ? h.turn : ''}</td>
                  {v.participants.length > 1 ? <td>{m.name(e.playerId)}</td> : null}
                  <td className="num gp-mono">{e.guess}</td>
                  <td className="al-r num">{e.strike === v.digits ? '정답' : e.strike + e.ball === 0 ? '아웃' : `${e.strike}S ${e.ball}B`}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      )}
      {v.stage === 'guess' && mine.length > 0 && v.participants.length > 1 && (
        <p className="gp-muted">내 기록: {mine.map((e) => `${e.guess}(${e.strike}S${e.ball}B)`).join(' · ')}</p>
      )}
      {v.stage === 'result' && v.result && (
        <div className="gp-result">
          <p className="gp-text">
            정답 <strong className="gp-mono">{v.result.secret}</strong> —{' '}
            {v.result.winners.length ? `${v.result.winners.map((w) => m.name(w)).join(', ')} 승리` : '아무도 맞히지 못했습니다'}
          </p>
          <AfterResult m={m} toast={toast} />
        </div>
      )}
      <StopLink m={m} toast={toast} />
    </div>
  )
}

/* ───────────── 스무고개 ───────────── */

function TwentySetup({ toast, task }: { toast(s: string): void; task: Extract<SessionModel['task'], { kind: 'twenty.setup' }> }) {
  const [answer, setAnswer] = useState('')
  const [category, setCategory] = useState('사물')
  const [custom, setCustom] = useState(false)
  const left = useRemaining(task.deadline)
  return (
    <div className="gp-form">
      <div className="gp-options" role="radiogroup">
        {task.options.map((o) => (
          <button key={o.id} type="button" className="gp-option" onClick={() => void run(gameAction({ type: 'twenty.setup', optionId: o.id }), toast)}>
            <span className="gp-radio" />
            <b>{o.answer}</b>
            <span className="gp-muted"> · {o.category}</span>
          </button>
        ))}
      </div>
      <div className="gp-form-actions">
        <span className="gp-muted">눌러서 바로 출제 · {fmtClock(left)} 안에 고르지 않으면 첫 번째 후보로 출제됩니다</span>
        <button type="button" className="gp-btn" disabled={task.rerollsLeft <= 0} onClick={() => void run(gameAction({ type: 'twenty.reroll' }), toast)}>
          다시 뽑기 ({task.rerollsLeft})
        </button>
        {task.freeInput && !custom && (
          <button type="button" className="gp-btn" onClick={() => setCustom(true)}>직접 입력</button>
        )}
      </div>
      {custom && (
        <form
          className="gp-form"
          onSubmit={(e) => {
            e.preventDefault()
            if (answer.trim()) void run(gameAction({ type: 'twenty.setup', answer: answer.trim(), category: category.trim() || '기타' }), toast)
          }}
        >
          <label>
            <span>정답 (다른 사람에게 보이지 않음)</span>
            <input className="gp-input" value={answer} maxLength={20} onChange={(e) => setAnswer(e.target.value)} placeholder="예: 냉장고" autoFocus />
          </label>
          <label>
            <span>분류 (공개)</span>
            <input className="gp-input" value={category} maxLength={10} onChange={(e) => setCategory(e.target.value)} placeholder="예: 사물" />
          </label>
          <div className="gp-form-actions">
            <span className="gp-muted">한글·영문·숫자 2~20자 · 욕설·개인정보 금지 · 철자가 정확히 같아야 정답으로 인정됩니다</span>
            <button type="submit" className="gp-btn primary" disabled={!answer.trim()}>출제</button>
          </div>
        </form>
      )}
    </div>
  )
}

export function TwentyBlock({ m, toast }: P) {
  const v = m.twenty!
  const t = m.task
  const used = v.questions.filter((q) => !q.free).length
  return (
    <div className="gp">
      <div className="gp-title">
        <span>{m.meta.workTitle}</span>
        <span className="gp-sub">출제자 {m.name(v.setterId)}{v.category ? ` · 분류 ${v.category}` : ''} · 질문 {used}/{v.maxQuestions}{v.endsAt ? <> · 전체 <TotalLeft at={v.endsAt} /></> : null}</span>
        {v.stage !== 'result' && v.deadline && <Timer deadline={v.deadline} />}
      </div>

      {v.myRole === 'setter' && v.answer && v.stage !== 'result' && (
        <div className="gp-assign liar">
          정답 <strong>{v.answer}</strong>
          <span className="gp-muted">질문에 사실대로 예/아니오로 답하세요. '애매함'은 {v.maybeLeft}번 남았고 질문 횟수를 쓰지 않습니다. 질문 {v.maxQuestions}개를 다 쓰거나 8분이 지나면 출제자가 이깁니다. 3번 답하지 않으면 게임이 중단됩니다.</span>
        </div>
      )}

      {v.stage === 'setup' &&
        (t.kind === 'twenty.setup' ? (
          <>
            <p className="gp-text">이번 라운드 <b>출제자</b>입니다. 아래 후보 중 정답을 하나 고르세요. 다른 사람에게는 분류만 공개됩니다.</p>
            <TwentySetup toast={toast} task={t} />
          </>
        ) : (
          <p className="gp-text gp-status"><Loader2 size={14} className="spin" /> {m.name(v.setterId)}님이 문제를 정하고 있습니다.</p>
        ))}

      {v.questions.length > 0 && (
        <ol className="gp-qlist">
          {v.questions.map((q) => (
            <li key={q.id} className={q.kind === 'guess' ? 'guess' : q.kind === 'pass' ? 'pass' : ''}>
              <span className="gp-q">
                <em>{m.name(q.askerId)}</em>{' '}
                {q.kind === 'guess' ? <>정답 도전{q.text ? <>: <b>{q.text}</b></> : null}</> : q.kind === 'pass' ? <span className="gp-muted">시간 초과로 차례 넘김</span> : q.text}
              </span>
              <span className={`gp-reply ${q.kind === 'pass' ? 'maybe' : (q.reply ?? 'pending')}`}>
                {q.kind === 'guess' ? (q.correct ? '정답' : '실패') : q.kind === 'pass' ? '—' : q.reply ? REPLY_LABEL[q.reply] : '답변 대기'}
                {q.free ? ' · 횟수 미차감' : ''}
              </span>
            </li>
          ))}
        </ol>
      )}

      {t.kind === 'twenty.reply' && (
        <div className="gp-reply-box">
          <p className="gp-text">질문: <b>{t.question}</b></p>
          <div className="gp-actions">
            {(['yes', 'no', 'maybe'] as TwentyReply[]).map((r) => (
              <button
                key={r}
                type="button"
                disabled={r === 'maybe' && v.maybeLeft <= 0}
                title={r === 'maybe' ? `남은 횟수 ${v.maybeLeft}` : undefined}
                className={`gp-btn${r === 'yes' ? ' primary' : ''}`}
                onClick={() => void run(gameAction({ type: 'twenty.reply', questionId: t.questionId, reply: r }), toast)}
              >
                {REPLY_LABEL[r]}
                {r === 'maybe' ? ` (${v.maybeLeft})` : ''}
              </button>
            ))}
          </div>
        </div>
      )}

      {v.stage === 'asking' && t.kind !== 'twenty.reply' && (
        <p className="gp-muted">
          {v.myRole === 'guesser'
            ? v.pendingId
              ? '출제자의 답변을 기다리는 중입니다.'
              : t.kind === 'twenty.ask'
                ? `내 차례입니다. 아래 입력창에서 예/아니오 질문을 하거나 정답에 도전하세요 (정답 최대 ${LIMITS.guessMax}자). 둘 다 1회를 씁니다 ('애매함' 답은 제외). 전체 8분이 지나면 질문이 남아도 끝납니다.`
                : `${m.name(v.turnId)}님이 질문할 차례입니다.`
            : v.myRole === 'setter'
              ? '질문이 오면 여기에서 답합니다.'
              : '관전 중'}
        </p>
      )}

      {v.stage === 'result' && v.result && (
        <div className="gp-result">
          <p className="gp-text">
            <strong>{TWENTY_WINNER[v.result.winner]}</strong> — 정답은 <b>{v.result.answer}</b>
            {v.result.solverId ? ` · ${m.name(v.result.solverId)}님이 ${used}번째에 맞혔습니다` : ` · ${v.result.reason}`}
          </p>
          <AfterResult m={m} toast={toast} />
        </div>
      )}
      <StopLink m={m} toast={toast} />
    </div>
  )
}

function TotalLeft({ at }: { at: number }) {
  const left = useRemaining(at)
  return <>{fmtClock(left)} 남음</>
}
