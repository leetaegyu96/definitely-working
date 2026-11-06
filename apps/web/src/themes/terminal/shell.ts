/**
 * 가상 셸 (WSL Ubuntu 흉내).
 * 보안: 실제 명령은 절대 실행하지 않는다. 아래에 정의된 명령만 문자열로 해석해 미리 정한 출력을 돌려준다.
 */

export type Seg = { t: string; cls?: string }
export type Out = { text: string; cls?: string; delay?: number; segs?: Seg[] }

export interface ShellState {
  cwd: string
  history: string[]
}

export const USER = 'dev'
export const HOST = 'WS-DEV14'
export const HOME = '/home/dev'
export const PROJECT = `${HOME}/projects/billing-api`

type Node = { type: 'dir'; children: Record<string, Node> } | { type: 'file'; content: string }
const dir = (children: Record<string, Node>): Node => ({ type: 'dir', children })
const file = (content: string): Node => ({ type: 'file', content })

const FS: Node = dir({
  home: dir({
    dev: dir({
      projects: dir({
        'billing-api': dir({
          'package.json': file(`{
  "name": "billing-api",
  "version": "2.14.0",
  "private": true,
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc -p tsconfig.build.json",
    "test": "vitest run",
    "lint": "eslint src --ext .ts"
  },
  "dependencies": {
    "fastify": "^4.28.1",
    "pg": "^8.13.0",
    "zod": "^3.23.8"
  }
}`),
          'README.md': file(`# billing-api

결제·정산 API 서버.

## 실행
pnpm install
pnpm dev

## 테스트
pnpm test`),
          'tsconfig.json': file(`{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "strict": true,
    "outDir": "dist"
  }
}`),
          '.env.example': file(`DATABASE_URL=postgres://localhost:5432/billing
PAYOUT_API_URL=https://payout.internal.example
LOG_LEVEL=info`),
          src: dir({
            'server.ts': file(`import Fastify from 'fastify'
import { settlementRoutes } from './settlement/routes.js'

const app = Fastify({ logger: true })
app.register(settlementRoutes, { prefix: '/v2/settlements' })

app.listen({ port: Number(process.env.PORT ?? 8080), host: '0.0.0.0' })`),
            settlement: dir({
              'batch.ts': file(`export async function settleDaily(date: string) {
  const rows = await repo.claimPending(date, { workerId, limit: 500 })
  for (const row of rows) {
    try {
      await payout.send(row.merchantId, row.amount, {
        idempotencyKey: \`settle:\${row.id}\`,
      })
      await repo.markSettled(row.id)
    } catch (err) {
      await repo.release(row.id, { reason: String(err) })
    }
  }
}`),
              'routes.ts': file(`import type { FastifyInstance } from 'fastify'

export async function settlementRoutes(app: FastifyInstance) {
  app.get('/:id', async (req) => repo.findById((req.params as { id: string }).id))
  app.post('/:id/retry', async (req) => service.retry((req.params as { id: string }).id))
}`),
              'repo.ts': file(`export const repo = {
  async claimPending(date: string, opts: { workerId: string; limit: number }) { /* ... */ },
  async markSettled(id: string) { /* ... */ },
  async release(id: string, info: { reason: string }) { /* ... */ },
}`),
            }),
            payment: dir({
              'refund.ts': file(`export function validatePartialRefund(paid: number, refunded: number, amount: number) {
  if (amount <= 0) throw new Error('INVALID_AMOUNT')
  if (refunded + amount > paid) throw new Error('REFUND_EXCEEDS_PAYMENT')
}`),
            }),
          }),
          test: dir({
            'batch.test.ts': file(`describe('settleDaily', () => {
  it('does not pay twice when markSettled fails', async () => { /* ... */ })
})`),
          }),
        }),
        'admin-web': dir({ 'package.json': file('{ "name": "admin-web" }') }),
      }),
      '.bashrc': file('# ~/.bashrc\nexport PATH="$HOME/.local/bin:$PATH"'),
      'notes.md': file('- 11/10 쿠폰 정책 초안\n- 정산 배치 재시도 횟수 제한 반영'),
    }),
  }),
})

