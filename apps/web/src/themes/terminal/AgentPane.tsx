import { useEffect, useRef, useState } from 'react'
import { SCENARIOS, VERBS, type Step } from './agentScript'
import type { Seg } from './shell'

interface Line {
  id: number
  segs: Seg[]
  cls?: string
}

const SPIN = ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢']
let lid = 0
const s = (t: string, cls?: string): Seg => ({ t, cls })

/** 오른쪽 분할 창 — 에이전트가 생각하고 파일을 읽고 고치고 테스트하는 출력이 계속 올라감 (가상) */
export function AgentPane() {
  const [lines, setLines] = useState<Line[]>([])
  const [status, setStatus] = useState<{ verb: string; since: number } | null>(null)
  const [tick, setTick] = useState(0)
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  useEffect(() => {
    let alive = true
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
    const push = (segs: Seg[], cls?: string) => {
      const id = lid++
      setLines((l) => [...l, { id, segs, cls }].slice(-400))
      return id
    }
    const patch = (id: number, segs: Seg[]) => setLines((l) => l.map((x) => (x.id === id ? { ...x, segs } : x)))
    const stream = async (prefix: Seg[], text: string, cls?: string, speed = 1) => {
      const id = push(prefix, cls)
      for (let i = 0; i <= text.length && alive; i += 2 + Math.floor(Math.random() * 3)) {
        patch(id, [...prefix, s(text.slice(0, i))])
        await sleep((14 + Math.random() * 22) / speed)
      }
      patch(id, [...prefix, s(text)])
    }
    const busy = async (verb: string, ms: number) => {
      setStatus({ verb, since: Date.now() })
      await sleep(ms)
      setStatus(null)
    }

    async function run(step: Step) {
      switch (step.k) {
        case 'prompt':
          push([])
          await stream([s('> ', 't-dim')], step.text, 'tl-user', 0.6)
          push([])
          return
        case 'think':
          await busy(VERBS[Math.floor(Math.random() * VERBS.length)], step.ms)
          if (step.text) {
            await stream([s('✻ ', 't-dim')], step.text, 't-dim t-italic', 1.4)
            push([])
          }
          return
        case 'say':
          await stream([s('● ', 't-fg')], step.text)
          push([])
          return
        case 'tool': {
          push([s('● ', 't-green'), s(step.name, 't-bold'), s(`(${step.arg})`)])
          await busy('Running', step.ms ?? 500 + Math.random() * 700)
          push([s('  ⎿  ', 't-dim'), s(step.result, 't-dim')])
          push([])
          return
        }
        case 'bash': {
          push([s('● ', 't-green'), s('Bash', 't-bold'), s(`(${step.cmd})`)])
          await busy('Running', step.ms ?? 900)
          for (const [i, o] of step.out.entries()) {
            push([s(i === 0 ? '  ⎿  ' : '     ', 't-dim'), s(o.t, o.c)])
            await sleep(120 + Math.random() * 200)
          }
          push([])
          return
        }
        case 'diff': {
          push([s('● ', 't-green'), s('Update', 't-bold'), s(`(${step.file})`)])
          await busy('Writing', 700)
          push([s('  ⎿  ', 't-dim'), s(`Updated ${step.file} with `, 't-dim'), s(`${step.add} additions`, 't-green'), s(' and ', 't-dim'), s(`${step.del} removals`, 't-red')])
          for (const d of step.lines) {
            push([s(`     ${String(d.n).padStart(3)} `, 't-dim'), s(`${d.s} ${d.t}`)], d.s === '+' ? 'tl-add' : d.s === '-' ? 'tl-del' : undefined)
            await sleep(70)
          }
          push([])
          return
        }
        case 'todo':
          push([s('● ', 't-green'), s('Update Todos', 't-bold')])
          step.items.forEach((it, i) => push([s(i === 0 ? '  ⎿  ' : '     ', 't-dim'), s(it.done ? '☒ ' : '☐ ', it.done ? 't-green' : 't-dim'), s(it.text, it.done ? 't-dim t-strike' : undefined)]))
          push([])
          await sleep(500)
          return
        case 'pause':
          await sleep(step.ms)
          return
      }
    }

    ;(async () => {
      let i = Math.floor(Math.random() * SCENARIOS.length)
      await sleep(800)
      while (alive) {
        for (const step of SCENARIOS[i % SCENARIOS.length]) {
          if (!alive) return
          await run(step)
          await sleep(250 + Math.random() * 400)
        }
        i++
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  // 스피너 애니메이션
  useEffect(() => {
    if (!status) return
    const t = setInterval(() => setTick((x) => x + 1), 110)
    return () => clearInterval(t)
  }, [status])

  useEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  })

  const secs = status ? Math.floor((Date.now() - status.since) / 1000) : 0
  return (
    <div className="tm-agent">
      <div
        className="tm-scroll"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
        }}
      >
        <div className="tm-welcome sm">
          <div className="tm-welcome-title">
            <span className="t-accent">◆</span> <b>Relay CLI</b> <span className="t-dim">agent · auto-accept edits on</span>
          </div>
          <div className="t-dim">cwd: ~/projects/billing-api</div>
        </div>
        {lines.map((l) => (
          <div key={l.id} className={`tm-line ${l.cls ?? ''}`}>
            {l.segs.length ? l.segs.map((x, i) => <span key={i} className={x.cls}>{x.t}</span>) : ' '}
          </div>
        ))}
      </div>
      <div className="tm-agent-foot">
        {status ? (
          <div className="tm-agent-status">
            <span className="t-accent">{SPIN[tick % SPIN.length]}</span> {status.verb}… <span className="t-dim">({secs}s · esc to interrupt)</span>
          </div>
        ) : (
          <div className="tm-agent-status">&nbsp;</div>
        )}
        <div className="tm-prompt tm-prompt-ro">
          <span className="tm-prompt-label">&gt;</span>
          <span className="t-dim">auto mode · ▸▸ accept edits on (shift+tab to cycle)</span>
        </div>
      </div>
    </div>
  )
}
