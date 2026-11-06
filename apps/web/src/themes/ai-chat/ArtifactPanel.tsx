import { BarChart3, Check, ChevronDown, Code2, Copy, Download, FileText, Loader2, X } from 'lucide-react'
import { Fragment, useEffect, useRef, useState } from 'react'
import { highlight } from '../../components/highlight'
import { Markdown } from '../../components/Markdown'
import { usePrefs } from '../../stores/prefs'
import { ARTIFACTS, type ArtifactTemplate } from './artifacts'
import { Popover } from './ui'

interface Item {
  id: number
  tpl: ArtifactTemplate
  /** code/doc: 표시 글자 수, chart: 표시 점 수 */
  shown: number
  done: boolean
  at: number
}

const total = (t: ArtifactTemplate) => (t.kind === 'chart' ? t.points.length : t.body.length)
let seq = 0

/** 오른쪽 산출물 패널 — 미리 작성된 결과물을 실시간 작성처럼 순환 표시 */
export function ArtifactPanel() {
  const setSidePanel = usePrefs((s) => s.setSidePanel)
  const [items, setItems] = useState<Item[]>(() => {
    // 처음엔 완성된 결과물 1개 + 작성 중인 결과물 1개
    const first: Item = { id: seq++, tpl: ARTIFACTS[0], shown: total(ARTIFACTS[0]), done: true, at: Date.now() - 6 * 60_000 }
    return [first, { id: seq++, tpl: ARTIFACTS[1], shown: 0, done: false, at: Date.now() }]
  })
  const [selected, setSelected] = useState<number | null>(null) // null = 최신 따라가기
  const [menu, setMenu] = useState(false)
  const [copied, setCopied] = useState(false)
  const next = useRef(2)
  const body = useRef<HTMLDivElement>(null)

  // 작성 루프
  useEffect(() => {
    let timer: number
    const tick = () => {
      let delay = 40
      setItems((list) => {
        const cur = list[list.length - 1]
        if (!cur.done) {
          const isChart = cur.tpl.kind === 'chart'
          const step = isChart ? 1 : 3 + Math.floor(Math.random() * 10)
          const shown = Math.min(total(cur.tpl), cur.shown + step)
          delay = isChart ? 650 : 25 + Math.random() * 45
          // 줄바꿈에서 가끔 쉬어 "생각하는" 느낌
          if (!isChart && cur.tpl.kind !== 'chart' && cur.tpl.body[shown - 1] === '\n' && Math.random() < 0.15) delay = 500 + Math.random() * 900
          return [...list.slice(0, -1), { ...cur, shown, done: shown >= total(cur.tpl), at: Date.now() }]
        }
        // 완료 후 잠시 쉬었다가 다음 결과물
        if (Date.now() - cur.at < 9000 + Math.random() * 6000) {
          delay = 1000
          return list
        }
        const tpl = ARTIFACTS[next.current++ % ARTIFACTS.length]
        delay = 400
        return [...list, { id: seq++, tpl, shown: 0, done: false, at: Date.now() }].slice(-6)
      })
      timer = window.setTimeout(tick, delay)
    }
    timer = window.setTimeout(tick, 600)
    return () => window.clearTimeout(timer)
  }, [])

  const latest = items[items.length - 1]
  const item = items.find((i) => i.id === selected) ?? latest
  const following = item.id === latest.id

  useEffect(() => {
    const el = body.current
    if (el && following && !item.done && item.tpl.kind !== 'chart') el.scrollTop = el.scrollHeight
  })
  useEffect(() => {
    if (selected !== null && !items.some((i) => i.id === selected)) setSelected(null)
  }, [items, selected])

  const icon = (t: ArtifactTemplate, size = 15) =>
    t.kind === 'code' ? <Code2 size={size} /> : t.kind === 'doc' ? <FileText size={size} /> : <BarChart3 size={size} />
  const text = item.tpl.kind === 'chart' ? '' : item.tpl.body

  return (
    <aside className="ap">
      <header className="ap-head">
        <div className="ac-rel ap-title-wrap">
          <button type="button" className="ap-title" data-popover-anchor onClick={() => setMenu((v) => !v)}>
            {icon(item.tpl)}
            <span>{item.tpl.title}</span>
            <ChevronDown size={14} />
          </button>
          <Popover open={menu} onClose={() => setMenu(false)} className="ap-menu">
            <div className="ac-pop-title">이 대화의 산출물</div>
            {[...items].reverse().map((i) => (
              <button
                key={i.id}
                type="button"
                className={`ac-mi${i.id === item.id ? ' ap-cur' : ''}`}
                onClick={() => {
                  setSelected(i.id === latest.id ? null : i.id)
                  setMenu(false)
                }}
              >
                <span className="ac-mi-icon">{icon(i.tpl)}</span>
                <span className="ac-mi-label">{i.tpl.title}</span>
                <span className="ac-mi-hint">{i.done ? ago(i.at) : '작성 중'}</span>
              </button>
            ))}
          </Popover>
        </div>
        <span className="ap-status">
          {item.done ? (
            <>v{(item.id % 4) + 1} · {ago(item.at)}</>
          ) : (
            <>
              <Loader2 size={12} className="spin" /> 작성 중
            </>
          )}
        </span>
        <div className="ap-actions">
          {item.tpl.kind !== 'chart' && (
            <button
              type="button"
              title="복사"
              onClick={() => {
                navigator.clipboard?.writeText(text.slice(0, item.shown)).catch(() => {})
                setCopied(true)
                setTimeout(() => setCopied(false), 1300)
              }}
            >
              {copied ? <Check size={15} /> : <Copy size={15} />}
            </button>
          )}
          {item.tpl.kind !== 'chart' && (
            <button type="button" title="다운로드" disabled={!item.done} onClick={() => download(item.tpl.title, text)}>
              <Download size={15} />
            </button>
          )}
          <button type="button" title="패널 닫기" onClick={() => setSidePanel(false)}>
            <X size={16} />
          </button>
        </div>
      </header>
      {!following && (
        <button type="button" className="ap-follow" onClick={() => setSelected(null)}>
          {latest.done ? '최신 산출물 보기' : `작성 중: ${latest.tpl.title}`} →
        </button>
      )}
      <div className={`ap-body ap-${item.tpl.kind}`} ref={body}>
        {item.tpl.kind === 'code' && <CodeView lang={item.tpl.lang} code={item.tpl.body.slice(0, item.shown)} typing={!item.done} />}
        {item.tpl.kind === 'doc' && (
          <div className="ap-doc">
            <Markdown text={item.tpl.body.slice(0, item.shown)} />
            {!item.done && <span className="ac-caret" />}
          </div>
        )}
        {item.tpl.kind === 'chart' && <ChartView tpl={item.tpl} shown={item.shown} done={item.done} />}
      </div>
    </aside>
  )
}

