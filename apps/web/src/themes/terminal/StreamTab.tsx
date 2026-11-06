import { useEffect, useRef, useState } from 'react'
import type { Seg } from './shell'

/** 계속 실행 중인 프로세스 로그 탭 (pnpm dev / docker compose logs) — 가상 출력 */
export type StreamKind = 'devserver' | 'docker'

const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)]
const ts = () => new Date().toTimeString().slice(0, 8) + '.' + String(Date.now() % 1000).padStart(3, '0')

const ROUTES = [
  ['GET', '/v2/settlements/st_8f2a1c', 200],
  ['GET', '/v2/settlements?from=2026-11-01&to=2026-11-06', 200],
  ['POST', '/v2/payments/pay_91bd/refunds', 201],
  ['GET', '/v2/payments/pay_7c03', 200],
  ['POST', '/v2/webhooks/dispatch', 202],
  ['GET', '/healthz', 200],
  ['GET', '/v2/merchants/m_204/fees', 200],
  ['POST', '/v2/payments/pay_a1e9/refunds', 409],
] as const

function devLine(): Seg[] {
  const r = Math.random()
  if (r < 0.06) return [{ t: `[${ts()}] `, cls: 't-dim' }, { t: 'WARN', cls: 't-yellow' }, { t: ' (db): slow query 412ms — SELECT ... FROM settlements WHERE merchant_id = $1' }]
  if (r < 0.1) return [{ t: `[${ts()}] `, cls: 't-dim' }, { t: 'INFO', cls: 't-green' }, { t: ` (batch): settle-daily claimed ${20 + Math.floor(Math.random() * 80)} rows (worker w-2)` }]
  const [m, url, st] = pick([...ROUTES])
  const ms = st === 409 ? 8 : 4 + Math.floor(Math.random() * 60)
  return [
    { t: `[${ts()}] `, cls: 't-dim' },
    { t: 'INFO', cls: 't-green' },
    { t: ' (api): ' },
    { t: `${m} ${url} `, cls: 't-fg' },
    { t: String(st), cls: st >= 400 ? 't-yellow' : 't-cyan' },
    { t: ` ${ms}ms`, cls: 't-dim' },
  ]
}

function dockerLine(): Seg[] {
  const d = new Date().toISOString().replace('T', ' ').slice(0, 23)
  const r = Math.random()
  if (r < 0.5)
    return [
      { t: 'postgres-1  | ', cls: 't-cyan' },
      { t: `${d} UTC [${60 + Math.floor(Math.random() * 30)}] LOG:  ` },
      { t: pick(['checkpoint starting: time', 'checkpoint complete: wrote 412 buffers (2.5%); 0 WAL file(s) added', 'automatic vacuum of table "billing.public.webhook_events": index scans: 1', 'duration: 18.204 ms  statement: COMMIT', 'connection authorized: user=billing database=billing']) },
    ]
  if (r < 0.8)
    return [{ t: 'redis-1     | ', cls: 't-magenta' }, { t: `1:M ${new Date().toUTCString().slice(5, 25)} * ` }, { t: pick(['100 changes in 300 seconds. Saving...', 'Background saving started by pid 213', 'DB saved on disk', 'Background saving terminated with success']) }]
  return [{ t: 'mailhog-1   | ', cls: 't-yellow' }, { t: `[SMTP] ${pick(['Starting session', 'Received 2.1KB message', 'Session ended'])}` }]
}

const BANNER: Record<StreamKind, Seg[][]> = {
  devserver: [
    [{ t: 'dev@WS-DEV14', cls: 't-green t-bold' }, { t: ':' }, { t: '~/projects/billing-api', cls: 't-blue t-bold' }, { t: '$ pnpm dev' }],
    [],
    [{ t: '> billing-api@2.14.0 dev /home/dev/projects/billing-api' }],
    [{ t: '> tsx watch src/server.ts' }],
    [],
    [{ t: `[${ts()}] `, cls: 't-dim' }, { t: 'INFO', cls: 't-green' }, { t: ' (api): Server listening at http://0.0.0.0:8080' }],
  ],
  docker: [
    [{ t: 'dev@WS-DEV14', cls: 't-green t-bold' }, { t: ':' }, { t: '~/projects/billing-api', cls: 't-blue t-bold' }, { t: '$ docker compose logs -f --tail 20' }],
    [{ t: 'postgres-1  | ', cls: 't-cyan' }, { t: 'database system is ready to accept connections' }],
    [{ t: 'redis-1     | ', cls: 't-magenta' }, { t: '1:M * Ready to accept connections tcp' }],
  ],
}

let sid = 0
export function StreamTab({ kind, active }: { kind: StreamKind; active: boolean }) {
  const [lines, setLines] = useState(() => BANNER[kind].map((segs) => ({ id: sid++, segs })))
  const ref = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  useEffect(() => {
    let t: number
    const loop = () => {
      const burst = Math.random() < 0.2 ? 3 : 1
      setLines((l) => [...l, ...Array.from({ length: burst }, () => ({ id: sid++, segs: kind === 'devserver' ? devLine() : dockerLine() }))].slice(-500))
      t = window.setTimeout(loop, kind === 'devserver' ? 700 + Math.random() * 2600 : 1800 + Math.random() * 5000)
    }
    t = window.setTimeout(loop, 1000)
    return () => clearTimeout(t)
  }, [kind])

  useEffect(() => {
    const el = ref.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [lines, active])

  return (
    <div
      className={`tm-shell${active ? '' : ' hidden'}`}
      ref={ref}
      onScroll={(e) => {
        const el = e.currentTarget
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
      }}
    >
      {lines.map((l) => (
        <div key={l.id} className="tm-line">
          {l.segs.length ? l.segs.map((x, i) => <span key={i} className={x.cls}>{x.t}</span>) : ' '}
        </div>
      ))}
    </div>
  )
}
