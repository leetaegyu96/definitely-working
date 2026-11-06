/** AI Chat 테마 — 마피아 / 끝말잇기 / 숫자 야구 / 스무고개 작업 블록 */
import { LIMITS, type TwentyReply } from '@relay/shared'
import { Check, Loader2, X } from 'lucide-react'
import { useState } from 'react'
import { gameAction, stopGame } from '../../features/rooms/api'
import { fmtClock, MAFIA_WINNER, REPLY_LABEL, TWENTY_WINNER, useRemaining, type SessionModel } from '../../game-ui/model'
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
  const stageLabel = { night: `${v.day}일차 밤`, day: `${v.day}일차 낮 · 토론`, vote: `${v.day}일차 투표`, result: '결과' }[v.stage]
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
            <span className="gp-muted">동료: {v.team.filter((id) => id !== me).map((id) => m.name(id)).join(', ') || '없음 (단독)'} · 밤마다 제외할 사람을 함께 고릅니다. 시민 수 이하가 되면 승리.</span>
          </>
        )}
        {v.myRole === 'citizen' && (
          <>
            역할 <strong>시민</strong>
            <span className="gp-muted">낮 토론과 투표로 마피아를 모두 찾아내면 승리합니다.</span>
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
            <p className="gp-text">제외할 대상을 고르세요. 마피아가 여럿이면 가장 많이 지목된 사람이 제외됩니다.</p>
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
            {v.lastKilled ? <>지난밤 <b>{m.name(v.lastKilled)}</b>님이 제외되었습니다. </> : '지난밤 아무도 제외되지 않았습니다. '}
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
      <p className="gp-muted gp-note">
        사전 검증 없이 형식(완성형 한글 2~8자, 끝 글자, 중복)만 확인합니다. 단어가 아니면 호스트가 무효 처리할 수 있습니다.
        {m.isHost && v.canReject && (
          <button type="button" className="gp-link" onClick={() => void run(gameAction({ type: 'word.reject' }), toast)}>
            직전 단어 무효 처리
          </button>
        )}
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

function TwentySetup({ toast, deadline }: { toast(s: string): void; deadline: number | null }) {
  const [answer, setAnswer] = useState('')
  const [category, setCategory] = useState('사물')
  const left = useRemaining(deadline)
  return (
    <form
      className="gp-form"
      onSubmit={(e) => {
        e.preventDefault()
        if (answer.trim()) void run(gameAction({ type: 'twenty.setup', answer: answer.trim(), category: category.trim() || '기타' }), toast)
      }}
    >
      <label>
        <span>정답 (다른 사람에게 보이지 않음)</span>
        <input className="gp-input" value={answer} maxLength={30} onChange={(e) => setAnswer(e.target.value)} placeholder="예: 냉장고" autoFocus />
      </label>
      <label>
        <span>분류 (공개)</span>
        <input className="gp-input" value={category} maxLength={20} onChange={(e) => setCategory(e.target.value)} placeholder="예: 사물" />
      </label>
      <div className="gp-form-actions">
        <span className="gp-muted">{fmtClock(left)} 안에 정하지 않으면 자동으로 출제됩니다</span>
        <button type="submit" className="gp-btn primary" disabled={!answer.trim()}>출제</button>
      </div>
    </form>
  )
}

export function TwentyBlock({ m, toast }: P) {
  const v = m.twenty!
  const t = m.task
  const used = v.questions.length
  return (
    <div className="gp">
      <div className="gp-title">
        <span>{m.meta.workTitle}</span>
        <span className="gp-sub">출제자 {m.name(v.setterId)}{v.category ? ` · 분류 ${v.category}` : ''} · 질문 {used}/{v.maxQuestions}</span>
        {v.stage !== 'result' && v.deadline && <Timer deadline={v.deadline} />}
      </div>

      {v.myRole === 'setter' && v.answer && v.stage !== 'result' && (
        <div className="gp-assign liar">
          정답 <strong>{v.answer}</strong>
          <span className="gp-muted">질문에 예/아니오로 답하세요. 질문 {v.maxQuestions}개 안에 못 맞히면 출제자가 이깁니다.</span>
        </div>
      )}

      {v.stage === 'setup' &&
        (t.kind === 'twenty.setup' ? (
          <>
            <p className="gp-text">이번 라운드 <b>출제자</b>입니다. 정답과 분류를 정하세요.</p>
            <TwentySetup toast={toast} deadline={t.deadline} />
          </>
        ) : (
          <p className="gp-text gp-status"><Loader2 size={14} className="spin" /> {m.name(v.setterId)}님이 문제를 정하고 있습니다.</p>
        ))}

      {v.questions.length > 0 && (
        <ol className="gp-qlist">
          {v.questions.map((q) => (
            <li key={q.id} className={q.kind === 'guess' ? 'guess' : ''}>
              <span className="gp-q">
                <em>{m.name(q.askerId)}</em> {q.kind === 'guess' ? <>정답 도전: <b>{q.text}</b></> : q.text}
              </span>
              <span className={`gp-reply ${q.reply ?? 'pending'}`}>
                {q.kind === 'guess' ? (q.correct ? '정답' : '오답') : q.reply ? REPLY_LABEL[q.reply] : '답변 대기'}
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
                className={`gp-btn${r === 'yes' ? ' primary' : ''}`}
                onClick={() => void run(gameAction({ type: 'twenty.reply', questionId: t.questionId, reply: r }), toast)}
              >
                {REPLY_LABEL[r]}
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
              : `아래 입력창에서 질문하거나 정답에 도전하세요 (최대 ${LIMITS.guessMax}자). 정답 도전도 질문 1회를 씁니다.`
            : v.myRole === 'setter'
              ? '질문이 오면 여기에서 답합니다.'
              : '관전 중'}
        </p>
      )}

      {v.stage === 'result' && v.result && (
        <div className="gp-result">
          <p className="gp-text">
            <strong>{TWENTY_WINNER[v.result.winner]}</strong> — 정답은 <b>{v.result.answer}</b>
            {v.result.solverId ? ` · ${m.name(v.result.solverId)}님이 ${used}번째에 맞혔습니다` : ''}
          </p>
          <AfterResult m={m} toast={toast} />
        </div>
      )}
      <StopLink m={m} toast={toast} />
    </div>
  )
}