function ago(ts: number) {
  const m = Math.floor((Date.now() - ts) / 60_000)
  return m < 1 ? '방금' : `${m}분 전`
}

function download(name: string, text: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

function CodeView({ lang, code, typing }: { lang: string; code: string; typing: boolean }) {
  const lines = highlight(code, lang)
  return (
    <pre className="ap-code">
      {lines.map((toks, i) => (
        <div key={i} className="ap-code-line">
          <span className="ap-ln">{i + 1}</span>
          <code>
            {toks.map((t, j) => (t.c ? <span key={j} className={`hl-${t.c}`}>{t.t}</span> : <Fragment key={j}>{t.t}</Fragment>))}
            {typing && i === lines.length - 1 && <span className="ap-cursor" />}
          </code>
        </div>
      ))}
    </pre>
  )
}

/* ───────────── 차트: 단일 계열 → 범례 없음, 제목이 계열을 설명. 호버 시 값 표시 ───────────── */

function niceScale(min: number, max: number, ticks = 4) {
  const span = max - min || 1
  const step0 = span / ticks
  const mag = Math.pow(10, Math.floor(Math.log10(step0)))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) ?? step0
  const lo = Math.floor(min / step) * step
  const hi = Math.ceil(max / step) * step
  const out: number[] = []
  for (let v = lo; v <= hi + step / 2; v += step) out.push(Number(v.toFixed(6)))
  return out
}

