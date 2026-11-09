import {
  GAME_META,
  GAME_TYPES,
  LIAR_CATEGORIES,
  LIAR_CATEGORY_LABEL,
  QUIZ_CATEGORIES,
  QUIZ_CATEGORY_LABEL,
  QUIZ_POOL_SIZE,
  type QuizCategory,
  type GameType,
} from '@relay/shared'
import { Check, Circle, CircleDot, Copy, Loader2, X } from 'lucide-react'
import { useState } from 'react'
import { configureSession, gameAction, inviteUrl, startGame, stopGame } from '../../features/rooms/api'
import {
  fmtClock,
  LIAR_STEPS,
  liarStepIndex,
  useRemaining,
  useServerNow,
  WINNER_LABEL,
  type SessionModel,
} from '../../game-ui/model'
import { BaseballBlock, MafiaBlock, TwentyBlock, WordchainBlock } from './GamePanel2'
import { BrandMark } from './ui'

/** 세션 상태를 "어시스턴트가 관리하는 작업 블록"처럼 표시 */
export function GamePanel({ m, toast }: { m: SessionModel; toast(msg: string): void }) {
  const { snap } = m
  let body
  if (snap.phase === 'WAITING') body = <Lobby m={m} toast={toast} />
  else if (snap.phase === 'STARTING') body = <Starting m={m} />
  else if (m.liar) body = <LiarBlock m={m} toast={toast} />
  else if (m.quiz) body = <QuizBlock m={m} toast={toast} />
  else if (m.mafia) body = <MafiaBlock m={m} toast={toast} />
  else if (m.wordchain) body = <WordchainBlock m={m} toast={toast} />
  else if (m.baseball) body = <BaseballBlock m={m} toast={toast} />
  else if (m.twenty) body = <TwentyBlock m={m} toast={toast} />
  else body = null
  return (
    <div className="ac-msg-ai ac-task">
      <div className="ac-ai-icon"><BrandMark size={22} /></div>
      <div className="ac-ai-body">{body}</div>
    </div>
  )
}

export async function run(p: Promise<{ ok: boolean; error?: { message: string } }>, toast: (s: string) => void) {
  const r = (await p) as { ok: boolean; error?: { message: string } }
  if (!r.ok && r.error) toast(r.error.message)
  return r.ok
}

/* ───────────── WAITING ───────────── */

