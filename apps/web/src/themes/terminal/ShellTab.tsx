import { useEffect, useRef, useState } from 'react'
import { completeShell, displayPath, HOST, PROJECT, runShell, USER, type Seg, type ShellState } from './shell'

interface Row {
  id: number
  prompt?: { cwd: string; cmd: string }
  segs?: Seg[]
}

let rid = 0

/** WSL bash 탭 — 미리 정의한 가상 명령만 해석한다 */
export function ShellTab({ active, onOpenRelay, onExit }: { active: boolean; onOpenRelay(): void; onExit(): void }) {
  const st = useRef<ShellState>({ cwd: PROJECT, history: [] })
  const [rows, setRows] = useState<Row[]>(() => [
    { id: rid++, segs: [{ t: 'Welcome to Ubuntu 22.04.5 LTS (GNU/Linux 5.15.167.4-microsoft-standard-WSL2 x86_64)' }] },
    { id: rid++, segs: [] },
    { id: rid++, segs: [{ t: ' * Documentation:  https://help.ubuntu.com', cls: 't-dim' }] },
    { id: rid++, segs: [] },
    { id: rid++, segs: [{ t: `Last login: ${new Date(Date.now() - 3600_000 * 5).toString().slice(0, 24)} from 172.24.160.1` }] },
  ])
  const [cwd, setCwd] = useState(PROJECT)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [hIdx, setHIdx] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const scroller = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (active) inputRef.current?.focus()
  }, [active])
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight
  }, [rows, busy])

  function run(cmd: string) {
    setRows((r) => [...r, { id: rid++, prompt: { cwd, cmd } }])
    if (!cmd.trim()) return
    st.current.history.push(cmd)
    const res = runShell(cmd, st.current)
    if (res.clear) return setRows([])
    if (res.cwd) {
      st.current.cwd = res.cwd
      setCwd(res.cwd)
    }
    if (res.action === 'open-relay') return onOpenRelay()
    if (res.action === 'exit') return onExit()
    const timed = res.out.some((o) => o.delay)
    if (!timed) {
      setRows((r) => [...r, ...res.out.map((o) => ({ id: rid++, segs: o.segs ?? [{ t: o.text, cls: o.cls }] }))])
      return
    }
    setBusy(true)
    let delay = 0
    res.out.forEach((o, i) => {
      delay += o.delay ?? 40
      window.setTimeout(() => {
        setRows((r) => [...r, { id: rid++, segs: o.segs ?? [{ t: o.text, cls: o.cls }] }])
        if (i === res.out.length - 1) setBusy(false)
      }, delay)
    })
  }

  const Prompt = ({ dir }: { dir: string }) => (
    <>
      <span className="t-green t-bold">{USER}@{HOST}</span>:<span className="t-blue t-bold">{displayPath(dir)}</span>$&nbsp;
    </>
  )

  return (
    <div className={`tm-shell${active ? '' : ' hidden'}`} ref={scroller} onMouseUp={() => !window.getSelection()?.toString() && inputRef.current?.focus()}>
      {rows.map((r) =>
        r.prompt ? (
          <div key={r.id} className="tm-line"><Prompt dir={r.prompt.cwd} />{r.prompt.cmd}</div>
        ) : (
          <div key={r.id} className="tm-line">{r.segs?.length ? r.segs.map((s, i) => <span key={i} className={s.cls}>{s.t}</span>) : ' '}</div>
        ),
      )}
      {!busy && (
        <div className="tm-line tm-inline">
          <Prompt dir={cwd} />
          <input
            ref={inputRef}
            value={input}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return
              const h = st.current.history
              if (e.key === 'Enter') {
                setHIdx(null)
                run(input)
                setInput('')
              } else if (e.key === 'Tab') {
                e.preventDefault()
                setInput(completeShell(input, st.current))
              } else if (e.key === 'ArrowUp' && h.length) {
                e.preventDefault()
                const i = hIdx === null ? h.length - 1 : Math.max(0, hIdx - 1)
                setHIdx(i)
                setInput(h[i])
              } else if (e.key === 'ArrowDown' && hIdx !== null) {
                e.preventDefault()
                const i = hIdx + 1
                setHIdx(i >= h.length ? null : i)
                setInput(i >= h.length ? '' : h[i])
              } else if (e.key === 'l' && e.ctrlKey) {
                e.preventDefault()
                setRows([])
              } else if (e.key === 'c' && e.ctrlKey && !window.getSelection()?.toString()) {
                e.preventDefault()
                setRows((r) => [...r, { id: rid++, prompt: { cwd, cmd: input + '^C' } }])
                setInput('')
              }
            }}
          />
        </div>
      )}
    </div>
  )
}