function ChartView({ tpl, shown, done }: { tpl: Extract<ArtifactTemplate, { kind: 'chart' }>; shown: number; done: boolean }) {
  const [hover, setHover] = useState<number | null>(null)
  const W = 440
  const H = 240
  const pad = { l: 36, r: 10, t: 12, b: 28 }
  const iw = W - pad.l - pad.r
  const ih = H - pad.t - pad.b
  const vals = tpl.points.map((p) => p.value)
  const ticks = tpl.chart === 'bar' ? niceScale(0, Math.max(...vals)) : niceScale(Math.min(...vals) - 0.5, Math.max(...vals) + 0.3)
  const lo = ticks[0]
  const hi = ticks[ticks.length - 1]
  const y = (v: number) => pad.t + ih - ((v - lo) / (hi - lo)) * ih
  const n = tpl.points.length
  const pts = tpl.points.slice(0, shown)
  const fmt = (v: number) => `${v.toLocaleString(undefined, { maximumFractionDigits: 1 })}${tpl.unit}`

  let marks
  if (tpl.chart === 'line') {
    const x = (i: number) => pad.l + (iw * i) / (n - 1)
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')
    const last = pts.length - 1
    marks = (
      <>
        <path d={d} fill="none" stroke="var(--chart-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {last >= 0 && <circle cx={x(last)} cy={y(pts[last].value)} r={4} fill="var(--chart-1)" stroke="var(--bg)" strokeWidth={2} />}
        {hover !== null && hover < pts.length && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} stroke="var(--text-3)" strokeDasharray="3 3" />
            <circle cx={x(hover)} cy={y(pts[hover].value)} r={5} fill="var(--chart-1)" stroke="var(--bg)" strokeWidth={2} />
          </>
        )}
        {tpl.points.map((p, i) => (
          <text key={i} x={x(i)} y={H - 8} textAnchor="middle" className="ap-axis">{p.label}</text>
        ))}
        {tpl.points.map((_, i) => (
          <rect key={i} x={x(i) - iw / (n - 1) / 2} y={pad.t} width={iw / (n - 1)} height={ih} fill="transparent" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
        ))}
      </>
    )
  } else {
    const band = iw / n
    const bw = Math.min(56, band - 2 * 8)
    marks = tpl.points.map((p, i) => {
      const cx = pad.l + band * i + band / 2
      const visible = i < pts.length
      const top = y(p.value)
      const h = pad.t + ih - top
      const r = Math.min(4, h / 2)
      // 위쪽만 둥근 막대, 기준선에 붙임
      const path = `M${cx - bw / 2},${pad.t + ih} V${top + r} Q${cx - bw / 2},${top} ${cx - bw / 2 + r},${top} H${cx + bw / 2 - r} Q${cx + bw / 2},${top} ${cx + bw / 2},${top + r} V${pad.t + ih} Z`
      return (
        <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
          <rect x={cx - band / 2} y={pad.t} width={band} height={ih} fill="transparent" />
          {visible && <path d={path} fill="var(--chart-1)" opacity={hover === null || hover === i ? 1 : 0.55} className="ap-bar" />}
          {visible && i === 0 && <text x={cx} y={top - 6} textAnchor="middle" className="ap-label">{fmt(p.value)}</text>}
          <text x={cx} y={H - 8} textAnchor="middle" className="ap-axis">{p.label}</text>
        </g>
      )
    })
  }

  const hp = hover !== null && hover < pts.length ? tpl.points[hover] : null
  return (
    <div className="ap-chart">
      <h3>{tpl.title}</h3>
      <p className="ap-sub">{tpl.subtitle}</p>
      <div className="ap-plot">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${tpl.title} 차트`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="ap-grid" />
              <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" className="ap-axis">{t}</text>
            </g>
          ))}
          {marks}
        </svg>
        {hp && (
          <div className="ap-tip" style={{ left: `${((tpl.chart === 'line' ? pad.l + (iw * hover!) / (n - 1) : pad.l + (iw / n) * (hover! + 0.5)) / W) * 100}%` }}>
            <span>{hp.label}</span> <b>{fmt(hp.value)}</b>
          </div>
        )}
      </div>
      {done ? (
        <>
          <table className="ap-table">
            <tbody>
              <tr>{tpl.points.map((p) => <th key={p.label}>{p.label}</th>)}</tr>
              <tr>{tpl.points.map((p) => <td key={p.label}>{p.value}</td>)}</tr>
            </tbody>
          </table>
          <Markdown text={tpl.notes} />
        </>
      ) : (
        <p className="ap-sub"><Loader2 size={12} className="spin" /> 데이터 집계 중… {pts.length}/{tpl.points.length}</p>
      )}
    </div>
  )
}