function Lobby({ m, toast }: { m: SessionModel; toast(s: string): void }) {
  const { snap } = m
  const [editing, setEditing] = useState(false)
  const url = inviteUrl(snap.code)
  return (
    <div className="gp">
      <div className="gp-title">
        <span>세션 준비됨</span>
        <span className="gp-sub">{m.meta.workTitle}</span>
      </div>
      <p className="gp-text">
        {m.isHost
          ? '참여자를 초대한 뒤 작업을 시작하세요. 설정은 기본값 그대로 진행해도 됩니다.'
          : `${m.host?.name ?? '호스트'}님이 작업을 시작하면 이곳에 진행 상황이 표시됩니다.`}
      </p>

      <dl className="gp-kv">
        <dt>작업 유형</dt>
        <dd>
          {m.meta.workTitle} <span className="gp-muted">· {m.meta.title} · {m.meta.minPlayers}–{m.meta.maxPlayers}명</span>
        </dd>
        <dt>설정</dt>
        <dd>
          {m.settingsSummary}
          {m.isHost && (
            <button type="button" className="gp-link" onClick={() => setEditing((v) => !v)}>
              {editing ? '닫기' : '변경'}
            </button>
          )}
        </dd>
        <dt>참여자</dt>
        <dd>
          <span className="gp-people">
            {m.players.map((p) => (
              <span key={p.id} className={`gp-person${p.connected ? '' : ' off'}`}>
                {p.name}
                {p.id === snap.hostId && <em>호스트</em>}
                {p.id === snap.meId && <em>나</em>}
              </span>
            ))}
          </span>
        </dd>
        <dt>초대 링크</dt>
        <dd className="gp-invite">
          <code>{url.replace(/^https?:\/\//, '')}</code>
          <button
            type="button"
            className="gp-link"
            onClick={() => {
              navigator.clipboard?.writeText(url).then(
                () => toast('초대 링크를 복사했습니다'),
                () => toast('복사하지 못했습니다. 링크를 직접 선택해 복사하세요'),
              )
            }}
          >
            <Copy size={13} /> 복사
          </button>
          <span className="gp-muted">코드 {snap.code}</span>
        </dd>
      </dl>

      {editing && m.isHost && <SettingsEditor m={m} toast={toast} onDone={() => setEditing(false)} />}

      <div className="gp-actions">
        {m.isHost ? (
          <>
            <button
              type="button"
              className="gp-btn primary"
              disabled={!m.canStart.ok}
              onClick={() => void run(startGame(), toast)}
            >
              작업 시작
            </button>
            {!m.canStart.ok && <span className="gp-muted">{m.canStart.reason}</span>}
          </>
        ) : (
          <span className="gp-muted">
            <Loader2 size={13} className="spin" /> 호스트가 시작하기를 기다리는 중
          </span>
        )}
      </div>
    </div>
  )
}

type Field = { key: string; label: string; options: [string | number | boolean, string][] }
const secs = (list: number[], zero?: string): [number, string][] => list.map((n) => [n, n === 0 && zero ? zero : `${n}초`])
const FIELDS: Record<GameType, Field[]> = {
  liar: [
    { key: 'category', label: '카테고리', options: LIAR_CATEGORIES.map((c) => [c, LIAR_CATEGORY_LABEL[c]]) },
    { key: 'describeSeconds', label: '설명 시간', options: secs([15, 25, 40, 60]) },
    { key: 'discussSeconds', label: '토론 시간', options: secs([0, 30, 60, 90, 120, 180], '없음') },
  ],
  quiz: [
    { key: 'category', label: '분야', options: QUIZ_CATEGORIES.map((c) => [c, QUIZ_CATEGORY_LABEL[c]]) },
    { key: 'questionCount', label: '문항 수', options: [3, 5, 7, 10, 15].map((n) => [n, `${n}문항`]) },
    { key: 'seconds', label: '제한 시간', options: secs([10, 15, 20, 30, 45]) },
  ],
  mafia: [
    { key: 'discussSeconds', label: '낮 토론', options: secs([0, 60, 75, 90, 120, 180], '없음') },
    { key: 'voteSeconds', label: '낮 투표', options: secs([15, 30, 45, 60]) },
    { key: 'nightSeconds', label: '밤 시간', options: secs([15, 20, 30, 45, 60]) },
  ],
  wordchain: [
    { key: 'turnSeconds', label: '차례당 시간', options: secs([10, 15, 20, 30, 45]) },
    { key: 'challengeSeconds', label: '이의 제기 대기', options: secs([0, 2, 3, 5], '끄기') },
  ],
  baseball: [
    { key: 'digits', label: '자릿수', options: [[3, '3자리'], [4, '4자리']] },
    { key: 'maxRounds', label: '최대 턴', options: [5, 10, 15, 20].map((n) => [n, `${n}턴`]) },
    { key: 'roundSeconds', label: '턴당 시간', options: secs([15, 30, 45, 60, 90]) },
  ],
  twenty: [
    { key: 'maxQuestions', label: '질문 수', options: [10, 15, 20, 30].map((n) => [n, `${n}개`]) },
    { key: 'setupSeconds', label: '정답 고르는 시간', options: secs([15, 30, 45, 60]) },
    { key: 'freeInput', label: '정답 정하기', options: [[false, '정답 은행에서 고르기'], [true, '직접 입력 (고급)']] },
  ],
}

export function SettingsEditor({ m, toast, onDone }: { m: SessionModel; toast(s: string): void; onDone(): void }) {
  const [type, setType] = useState<GameType>(m.snap.gameType)
  const [vals, setVals] = useState<Record<string, Record<string, string | number | boolean>>>(
    () => structuredClone(m.snap.settings) as unknown as Record<string, Record<string, string | number | boolean>>,
  )
  return (
    <div className="gp-form">
      <label>
        <span>작업 유형</span>
        <select value={type} onChange={(e) => setType(e.target.value as GameType)}>
          {GAME_TYPES.map((g) => (
            <option key={g} value={g}>
              {GAME_META[g].workTitle} ({GAME_META[g].title} · {GAME_META[g].minPlayers}–{GAME_META[g].maxPlayers}명)
            </option>
          ))}
        </select>
      </label>
      {FIELDS[type].map((f) => (
        <label key={f.key}>
          <span>{f.label}</span>
          <select
            value={String(vals[type][f.key])}
            onChange={(e) => {
              const raw = e.target.value
              const k = typeof f.options[0][0]
              const v = k === 'number' ? Number(raw) : k === 'boolean' ? raw === 'true' : raw
              setVals((p) => ({ ...p, [type]: { ...p[type], [f.key]: v } }))
            }}
          >
            {f.options.map(([v, l]) => {
              // 퀴즈 문항 수: 고른 분야의 보유 문항보다 많으면 시작할 수 없으므로 막아 둔다
              const over = type === 'quiz' && f.key === 'questionCount' && Number(v) > QUIZ_POOL_SIZE[vals.quiz.category as QuizCategory]
              return (
                <option key={String(v)} value={String(v)} disabled={over}>
                  {l}{over ? ' (문항 부족)' : ''}
                </option>
              )
            })}
          </select>
          {type === 'quiz' && f.key === 'questionCount' && (
            <span className="gp-muted">이 분야 최대 {QUIZ_POOL_SIZE[vals.quiz.category as QuizCategory]}문항</span>
          )}
          {type === 'twenty' && f.key === 'freeInput' && vals.twenty.freeInput === true && (
            <span className="gp-muted">정답은 한글·영문·숫자 2~20자. 욕설·개인정보는 쓰지 마세요.</span>
          )}
        </label>
      ))}
      <div className="gp-form-actions">
        <button type="button" className="gp-btn" onClick={onDone}>취소</button>
        <button
          type="button"
          className="gp-btn primary"
          onClick={async () => {
            const ok = await run(configureSession({ gameType: type, settings: { [type]: vals[type] } }), toast)
            if (ok) onDone()
          }}
        >
          적용
        </button>
      </div>
    </div>
  )
}

/* ───────────── STARTING ───────────── */

function Starting({ m }: { m: SessionModel }) {
  const now = useServerNow(200)
  const left = m.snap.startsAt ? Math.max(0, Math.ceil((m.snap.startsAt - now) / 1000)) : 0
  return (
    <div className="gp">
      <div className="gp-title"><span>{m.meta.workTitle}</span><span className="gp-sub">준비 중</span></div>
      <p className="gp-text gp-status">
        <Loader2 size={14} className="spin" /> 참여자 {m.activeCount}명에게 작업을 배정하고 있습니다… {left > 0 ? `${left}초` : ''}
      </p>
    </div>
  )
}

/* ───────────── LIAR ───────────── */

function Steps({ current }: { current: number }) {
  return (
    <ol className="gp-steps">
      {LIAR_STEPS.map((s, i) => (
        <li key={s.key} className={i < current ? 'done' : i === current ? 'now' : ''}>
          {i < current ? <Check size={13} /> : i === current ? <CircleDot size={13} /> : <Circle size={13} />}
          {s.label}
        </li>
      ))}
    </ol>
  )
}

export function Timer({ deadline, label }: { deadline: number | null; label?: string }) {
  const left = useRemaining(deadline)
  if (left === null) return null
  return (
    <span className={`gp-timer${left <= 5 ? ' low' : ''}`}>
      {label} {fmtClock(left)}
    </span>
  )
}

function LiarBlock({ m, toast }: { m: SessionModel; toast(s: string): void }) {
  const v = m.liar!
  const step = liarStepIndex(v)
  return (
    <div className="gp">
      <div className="gp-title">
        <span>{m.meta.workTitle} · 라운드 {v.round}</span>
        <span className="gp-sub">카테고리 {v.category}</span>
        {v.stage !== 'result' && <Timer deadline={v.deadline} />}
      </div>

      <div className={`gp-assign ${v.myRole}`}>
        {v.myRole === 'citizen' && (
          <>
            할당 키워드 <strong>{v.word}</strong>
            <span className="gp-muted">키워드를 직접 말하지 말고, 아는 사람만 알아들을 수 있게 설명하세요.</span>
          </>
        )}
        {v.myRole === 'liar' && (
          <>
            할당 키워드 <strong>없음</strong> — 이번 라운드의 라이어입니다.
            <span className="gp-muted">다른 사람의 설명으로 키워드를 추론하고, 들키지 않게 설명하세요.</span>
          </>
        )}
        {v.myRole === 'spectator' && (
          <>
            관전 중 <span className="gp-muted">진행 중에 참여해 다음 라운드부터 함께합니다.</span>
          </>
        )}
      </div>

      <Steps current={step} />

      {(v.stage === 'describe' || v.descriptions.length > 0) && v.stage !== 'result' && (
        <table className="gp-table">
          <thead>
            <tr><th style={{ width: 28 }}>#</th><th style={{ width: 120 }}>참여자</th><th>설명</th></tr>
          </thead>
          <tbody>
            {v.order.map((id, i) => {
              const d = v.descriptions.find((x) => x.playerId === id)
              const cur = v.currentTurnId === id
              return (
                <tr key={id} className={cur ? 'cur' : ''}>
                  <td className="gp-muted">{i + 1}</td>
                  <td>{m.name(id)}{id === m.snap.meId && <span className="gp-muted"> (나)</span>}</td>
                  <td>
                    {d ? (
                      <span className={d.timedOut ? 'gp-muted' : ''}>{d.text}</span>
                    ) : cur ? (
                      <span className="gp-muted"><Loader2 size={12} className="spin" /> 작성 중</span>
                    ) : (
                      <span className="gp-muted">대기</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {v.stage === 'describe' && (
        <p className="gp-text">
          {m.task.kind === 'liar.describe'
            ? '내 차례입니다. 아래 입력창에 설명을 입력하세요. 제시어(또는 같은 뜻의 말)를 그대로 쓰지는 마세요.'
            : `${m.name(v.currentTurnId)}님이 설명을 작성하고 있습니다.`}
        </p>
      )}

      {v.stage === 'discuss' && (
        <div className="gp-row">
          <p className="gp-text">자유 토론 중입니다. 아래 입력창으로 의견을 나누세요. 시간이 끝나면 투표가 열립니다.</p>
          {m.isHost && (
            <button type="button" className="gp-btn" onClick={() => void run(gameAction({ type: 'liar.skipDiscussion' }), toast)}>
              바로 투표 열기
            </button>
          )}
        </div>
      )}

      {v.stage === 'vote' && <LiarVote m={m} toast={toast} />}

      {v.stage === 'guess' && (
        <p className="gp-text">
          <strong>{m.name(v.accusedId)}</strong>님이 지목되었고 라이어가 맞습니다.{' '}
          {m.task.kind === 'liar.guess'
            ? '키워드를 맞히면 역전할 수 있습니다. 아래 입력창에 추측한 키워드를 입력하세요.'
            : '라이어가 키워드를 추측하고 있습니다.'}
        </p>
      )}

      {v.stage === 'result' && v.result && <LiarResult m={m} toast={toast} />}

      {v.stage !== 'result' && m.isHost && (
        <div className="gp-foot">
          <button type="button" className="gp-link muted" onClick={() => void run(stopGame(), toast)}>
            <X size={12} /> 작업 중단
          </button>
        </div>
      )}
    </div>
  )
}

function LiarVote({ m, toast }: { m: SessionModel; toast(s: string): void }) {
  const v = m.liar!
  const [sel, setSel] = useState<string | null>(null)
  const t = m.task.kind === 'liar.vote' ? m.task : null
  const voted = v.votedIds.length
  const total = v.order.length
  return (
    <div className="gp-vote">
      <p className="gp-text">
        {v.revote ? '동률이 나와 후보를 좁혀 재투표합니다. ' : ''}
        라이어로 의심되는 사람을 한 명 선택하세요. 기권할 수 있고, 제출 후에는 바꿀 수 없습니다.
        {v.revote ? ' 결선도 동률이거나 모두 기권하면 라이어가 이깁니다.' : ' 아무도 지목받지 못하면(전원 기권) 라이어가 이깁니다.'}
        <span className="gp-muted"> · {voted}/{total}명 완료</span>
      </p>
      {t && t.myVote === undefined && (
        <>
          <div className="gp-options" role="radiogroup">
            {t.options.map((p) => (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={sel === p.id}
                className={`gp-option${sel === p.id ? ' sel' : ''}`}
                onClick={() => setSel(p.id)}
                onDoubleClick={() => void run(gameAction({ type: 'liar.vote', targetId: p.id }), toast)}
              >
                <span className="gp-radio" />
                {p.name}
                {!p.connected && <span className="gp-muted"> · 오프라인</span>}
              </button>
            ))}
          </div>
          <div className="gp-actions">
            <button
              type="button"
              className="gp-btn primary"
              disabled={!sel}
              onClick={() => sel && void run(gameAction({ type: 'liar.vote', targetId: sel }), toast)}
            >
              투표 제출
            </button>
            <button type="button" className="gp-btn" onClick={() => void run(gameAction({ type: 'liar.vote', targetId: null }), toast)}>
              기권
            </button>
          </div>
        </>
      )}
      {t && t.myVote !== undefined && (
        <p className="gp-text gp-status">
          <Check size={14} /> {t.myVote ? `${m.name(t.myVote)}님에게 투표했습니다` : '기권했습니다'}. 다른 참여자를 기다리는 중입니다.
        </p>
      )}
      {!t && <p className="gp-muted">관전 중에는 투표할 수 없습니다.</p>}
    </div>
  )
}

function LiarResult({ m, toast }: { m: SessionModel; toast(s: string): void }) {
  const v = m.liar!
  const r = v.result!
  const tally = new Map<string, number>()
  for (const t of Object.values(r.votes)) if (t) tally.set(t, (tally.get(t) ?? 0) + 1)
  const ballots = Object.entries(r.votes)
  const meWon =
    v.myRole === 'spectator' || r.winner === 'none'
      ? null
      : (r.winner === 'liar') === (v.myRole === 'liar')
  return (
    <div className="gp-result">
      <p className="gp-text">
        <strong>{WINNER_LABEL[r.winner]}</strong> — {r.reason}
        {meWon !== null && <span className="gp-muted"> ({meWon ? '내 팀 승리' : '내 팀 패배'})</span>}
      </p>
      <table className="gp-table">
        <tbody>
          <tr><th style={{ width: 120 }}>라이어</th><td>{m.name(r.liarId)}</td></tr>
          <tr><th>키워드</th><td>{r.word}</td></tr>
          {r.guess !== null && <tr><th>라이어의 추측</th><td>{r.guess}</td></tr>}
          <tr>
            <th>최종 득표</th>
            <td>
              {[...tally.entries()].sort((a, b) => b[1] - a[1]).map(([id, n]) => `${m.name(id)} ${n}표`).join(' · ') || '—'}
            </td>
          </tr>
          {ballots.length > 0 && (
            <tr>
              <th>투표 내역</th>
              <td>{ballots.map(([from, to]) => `${m.name(from)} → ${to ? m.name(to) : '기권'}`).join(' · ')}</td>
            </tr>
          )}
        </tbody>
      </table>
      <details className="gp-details">
        <summary>설명 기록 보기</summary>
        <ul>
          {v.descriptions.map((d) => (
            <li key={d.playerId}>
              <strong>{m.name(d.playerId)}</strong>{d.playerId === r.liarId ? ' (라이어)' : ''}: {d.text}
            </li>
          ))}
        </ul>
      </details>
      <AfterResult m={m} toast={toast} />
    </div>
  )
}

export function AfterResult({ m, toast }: { m: SessionModel; toast(s: string): void }) {
  const [editing, setEditing] = useState(false)
  if (!m.isHost)
    return <p className="gp-muted gp-after">호스트가 다음 작업을 시작할 수 있습니다.</p>
  return (
    <>
      <div className="gp-actions gp-after">
        <button type="button" className="gp-btn primary" disabled={!m.canStart.ok} onClick={() => void run(startGame(), toast)}>
          다시 실행
        </button>
        <button type="button" className="gp-btn" onClick={() => setEditing((v) => !v)}>유형·설정 변경</button>
        <button type="button" className="gp-btn" onClick={() => void run(stopGame(), toast)}>대기 상태로</button>
        {!m.canStart.ok && <span className="gp-muted">{m.canStart.reason}</span>}
      </div>
      {editing && <SettingsEditor m={m} toast={toast} onDone={() => setEditing(false)} />}
    </>
  )
}

/* ───────────── QUIZ ───────────── */

function QuizBlock({ m, toast }: { m: SessionModel; toast(s: string): void }) {
  const v = m.quiz!
  const t = m.task.kind === 'quiz.answer' ? m.task : null
  const left = useRemaining(v.deadline)
  const totalSecs = v.stage === 'question' ? m.snap.settings.quiz.seconds : 3
  const pct = left === null ? 0 : Math.max(0, Math.min(100, (left / totalSecs) * 100))

  if (v.stage === 'result' && v.ranking) {
    return (
      <div className="gp">
        <div className="gp-title"><span>{m.meta.workTitle} 결과</span><span className="gp-sub">{v.category} · {v.total}문항</span></div>
        <table className="gp-table">
          <thead>
            <tr><th style={{ width: 40 }}>순위</th><th>참여자</th><th className="al-r">정답</th><th className="al-r">점수</th></tr>
          </thead>
          <tbody>
            {v.ranking.map((r, i) => (
              <tr key={r.playerId} className={r.playerId === m.snap.meId ? 'me' : ''}>
                <td>{i > 0 && v.ranking![i - 1].rank === r.rank ? '' : r.rank}</td>
                <td>{m.name(r.playerId)}</td>
                <td className="al-r">{r.correct}/{v.total}</td>
                <td className="al-r num">{r.score.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <AfterResult m={m} toast={toast} />
      </div>
    )
  }

  const q = v.question
  const reveal = v.reveal
  return (
    <div className="gp">
      <div className="gp-title">
        <span>{m.meta.workTitle} · 문항 {v.index + 1}/{v.total}</span>
        <span className="gp-sub">{v.category}</span>
        {v.stage === 'question' && <span className={`gp-timer${(left ?? 0) <= 5 ? ' low' : ''}`}>{fmtClock(left)}</span>}
      </div>
      <div className="gp-progress"><span style={{ width: `${pct}%` }} /></div>
      {q && <p className="gp-question">{q.text}</p>}
      {q && (
        <div className="gp-options">
          {q.choices.map((c, i) => {
            const mine = v.myAnswer === i
            const correct = reveal?.correctIndex === i
            const cls = reveal ? (correct ? ' correct' : mine ? ' wrong' : ' faded') : mine ? ' sel' : ''
            const pickers = reveal ? Object.entries(reveal.answers).filter(([, a]) => a === i).map(([id]) => m.name(id)) : []
            return (
              <button
                key={i}
                type="button"
                className={`gp-option${cls}`}
                disabled={!t || t.myAnswer !== null || !!reveal}
                onClick={() => void run(gameAction({ type: 'quiz.answer', choice: i }), toast)}
              >
                <span className="gp-idx">{i + 1}</span>
                <span className="gp-opt-text">{c}</span>
                {reveal && correct && <Check size={15} className="gp-opt-mark" />}
                {reveal && pickers.length > 0 && <span className="gp-pickers">{pickers.join(', ')}</span>}
              </button>
            )
          })}
        </div>
      )}
      <p className="gp-muted gp-quiz-status">
        {v.stage === 'question' &&
          (t
            ? t.myAnswer !== null
              ? `제출 완료 · 다른 참여자 응답 대기 (${v.answeredIds.length}/${v.participants.length})`
              : `보기를 선택하면 바로 제출됩니다 · ${v.answeredIds.length}/${v.participants.length}명 응답`
            : `관전 중 · ${v.answeredIds.length}/${v.participants.length}명 응답`)}
        {v.stage === 'reveal' && reveal && (
          <>
            {m.snap.meId in reveal.gained
              ? reveal.gained[m.snap.meId] > 0
                ? `정답 · +${reveal.gained[m.snap.meId]}점`
                : '오답 또는 미응답'
              : '정답 공개'}
            {' · '}잠시 후 다음 문항으로 넘어갑니다
          </>
        )}
      </p>
      <ScoreLine m={m} />
      {m.isHost && (
        <div className="gp-foot">
          <button type="button" className="gp-link muted" onClick={() => void run(stopGame(), toast)}>
            <X size={12} /> 작업 중단
          </button>
        </div>
      )}
    </div>
  )
}

function ScoreLine({ m }: { m: SessionModel }) {
  const v = m.quiz!
  const entries = Object.entries(v.scores).sort((a, b) => b[1] - a[1])
  return (
    <div className="gp-scores">
      {entries.map(([id, s]) => (
        <span key={id} className={id === m.snap.meId ? 'me' : ''}>
          {m.name(id)} <b>{s}</b>
        </span>
      ))}
    </div>
  )
}