function resolve(cwd: string, p: string): string {
  if (!p || p === '~') return HOME
  let path = p.startsWith('~') ? HOME + p.slice(1) : p.startsWith('/') ? p : `${cwd}/${p}`
  const parts: string[] = []
  for (const seg of path.split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  path = '/' + parts.join('/')
  return path
}

function lookup(path: string): Node | null {
  let node: Node = FS
  for (const seg of path.split('/').filter(Boolean)) {
    if (node.type !== 'dir' || !node.children[seg]) return null
    node = node.children[seg]
  }
  return node
}

export function displayPath(cwd: string) {
  return cwd === HOME ? '~' : cwd.startsWith(HOME + '/') ? '~' + cwd.slice(HOME.length) : cwd
}

const inProject = (cwd: string) => cwd.startsWith(PROJECT)

const GIT_STATUS: Out[] = [
  { text: 'On branch feature/settlement-idempotency' },
  { text: "Your branch is up to date with 'origin/feature/settlement-idempotency'." },
  { text: '' },
  { text: 'Changes not staged for commit:' },
  { text: '  (use "git add <file>..." to update what will be committed)' },
  { text: '        modified:   src/settlement/batch.ts', cls: 't-red' },
  { text: '        modified:   src/settlement/repo.ts', cls: 't-red' },
  { text: '' },
  { text: 'Untracked files:' },
  { text: '        test/batch.test.ts', cls: 't-red' },
  { text: '' },
  { text: 'no changes added to commit (use "git add" and/or "git commit -a")' },
]

const GIT_LOG: Out[] = [
  { text: 'a3f9c21 (HEAD -> feature/settlement-idempotency) feat(settlement): claim pending rows before payout', cls: 't-yellow' },
  { text: '7be0d14 fix(settlement): pass idempotency key to payout client', cls: 't-yellow' },
  { text: '19c4e8a (origin/main, main) chore: bump fastify to 4.28.1', cls: 't-yellow' },
  { text: 'e2d7f50 feat(payment): partial refund validation', cls: 't-yellow' },
  { text: '0c91b3e docs: update README run instructions', cls: 't-yellow' },
]

const TEST_RUN: Out[] = [
  { text: '' },
  { text: ' RUN  v2.1.9 /home/dev/projects/billing-api', cls: 't-cyan', delay: 300 },
  { text: '' },
  { text: ' ✓ test/refund.test.ts (6 tests) 14ms', cls: 't-green', delay: 400 },
  { text: ' ✓ test/routes.test.ts (9 tests) 41ms', cls: 't-green', delay: 350 },
  { text: ' ✓ test/batch.test.ts (4 tests) 22ms', cls: 't-green', delay: 500 },
  { text: '' },
  { text: ' Test Files  3 passed (3)', cls: 't-green' },
  { text: '      Tests  19 passed (19)', cls: 't-green' },
  { text: '   Duration  1.84s' },
  { text: '' },
]

const BUILD_RUN: Out[] = [
  { text: '' },
  { text: '> billing-api@2.14.0 build /home/dev/projects/billing-api' },
  { text: '> tsc -p tsconfig.build.json' },
  { text: '', delay: 1400 },
]

const LINT_RUN: Out[] = [
  { text: '' },
  { text: '> billing-api@2.14.0 lint /home/dev/projects/billing-api' },
  { text: '> eslint src --ext .ts' },
  { text: '', delay: 900 },
  { text: '/home/dev/projects/billing-api/src/settlement/repo.ts' },
  { text: '  2:43  warning  \'opts\' is defined but never used  @typescript-eslint/no-unused-vars', cls: 't-yellow' },
  { text: '' },
  { text: '✖ 1 problem (0 errors, 1 warning)', cls: 't-yellow' },
  { text: '' },
]

export interface ShellResult {
  out: Out[]
  cwd?: string
  clear?: boolean
  /** UI 측 동작 요청 */
  action?: 'open-relay' | 'exit'
}

export const SHELL_COMMANDS = ['ls', 'cd', 'pwd', 'cat', 'echo', 'clear', 'whoami', 'hostname', 'date', 'uname', 'git', 'npm', 'pnpm', 'node', 'history', 'help', 'relay', 'exit', 'tree', 'code']

export function runShell(input: string, st: ShellState): ShellResult {
  const line = input.trim()
  if (!line) return { out: [] }
  const [cmd, ...args] = line.split(/\s+/)
  const rest = line.slice(cmd.length).trim()
  switch (cmd) {
    case 'pwd':
      return { out: [{ text: st.cwd }] }
    case 'whoami':
      return { out: [{ text: USER }] }
    case 'hostname':
      return { out: [{ text: HOST }] }
    case 'uname':
      return { out: [{ text: args.includes('-a') ? 'Linux WS-DEV14 5.15.167.4-microsoft-standard-WSL2 #1 SMP x86_64 GNU/Linux' : 'Linux' }] }
    case 'date':
      return { out: [{ text: new Date().toString().replace(/ \(.+\)$/, '') }] }
    case 'echo':
      return { out: [{ text: rest.replace(/^["']|["']$/g, '').replace(/\$USER/g, USER).replace(/\$HOME/g, HOME) }] }
    case 'clear':
      return { out: [], clear: true }
    case 'history':
      return { out: st.history.slice(-20).map((h, i) => ({ text: `${String(st.history.length - Math.min(20, st.history.length) + i + 1).padStart(5)}  ${h}` })) }
    case 'help':
      return {
        out: [
          { text: 'GNU bash, version 5.1.16(1)-release (x86_64-pc-linux-gnu)' },
          { text: 'Available in this shell: ' + SHELL_COMMANDS.join(', '), cls: 't-dim' },
        ],
      }
    case 'cd': {
      const target = resolve(st.cwd, args[0] ?? '~')
      const node = lookup(target)
      if (!node) return { out: [{ text: `bash: cd: ${args[0]}: No such file or directory` }] }
      if (node.type !== 'dir') return { out: [{ text: `bash: cd: ${args[0]}: Not a directory` }] }
      return { out: [], cwd: target }
    }
    case 'ls': {
      const flags = args.filter((a) => a.startsWith('-')).join('')
      const target = resolve(st.cwd, args.find((a) => !a.startsWith('-')) ?? '.')
      const node = lookup(target)
      if (!node) return { out: [{ text: `ls: cannot access '${args.find((a) => !a.startsWith('-'))}': No such file or directory` }] }
      if (node.type === 'file') return { out: [{ text: target.split('/').pop()! }] }
      let names = Object.keys(node.children).sort()
      if (!flags.includes('a')) names = names.filter((n) => !n.startsWith('.'))
      if (flags.includes('l')) {
        const rows: Out[] = [{ text: `total ${names.length * 4}` }]
        for (const n of names) {
          const c = node.children[n]
          const isDir = c.type === 'dir'
          const size = isDir ? 4096 : (c as { content: string }).content.length
          rows.push({ text: `${isDir ? 'drwxr-xr-x' : '-rw-r--r--'} 1 dev dev ${String(size).padStart(5)} Nov  6 09:${String(10 + (n.length % 49)).padStart(2, '0')} ${n}`, cls: isDir ? 't-blue' : undefined })
        }
        return { out: rows }
      }
      const segs: Seg[] = []
      names.forEach((n, i) => {
        if (i) segs.push({ t: '  ' })
        segs.push({ t: n, cls: node.children[n].type === 'dir' ? 't-blue t-bold' : undefined })
      })
      return { out: [{ text: names.join('  '), segs }] }
    }
    case 'tree': {
      const node = lookup(st.cwd)
      if (!node || node.type !== 'dir') return { out: [] }
      const out: Out[] = [{ text: '.', cls: 't-blue' }]
      const walk = (n: Node, prefix: string, depth: number) => {
        if (n.type !== 'dir' || depth > 3) return
        const keys = Object.keys(n.children).filter((k) => !k.startsWith('.')).sort()
        keys.forEach((k, i) => {
          const last = i === keys.length - 1
          const child = n.children[k]
          out.push({ text: `${prefix}${last ? '└── ' : '├── '}${k}`, cls: child.type === 'dir' ? 't-blue' : undefined })
          walk(child, prefix + (last ? '    ' : '│   '), depth + 1)
        })
      }
      walk(node, '', 0)
      return { out }
    }
    case 'cat': {
      if (!args[0]) return { out: [] }
      const node = lookup(resolve(st.cwd, args[0]))
      if (!node) return { out: [{ text: `cat: ${args[0]}: No such file or directory` }] }
      if (node.type === 'dir') return { out: [{ text: `cat: ${args[0]}: Is a directory` }] }
      return { out: node.content.split('\n').map((text) => ({ text })) }
    }
    case 'git': {
      if (!inProject(st.cwd)) return { out: [{ text: 'fatal: not a git repository (or any of the parent directories): .git' }] }
      const sub = args[0]
      if (sub === 'status') return { out: GIT_STATUS }
      if (sub === 'log') return { out: GIT_LOG }
      if (sub === 'branch')
        return { out: [{ text: '* feature/settlement-idempotency', cls: 't-green' }, { text: '  main' }, { text: '  fix/refund-rounding' }] }
      if (sub === 'diff')
        return {
          out: [
            { text: 'diff --git a/src/settlement/batch.ts b/src/settlement/batch.ts', cls: 't-bold' },
            { text: '@@ -1,6 +1,12 @@', cls: 't-cyan' },
            { text: '-  const rows = await repo.findPending(date)', cls: 't-red' },
            { text: '+  const rows = await repo.claimPending(date, { workerId, limit: 500 })', cls: 't-green' },
            { text: '   for (const row of rows) {' },
            { text: '-    await payout.send(row.merchantId, row.amount)', cls: 't-red' },
            { text: '+    try {', cls: 't-green' },
            { text: '+      await payout.send(row.merchantId, row.amount, {', cls: 't-green' },
            { text: '+        idempotencyKey: `settle:${row.id}`,', cls: 't-green' },
            { text: '+      })', cls: 't-green' },
          ],
        }
      if (sub === 'pull') return { out: [{ text: 'Already up to date.' }] }
      if (sub === 'fetch') return { out: [] }
      if (!sub) return { out: [{ text: 'usage: git [--version] [--help] <command> [<args>]' }] }
      return { out: [{ text: `git: '${sub}' is not available in this environment.` }] }
    }
    case 'npm':
    case 'pnpm': {
      if (args[0] === '-v' || args[0] === '--version') return { out: [{ text: cmd === 'npm' ? '10.9.0' : '9.12.3' }] }
      if (!inProject(st.cwd)) return { out: [{ text: `${cmd === 'npm' ? 'npm error' : ' ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND '} No package.json found in ${st.cwd}`, cls: 't-red' }] }
      const script = args[0] === 'run' ? args[1] : args[0]
      if (script === 'test' || script === 't') return { out: [{ text: `> billing-api@2.14.0 test /home/dev/projects/billing-api` }, { text: '> vitest run' }, ...TEST_RUN] }
      if (script === 'build') return { out: BUILD_RUN }
      if (script === 'lint') return { out: LINT_RUN }
      if (script === 'install' || script === 'i')
        return { out: [{ text: 'Lockfile is up to date, resolution step is skipped', delay: 300 }, { text: 'Already up to date', delay: 400 }, { text: '' }, { text: `Done in 1.2s using ${cmd} v${cmd === 'npm' ? '10.9.0' : '9.12.3'}` }] }
      if (script === 'dev') return { out: [{ text: 'dev server is managed by the docker compose stack in this workspace (see README).', cls: 't-dim' }] }
      return { out: [{ text: `${cmd}: missing script: ${script ?? ''}`, cls: 't-red' }] }
    }
    case 'node':
      if (args[0] === '-v' || args[0] === '--version') return { out: [{ text: 'v22.11.0' }] }
      return { out: [{ text: 'Interactive node REPL is disabled in this shell.', cls: 't-dim' }] }
    case 'code':
      return { out: [{ text: 'Opening VS Code is not supported from this terminal session.', cls: 't-dim' }] }
    case 'relay':
      return { out: [], action: 'open-relay' }
    case 'exit':
      return { out: [{ text: 'logout' }], action: 'exit' }
    case 'sudo':
      return { out: [{ text: `[sudo] password for ${USER}: ` }, { text: 'sudo: a password is required', cls: 't-red' }] }
    default:
      return { out: [{ text: `${cmd}: command not found` }] }
  }
}

/** 탭 자동완성 (명령어 / 경로) */
export function completeShell(input: string, st: ShellState): string {
  const parts = input.split(' ')
  if (parts.length === 1) {
    const hits = SHELL_COMMANDS.filter((c) => c.startsWith(parts[0]))
    return hits.length === 1 ? hits[0] + ' ' : input
  }
  const last = parts[parts.length - 1]
  const base = last.includes('/') ? last.slice(0, last.lastIndexOf('/') + 1) : ''
  const partial = last.slice(base.length)
  const node = lookup(resolve(st.cwd, base || '.'))
  if (!node || node.type !== 'dir') return input
  const hits = Object.keys(node.children).filter((n) => n.startsWith(partial))
  if (hits.length !== 1) return input
  const child = node.children[hits[0]]
  parts[parts.length - 1] = base + hits[0] + (child.type === 'dir' ? '/' : ' ')
  return parts.join(' ')
}
