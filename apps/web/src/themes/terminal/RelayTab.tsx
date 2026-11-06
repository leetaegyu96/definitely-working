import {
  GAME_META,
  GAME_TYPES,
  LIAR_CATEGORIES,
  LIAR_CATEGORY_LABEL,
  LIMITS,
  QUIZ_CATEGORIES,
  QUIZ_CATEGORY_LABEL,
  type GameType,
} from '@relay/shared'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  configureSession,
  createSession,
  gameAction,
  inviteUrl,
  joinSession,
  leaveSession,
  peekSession,
  sendChat,
  startGame,
  stopGame,
} from '../../features/rooms/api'
import { fmtClock, useRemaining, useServerNow, useSessionModel, type SessionModel } from '../../game-ui/model'
import { usePrefs, WORK_VIEW_KEYS } from '../../stores/prefs'
import { useSession } from '../../stores/session'
import { formatChat, nameColor, WORK_LOG, type TLine } from './format'
import { displayPath, PROJECT, runShell, type Seg, type ShellState } from './shell'

const VERSION = '2.4.1'

interface Cmd {
  name: string
  args?: string
  desc: string
}
const COMMANDS: Cmd[] = [
  { name: '/help', desc: 'Show available commands' },
  { name: '/status', desc: 'Show current session, members and task state' },
  { name: '/new', args: '[type]', desc: 'Create a session: liar | quiz | mafia | wordchain | baseball | twenty' },
  { name: '/join', args: '<CODE>', desc: 'Join a shared session by code' },
  { name: '/invite', desc: 'Copy the invite link for the current session' },
  { name: '/who', desc: 'List session members' },
  { name: '/start', desc: 'Start (or rerun) the task — host only' },
  { name: '/next', desc: 'End discussion and open the vote — host only' },
  { name: '/stop', desc: 'Stop the running task — host only' },
  { name: '/game', args: '<type>', desc: 'Change task type — host only' },
  { name: '/config', args: '<key> <value>', desc: 'Change a setting (run /config to list keys) — host only' },
  { name: '/say', args: '<text>', desc: 'Submit your description (on your turn)' },
  { name: '/vote', args: '<n|name|skip>', desc: 'Vote for a member (skip = abstain in Access Audit)' },
  { name: '/kill', args: '<n|name>', desc: 'Pick a target at night (mafia only)' },
  { name: '/word', args: '<word>', desc: 'Play a word on your turn (Term Chain)' },
  { name: '/reject', desc: 'Reject the last word — host only (Term Chain)' },
  { name: '/code', args: '<digits>', desc: 'Submit a guess (Code Match)' },
  { name: '/ask', args: '<question>', desc: 'Ask a yes/no question (Requirement Discovery)' },
  { name: '/setup', args: '<answer> [category]', desc: 'Set the answer as setter (Requirement Discovery)' },
  { name: '/reply', args: '<y|n|m>', desc: 'Answer the pending question as setter' },
  { name: '/answer', args: '<1-4>', desc: 'Answer the current question' },
  { name: '/guess', args: '<word>', desc: 'Guess the keyword (liar) or the answer (Requirement Discovery)' },
  { name: '/chat', args: '<text>', desc: 'Send a chat message' },
  { name: '/leave', desc: 'Leave the current session' },
  { name: '/name', args: '<name>', desc: 'Set your display name' },
  { name: '/focus', desc: 'Toggle work view (hide session output)' },
  { name: '/theme', args: '<ai|terminal>', desc: 'Switch interface' },
  { name: '/clear', desc: 'Clear the screen' },
]

const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

type PromptMode = { kind: 'normal' } | { kind: 'name'; then: { kind: 'new'; game: GameType } | { kind: 'join'; code: string } }
const isGame = (g: string | undefined): g is GameType => !!g && (GAME_TYPES as string[]).includes(g)

let lid = 0
const mk = (segs: Seg[], scope: TLine['scope'] = 'session', cls?: string): TLine => ({ id: `l${lid++}`, ts: Date.now(), scope, segs, cls })
const t = (text: string, cls?: string): Seg => ({ t: text, cls })

export function RelayTab({ active, onShell }: { active: boolean; onShell(): void }) {
  const prefs = usePrefs()
  const chat = useSession((s) => s.chat)
  const snap = useSession((s) => s.snapshot)
  const status = useSession((s) => s.status)
  const pendingInvite = useSession((s) => s.pendingInvite)
  const notice = useSession((s) => s.notice)
  const m = useSessionModel()

  const [local, setLocal] = useState<TLine[]>([])
  const [clearedAt, setClearedAt] = useState(0)
  const [input, setInput] = useState('')
  const [mode, setMode] = useState<PromptMode>({ kind: 'normal' })
  const [hist, setHist] = useState<string[]>([])
  const [histIdx, setHistIdx] = useState<number | null>(null)
  const [sugIdx, setSugIdx] = useState(0)
  const [selIdx, setSelIdx] = useState(0)
  const [forceChat, setForceChat] = useState(false)
  const shellState = useRef<ShellState>({ cwd: PROJECT, history: [] })
  const inputRef = useRef<HTMLInputElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const composing = useRef(false)

  const print = (segs: Seg[] | string, scope: TLine['scope'] = 'session', cls?: string) =>
    setLocal((l) => [...l, mk(typeof segs === 'string' ? [t(segs)] : segs, scope, cls)])
  const printMany = (rows: (Seg[] | string)[], scope: TLine['scope'] = 'session') =>
    setLocal((l) => [...l, ...rows.map((r) => mk(typeof r === 'string' ? [t(r)] : r, scope))])
  const err = (msg: string) => print([t('  ⎿  ', 't-dim'), t(msg, 't-red')])
  const ok = (msg: string) => print([t('  ⎿  ', 't-dim'), t(msg)])

  /* 초대 링크로 들어온 경우 */
  const handledInvite = useRef<string | null>(null)
  useEffect(() => {
    if (!pendingInvite || handledInvite.current === pendingInvite || status !== 'online') return
    handledInvite.current = pendingInvite
    void peekSession(pendingInvite).then((r) => {
      if (!r.ok) {
        print([t('● ', 't-red'), t(`invite ${pendingInvite}: ${r.error.message}`)])
        useSession.getState().setPendingInvite(null)
        return
      }
      print([t('◆ ', 't-accent'), t('Invitation: '), t(`"${r.data.name}"`, 't-bold'), t(` · ${r.data.members} member(s) · code ${pendingInvite}`, 't-dim')])
      if (prefs.nickname) print([t(`  Press Enter to join as `, 't-dim'), t(prefs.nickname, 't-bold'), t(', or type another display name.', 't-dim')])
      else print([t('  Enter a display name to join.', 't-dim')])
      setMode({ kind: 'name', then: { kind: 'join', code: pendingInvite } })
      if (prefs.nickname) setInput(prefs.nickname)
    })
  }, [pendingInvite, status]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (notice) {
      print([t('● ', 't-yellow'), t(notice)])
      useSession.getState().setNotice(null)
    }
  }, [notice]) // eslint-disable-line react-hooks/exhaustive-deps

  /* 화면 라인 = 업무 로그 + 로컬 출력 + 세션 로그 (시간순) */
  const lines = useMemo(() => {
    const work: TLine[] = WORK_LOG.map((w, i) => ({ id: `w${i}`, ts: 0, scope: 'work', segs: w.segs, cls: w.cls }))
    const sess = formatChat(chat, snap)
    const all = [...work, ...local, ...sess].sort((a, b) => a.ts - b.ts)
    return all.filter((l) => l.ts >= clearedAt || (clearedAt === 0 && l.ts === 0)).filter((l) => !prefs.workView || l.scope === 'work')
  }, [chat, snap, local, clearedAt, prefs.workView])

  // 맨 아래에 붙어 있으면 새 출력/하단 영역 크기 변화 시 계속 따라감
  const stick = useRef(true)
  useEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  })
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      if (stick.current) el.scrollTop = el.scrollHeight
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (active) inputRef.current?.focus()
  }, [active])

  /* 선택 프롬프트 (투표/응답) */
  const task = m?.task
  const select = !prefs.workView && task
    ? task.kind === 'liar.vote' && !task.myVote
      ? { title: task.revote ? 'Re-vote — who is the liar?' : 'Who is the liar?', options: task.options.map((p) => p.name + (p.connected ? '' : ' (offline)')), pick: (i: number) => act({ type: 'liar.vote', targetId: task.options[i].id }) }
      : task.kind === 'quiz.answer' && task.myAnswer === null
        ? { title: 'Select an answer', options: task.choices, pick: (i: number) => act({ type: 'quiz.answer', choice: i }) }
        : task.kind === 'mafia.kill'
          ? { title: task.myPick ? `Night target (current: ${m!.name(task.myPick)})` : 'Night — pick a target', options: task.options.map((p) => p.name), pick: (i: number) => act({ type: 'mafia.kill', targetId: task.options[i].id }) }
          : task.kind === 'mafia.vote'
            ? { title: 'Vote someone out', options: [...task.options.map((p) => p.name), '(abstain)'], pick: (i: number) => act({ type: 'mafia.vote', targetId: task.options[i]?.id ?? null }) }
            : task.kind === 'twenty.reply'
              ? { title: `Reply: ${task.question}`, options: ['예 (yes)', '아니오 (no)', '애매함 (maybe)'], pick: (i: number) => act({ type: 'twenty.reply', questionId: task.questionId, reply: (['yes', 'no', 'maybe'] as const)[i] }) }
              : null
    : null
  const selKey = select ? select.title + select.options.join('|') : ''
  useEffect(() => setSelIdx(0), [selKey])

  const typedMode = !prefs.workView && !forceChat && task
    ? (({ 'liar.describe': 'describe', 'liar.guess': 'guess', 'word.submit': 'word', 'baseball.guess': 'code', 'twenty.ask': 'ask' }) as Record<string, 'describe' | 'guess' | 'word' | 'code' | 'ask'>)[task.kind]
    : undefined
  const inputMode: 'name' | 'describe' | 'guess' | 'word' | 'code' | 'ask' | 'chat' | 'idle' =
    mode.kind === 'name' ? 'name' : typedMode ?? (snap && !prefs.workView ? 'chat' : 'idle')
  useEffect(() => setForceChat(false), [task?.kind])

  async function act(a: Parameters<typeof gameAction>[0]) {
    const r = await gameAction(a)
    if (!r.ok) err(r.error.message)
  }

  /* 자동완성 */
  const suggestions = input.startsWith('/') && !input.includes(' ') && mode.kind === 'normal' ? COMMANDS.filter((c) => c.name.startsWith(input.toLowerCase())) : []
  useEffect(() => setSugIdx(0), [input])

  function need(model: SessionModel | null, host = false): model is SessionModel {
    if (!model) {
      err('no active session — /new to create one or /join <CODE>')
      return false
    }
    if (host && !model.isHost) {
      err(`only the host (${model.host?.name ?? '-'}) can do that`)
      return false
    }
    return true
  }

  async function runNew(game: GameType, name: string) {
    print([t('● ', 't-accent'), t(`Creating ${GAME_META[game].workTitle} session…`)])
    const r = await createSession({ name, gameType: game })
    if (!r.ok) return err(r.error.message)
    usePrefs.getState().setNickname(name)
    const code = r.data.snapshot.code
    printMany([
      [t('  ⎿  ', 't-dim'), t('invite: '), t(inviteUrl(code), 't-cyan t-underline')],
      [t('     code ', 't-dim'), t(code, 't-bold'), t(' · share the link, members join with a display name only', 't-dim')],
    ])
  }

  async function runJoin(code: string, name: string) {
    const r = await joinSession(code, name)
    if (!r.ok) return err(r.error.message)
    usePrefs.getState().setNickname(name)
    print([t('  ⎿  ', 't-dim'), t(`joined "${r.data.snapshot.name}" as `), t(r.data.snapshot.players.find((p) => p.id === r.data.snapshot.meId)?.name ?? name, 't-bold')])
  }

  function statusLines(model: SessionModel) {
    const s = model.snap
    const rows: (Seg[] | string)[] = [
      [t('  session  ', 't-dim'), t(s.name, 't-bold'), t(`  (${s.code})`, 't-dim')],
      [t('  task     ', 't-dim'), t(`${model.meta.workTitle}`), t(`  ${model.settingsSummary}`, 't-dim')],
      [t('  state    ', 't-dim'), t(s.phase.toLowerCase())],
      [t('  members  ', 't-dim'), ...model.players.flatMap((p, i) => [
        ...(i ? [t(', ', 't-dim')] : []),
        t(p.name, p.connected ? nameColor(p.name) : 't-dim'),
        ...(p.id === s.hostId ? [t('*', 't-yellow')] : []),
        ...(p.spectator ? [t('(spec)', 't-dim')] : []),
      ])],
    ]
    if (model.liar) rows.push([t('  role     ', 't-dim'), t(model.liar.myRole)])
    if (model.quiz) rows.push([t('  score    ', 't-dim'), t(String(model.quiz.scores[s.meId] ?? 0))])
    rows.push([t('  link     ', 't-dim'), t(inviteUrl(s.code), 't-cyan')])
    return rows
  }

  async function execute(raw: string) {
    const line = raw.trim()
    // 이름 입력 모드
    if (mode.kind === 'name') {
      const name = line.replace(/\s+/g, ' ').slice(0, LIMITS.nameMax)
      if (!name) return
      print([t('> ', 't-dim'), t(name)], 'session', 'tl-user')
      const then = mode.then
      setMode({ kind: 'normal' })
      if (then.kind === 'new') await runNew(then.game, name)
      else {
        useSession.getState().setPendingInvite(null)
        await runJoin(then.code, name)
      }
      return
    }
    if (!line) {
      if (select) select.pick(selIdx)
      return
    }
    setHist((h) => [...h.filter((x) => x !== line), line].slice(-100))
    setHistIdx(null)

    // !명령 → 가상 셸
    if (line.startsWith('!')) {
      const cmd = line.slice(1).trim()
      print([t('! ', 't-magenta'), t(cmd)], 'work', 'tl-user')
      shellState.current.history.push(cmd)
      const r = runShell(cmd, shellState.current)
      if (r.cwd) shellState.current.cwd = r.cwd
      if (r.clear) return setClearedAt(Date.now())
      if (r.action === 'open-relay') return
      if (r.action === 'exit') return onShell()
      let delay = 0
      for (const o of r.out) {
        delay += o.delay ?? 0
        const segs = o.segs ?? [t(o.text, o.cls)]
        window.setTimeout(() => print([t('  ', 't-dim'), ...segs], 'work'), delay)
      }
      return
    }

    if (!line.startsWith('/')) {
      if (inputMode === 'describe') return act({ type: 'liar.describe', text: line.slice(0, LIMITS.describeMax) })
      if (inputMode === 'guess') return act({ type: 'liar.guess', word: line.slice(0, LIMITS.guessMax) })
      if (inputMode === 'word') return act({ type: 'word.submit', word: line.slice(0, 20) })
      if (inputMode === 'code') return act({ type: 'baseball.guess', guess: line.replace(/\D/g, '').slice(0, 4) })
      if (inputMode === 'ask') return act({ type: 'twenty.ask', text: line.slice(0, 100) })
      if (snap && !prefs.workView) {
        const r = await sendChat(line)
        if (!r.ok) err(r.error.message)
        return
      }
      print([t('> ', 't-dim'), t(line)], 'work', 'tl-user')
      print([t('● ', 't-yellow'), t('Offline workspace — model access is disabled. Use '), t('/help', 't-bold'), t(' for local commands or '), t('!<cmd>', 't-bold'), t(' to run a shell command.')], 'work')
      return
    }

    const [cmdRaw, ...args] = line.split(/\s+/)
    const cmd = cmdRaw.toLowerCase()
    const rest = line.slice(cmdRaw.length).trim()
    print([t('> ', 't-dim'), t(line)], cmd === '/focus' || cmd === '/theme' || cmd === '/clear' ? 'work' : 'session', 'tl-user')

    switch (cmd) {
      case '/help':
      case '/?': {
        const w = Math.max(...COMMANDS.map((c) => (c.name + (c.args ? ' ' + c.args : '')).length)) + 2
        printMany([
          [t('  Relay CLI ', 't-bold'), t(`v${VERSION}`, 't-dim')],
          '',
          ...COMMANDS.map((c) => [t('  ' + (c.name + (c.args ? ' ' + c.args : '')).padEnd(w), 't-cyan'), t(c.desc, 't-dim')]),
          '',
          [t('  Plain text sends a chat message in a session. ', 't-dim'), t('!<cmd>', 't-bold'), t(' runs a shell command. ', 't-dim'), t('↑/↓', 't-bold'), t(' + ', 't-dim'), t('Enter', 't-bold'), t(' selects options.', 't-dim')],
          [t(`  Work view: ${WORK_VIEW_KEYS[prefs.workViewKey]}  ·  Tab completes commands`, 't-dim')],
        ])
        return
      }
      case '/clear':
        setClearedAt(Date.now() + 1)
        return
      case '/theme': {
        const target = args[0]?.toLowerCase()
        if (target === 'ai' || target === 'chat') return prefs.setTheme('ai')
        if (target === 'terminal') return ok('already using terminal')
        return err('usage: /theme <ai|terminal>')
      }
      case '/focus':
        prefs.toggleWorkView()
        return
      case '/name': {
        if (!rest) return ok(`display name: ${prefs.nickname || '(not set)'}`)
        prefs.setNickname(rest.slice(0, LIMITS.nameMax))
        return ok(`display name set to ${rest.slice(0, LIMITS.nameMax)} (applies to new sessions)`)
      }
      case '/rooms':
      case '/status':
        if (!m) return printMany([[t('  no active session', 't-dim')], [t('  /new [liar|quiz] to create · /join <CODE> to join', 't-dim')]])
        return printMany(statusLines(m))
      case '/who':
        if (!need(m)) return
        return printMany(m.players.map((p) => [t('  '), t(p.name, p.connected ? nameColor(p.name) : 't-dim'), t(`${p.id === m.snap.hostId ? '  host' : ''}${p.spectator ? '  spectator' : ''}${p.connected ? '' : '  offline'}${p.id === m.snap.meId ? '  (you)' : ''}`, 't-dim')]))
      case '/new': {
        const g = args[0]?.toLowerCase() ?? 'liar'
        if (!isGame(g)) return err(`usage: /new [${GAME_TYPES.join('|')}]`)
        if (!prefs.nickname) {
          print([t('  display name: ', 't-dim'), t('(type and press Enter)', 't-dim')])
          setMode({ kind: 'name', then: { kind: 'new', game: g } })
          return
        }
        return runNew(g, prefs.nickname)
      }
      case '/join': {
        const code = (args[0] ?? '').replace(/^.*\/s\//, '').toUpperCase()
        if (!/^[A-Z0-9]{6}$/.test(code)) return err('usage: /join <CODE>  (6 characters)')
        if (!prefs.nickname) {
          print([t('  display name: ', 't-dim'), t('(type and press Enter)', 't-dim')])
          setMode({ kind: 'name', then: { kind: 'join', code } })
          return
        }
        return runJoin(code, prefs.nickname)
      }
      case '/invite': {
        if (!need(m)) return
        const url = inviteUrl(m.snap.code)
        navigator.clipboard?.writeText(url).then(
          () => ok('invite link copied to clipboard'),
          () => {},
        )
        return print([t('  ⎿  ', 't-dim'), t(url, 't-cyan t-underline'), t(`  code ${m.snap.code}`, 't-dim')])
      }
      case '/leave': {
        if (!need(m)) return
        await leaveSession()
        return ok('left the session')
      }
      case '/start': {
        if (!need(m, true)) return
        const r = await startGame()
        return r.ok ? undefined : err(r.error.message)
      }
      case '/stop': {
        if (!need(m, true)) return
        const r = await stopGame()
        return r.ok ? undefined : err(r.error.message)
      }
      case '/next':
        if (!need(m, true)) return
        return act(m.mafia ? { type: 'mafia.skip' } : { type: 'liar.skipDiscussion' })
      case '/kill': {
        if (task?.kind !== 'mafia.kill') return err('no night target to pick')
        const n = Number(args[0])
        const target = Number.isInteger(n) && n >= 1 ? task.options[n - 1] : task.options.find((p) => p.name === rest)
        if (!target) return err(`choose 1-${task.options.length} or a member name`)
        return act({ type: 'mafia.kill', targetId: target.id })
      }
      case '/word':
        if (!rest) return err('usage: /word <word>')
        return act({ type: 'word.submit', word: rest.slice(0, 20) })
      case '/reject':
        if (!need(m, true)) return
        return act({ type: 'word.reject' })
      case '/code':
        if (!rest) return err('usage: /code <digits>')
        return act({ type: 'baseball.guess', guess: rest.replace(/\D/g, '').slice(0, 4) })
      case '/ask':
        if (!rest) return err('usage: /ask <question>')
        return act({ type: 'twenty.ask', text: rest.slice(0, 100) })
      case '/setup': {
        if (!args[0]) return err('usage: /setup <answer> [category]')
        return act({ type: 'twenty.setup', answer: args[0].slice(0, 30), category: (args.slice(1).join(' ') || '기타').slice(0, 20) })
      }
      case '/reply': {
        if (task?.kind !== 'twenty.reply') return err('no pending question')
        const r = ({ y: 'yes', yes: 'yes', '예': 'yes', n: 'no', no: 'no', '아니오': 'no', m: 'maybe', maybe: 'maybe', '애매': 'maybe' } as const)[args[0]?.toLowerCase() as 'y']
        if (!r) return err('usage: /reply <y|n|m>')
        return act({ type: 'twenty.reply', questionId: task.questionId, reply: r })
      }
      case '/game': {
        if (!need(m, true)) return
        const g = args[0]?.toLowerCase()
        if (!isGame(g)) return err(`usage: /game <${GAME_TYPES.join('|')}>`)
        const r = await configureSession({ gameType: g })
        return r.ok ? undefined : err(r.error.message)
      }
      case '/config': {
        if (!need(m, true)) return
        const [key, val] = args
        const type = m.snap.gameType
        const KEYS: Record<GameType, Record<string, string>> = {
          liar: { discuss: 'discussSeconds', describe: 'describeSeconds' },
          quiz: { count: 'questionCount', time: 'seconds' },
          mafia: { night: 'nightSeconds', discuss: 'discussSeconds' },
          wordchain: { time: 'turnSeconds' },
          baseball: { digits: 'digits', rounds: 'maxRounds', time: 'roundSeconds' },
          twenty: { questions: 'maxQuestions' },
        }
        const hasCat = type === 'liar' || type === 'quiz'
        if (!key)
          return printMany([
            [t(`  ${m.settingsSummary}`, 't-dim')],
            [t(`  keys: ${[...(hasCat ? [`category <${(type === 'liar' ? LIAR_CATEGORIES : QUIZ_CATEGORIES).join('|')}>`] : []), ...Object.keys(KEYS[type]).map((k) => `${k} <n>`)].join(' · ')}`, 't-dim')],
          ])
        if (key !== 'category' && KEYS[type][key]) {
          const r2 = await configureSession({ settings: { [type]: { [KEYS[type][key]]: Number(val) } } })
          return r2.ok ? ok('updated') : err('invalid value')
        }
        let r
        if (key === 'category') {
          const list = (type === 'liar' ? LIAR_CATEGORIES : QUIZ_CATEGORIES) as readonly string[]
          const labels = (type === 'liar' ? LIAR_CATEGORY_LABEL : QUIZ_CATEGORY_LABEL) as Record<string, string>
          const hit = list.find((c) => c === val || labels[c] === val)
          if (!hit) return err(`category must be one of: ${list.join(', ')}`)
          r = await configureSession({ settings: type === 'liar' ? { liar: { category: hit as never } } : { quiz: { category: hit as never } } })
        } else if (key === 'count' && type === 'quiz') r = await configureSession({ settings: { quiz: { questionCount: Number(val) } } })
        else if (key === 'time' && type === 'quiz') r = await configureSession({ settings: { quiz: { seconds: Number(val) } } })
        else if (key === 'discuss' && type === 'liar') r = await configureSession({ settings: { liar: { discussSeconds: Number(val) } } })
        else return err('unknown key — run /config to see options')
        return r.ok ? ok('updated') : err(r.error.message.includes('Number') || r.error.message.includes('number') ? 'invalid value' : r.error.message)
      }
      case '/say':
        if (!rest) return err('usage: /say <text>')
        return act({ type: 'liar.describe', text: rest.slice(0, LIMITS.describeMax) })
      case '/guess':
        if (!rest) return err('usage: /guess <word>')
        if (m?.twenty) return act({ type: 'twenty.guess', text: rest.slice(0, 30) })
        return act({ type: 'liar.guess', word: rest.slice(0, LIMITS.guessMax) })
      case '/vote': {
        if (!need(m)) return
        if (task?.kind === 'mafia.vote') {
          if (args[0] === 'skip') return act({ type: 'mafia.vote', targetId: null })
          const n = Number(args[0])
          const tg = Number.isInteger(n) && n >= 1 ? task.options[n - 1] : task.options.find((p) => p.name === rest)
          if (!tg) return err(`choose 1-${task.options.length}, a name, or skip`)
          return act({ type: 'mafia.vote', targetId: tg.id })
        }
        if (task?.kind !== 'liar.vote') return err('no vote in progress')
        const n = Number(args[0])
        const target = Number.isInteger(n) && n >= 1 ? task.options[n - 1] : task.options.find((p) => p.name === rest)
        if (!target) return err(`choose 1-${task.options.length} or a member name`)
        return act({ type: 'liar.vote', targetId: target.id })
      }
      case '/answer': {
        if (task?.kind !== 'quiz.answer') return err('no question awaiting an answer')
        const n = Number(args[0])
        if (!(n >= 1 && n <= 4)) return err('usage: /answer <1-4>')
        return act({ type: 'quiz.answer', choice: n - 1 })
      }
      case '/chat': {
        if (!need(m)) return
        if (!rest) return err('usage: /chat <text>')
        const r = await sendChat(rest)
        return r.ok ? undefined : err(r.error.message)
      }
      default:
        return err(`unknown command: ${cmd} — try /help`)
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (composing.current || e.nativeEvent.isComposing) return
    if (suggestions.length) {
      if (e.key === 'ArrowDown') return e.preventDefault(), setSugIdx((i) => (i + 1) % suggestions.length)
      if (e.key === 'ArrowUp') return e.preventDefault(), setSugIdx((i) => (i - 1 + suggestions.length) % suggestions.length)
      if (e.key === 'Tab') return e.preventDefault(), setInput(suggestions[sugIdx].name + (suggestions[sugIdx].args ? ' ' : ''))
      if (e.key === 'Enter' && input !== suggestions[sugIdx].name && !COMMANDS.some((c) => c.name === input.toLowerCase())) {
        e.preventDefault()
        const c = suggestions[sugIdx]
        if (c.args) return setInput(c.name + ' ')
        setInput('')
        void execute(c.name)
        return
      }
    }
    if (select && !input) {
      if (e.key === 'ArrowDown') return e.preventDefault(), setSelIdx((i) => (i + 1) % select.options.length)
      if (e.key === 'ArrowUp') return e.preventDefault(), setSelIdx((i) => (i - 1 + select.options.length) % select.options.length)
      if (/^[1-9]$/.test(e.key) && Number(e.key) <= select.options.length) {
        e.preventDefault()
        return select.pick(Number(e.key) - 1)
      }
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const v = input
      setInput('')
      void execute(v)
      return
    }
    if (e.key === 'Escape') {
      if (mode.kind === 'name') {
        setMode({ kind: 'normal' })
        if (useSession.getState().pendingInvite) useSession.getState().setPendingInvite(null)
        print([t('  ⎿  ', 't-dim'), t('cancelled', 't-dim')])
      } else if (['describe', 'guess', 'word', 'code', 'ask'].includes(inputMode)) setForceChat(true)
      setInput('')
      return
    }
    if (e.key === 'ArrowUp' && hist.length && !select) {
      e.preventDefault()
      const i = histIdx === null ? hist.length - 1 : Math.max(0, histIdx - 1)
      setHistIdx(i)
      setInput(hist[i])
    } else if (e.key === 'ArrowDown' && histIdx !== null) {
      e.preventDefault()
      const i = histIdx + 1
      if (i >= hist.length) {
        setHistIdx(null)
        setInput('')
      } else {
        setHistIdx(i)
        setInput(hist[i])
      }
    } else if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault()
      setClearedAt(Date.now() + 1)
    }
  }

  const promptLabel = { name: 'name ›', describe: 'describe ›', guess: 'guess ›', word: 'word ›', code: 'code ›', ask: 'ask ›', chat: '>', idle: '>' }[inputMode]
  const placeholder = {
    name: 'display name',
    describe: 'describe the keyword without saying it (Esc: chat instead)',
    guess: 'type your keyword guess',
    word: `a word starting with ${task?.kind === 'word.submit' ? task.allowed.join(' / ') : ''} (Esc: chat instead)`,
    code: `${task?.kind === 'baseball.guess' ? task.digits : 3} distinct digits (Esc: chat instead)`,
    ask: 'a yes/no question · /guess <answer> to solve (Esc: chat)',
    chat: select ? '↑/↓ then Enter to choose, or type to chat' : `message ${snap?.name} · /help`,
    idle: 'Try "/help", "/new" or "!git status"',
  }[inputMode]

  return (
    <div className={`tm-relay${active ? '' : ' hidden'}`} onMouseUp={() => !window.getSelection()?.toString() && inputRef.current?.focus()}>
      <div
        className="tm-scroll"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
        }}
      >
        <div className="tm-welcome">
          <div className="tm-welcome-title">
            <span className="t-accent">◆</span> <b>Relay CLI</b> <span className="t-dim">v{VERSION}</span>
          </div>
          <div className="t-dim">/help for commands, /status for the current session</div>
          <div className="t-dim">cwd: {displayPath(PROJECT)}</div>
        </div>
        {lines.map((l) => (
          <div key={l.id} className={`tm-line ${l.cls ?? ''}`}>
            {l.segs.length ? l.segs.map((s, i) => <span key={i} className={s.cls}>{s.t}</span>) : ' '}
          </div>
        ))}
      </div>

      <div className="tm-bottom">
        {!prefs.workView && m && <LiveStatus m={m} />}
        {select && (
          <div className="tm-select">
            <div className="tm-select-title">{select.title}</div>
            {select.options.map((o, i) => (
              <button key={i} type="button" className={`tm-opt${i === selIdx ? ' on' : ''}`} onMouseEnter={() => setSelIdx(i)} onClick={() => select.pick(i)}>
                <span className="tm-caret">{i === selIdx ? '❯' : ' '}</span> {i + 1}. {o}
              </button>
            ))}
          </div>
        )}
        <div className={`tm-prompt${['describe', 'guess', 'word', 'code', 'ask'].includes(inputMode) ? ' hot' : ''}`}>
          <span className="tm-prompt-label">{promptLabel}</span>
          <input
            ref={inputRef}
            value={input}
            spellCheck={false}
            autoComplete="off"
            maxLength={inputMode === 'describe' ? LIMITS.describeMax : inputMode === 'code' ? 4 : 400}
            placeholder={placeholder}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            onCompositionStart={() => (composing.current = true)}
            onCompositionEnd={() => (composing.current = false)}
          />
        </div>
        {suggestions.length > 0 && (
          <div className="tm-sug">
            {suggestions.slice(0, 8).map((c, i) => (
              <button
                key={c.name}
                type="button"
                className={i === sugIdx ? 'on' : ''}
                onMouseDown={(e) => {
                  e.preventDefault()
                  if (c.args) setInput(c.name + ' ')
                  else {
                    setInput('')
                    void execute(c.name)
                  }
                }}
              >
                <span className="tm-sug-name">{c.name}{c.args ? ` ${c.args}` : ''}</span>
                <span className="tm-sug-desc">{c.desc}</span>
              </button>
            ))}
          </div>
        )}
        {!suggestions.length && <HintRow m={prefs.workView ? null : m} run={(c) => void execute(c)} fill={(v) => { setInput(v); inputRef.current?.focus() }} />}
      </div>
    </div>
  )
}

function HintRow({ m, run, fill }: { m: SessionModel | null; run(cmd: string): void; fill(text: string): void }) {
  const status = useSession((s) => s.status)
  const chips: string[] = m
    ? [
        '/status',
        '/invite',
        ...(m.isHost && (m.snap.phase === 'WAITING' || m.snap.phase === 'RESULT') ? ['/start'] : []),
        ...(m.isHost && m.liar?.stage === 'discuss' ? ['/next'] : []),
        '/focus',
      ]
    : ['/help', '/new', '/join', '/focus']
  return (
    <div className="tm-hints">
      <span className="tm-hint-chips">
        <span className="t-dim">? for help ·</span>
        {chips.map((c) => (
          <button key={c} type="button" onClick={() => (c === '/join' ? fill('/join ') : run(c))}>
            {c}
          </button>
        ))}
      </span>
      <span className="tm-hint-status">
        <span className={status === 'online' ? 't-green' : 't-yellow'}>●</span>{' '}
        {status === 'online' ? (m ? `${m.snap.code} · ${m.online} online` : 'connected') : status === 'reconnecting' ? 'reconnecting…' : 'connecting…'}
      </span>
    </div>
  )
}

function Spinner() {
  const now = useServerNow(90)
  return <span className="t-accent">{SPIN[Math.floor(now / 90) % SPIN.length]}</span>
}

function LiveStatus({ m }: { m: SessionModel }) {
  const s = m.snap
  const deadline = m.liar?.deadline ?? m.quiz?.deadline ?? m.mafia?.deadline ?? m.wordchain?.deadline ?? m.baseball?.deadline ?? m.twenty?.deadline ?? null
  const left = useRemaining(deadline)
  const now = useServerNow(250)
  const clock = left !== null ? ` (${fmtClock(left)})` : ''
  let node: React.ReactNode = null

  if (s.phase === 'WAITING') {
    node = (
      <>
        <span className="t-accent">◇</span> {m.meta.workTitle} ready · {m.activeCount} online
        <span className="t-dim">{m.isHost ? (m.canStart.ok ? ' · /start to begin' : ` · ${m.canStart.reason}`) : ` · waiting for ${m.host?.name ?? 'host'} to start`}</span>
      </>
    )
  } else if (s.phase === 'STARTING') {
    const secs = s.startsAt ? Math.max(0, Math.ceil((s.startsAt - now) / 1000)) : 0
    node = <><Spinner /> Assigning task to {m.activeCount} members… <span className="t-dim">{secs}s</span></>
  } else if (s.phase === 'RESULT') {
    node = (
      <>
        <span className="t-green">✓</span> Round complete
        <span className="t-dim">{m.isHost ? ' · /start to rerun · /game <liar|quiz> to switch' : ' · waiting for host'}</span>
      </>
    )
  } else if (m.liar) {
    const v = m.liar
    if (v.stage === 'describe')
      node =
        m.task.kind === 'liar.describe' ? (
          <><span className="t-yellow">✎</span> <b>Your turn</b> — describe the keyword{clock}</>
        ) : (
          <><Spinner /> Waiting for {m.name(v.currentTurnId)}'s description…<span className="t-dim">{clock}</span></>
        )
    else if (v.stage === 'discuss')
      node = <><Spinner /> Discussion<span className="t-dim">{clock}{m.isHost ? ' · /next to open the vote' : ''}</span></>
    else if (v.stage === 'vote')
      node =
        m.task.kind === 'liar.vote' && m.task.myVote ? (
          <><span className="t-green">✓</span> Voted for {m.name(m.task.myVote)} <span className="t-dim">· {v.votedIds.length}/{v.order.length} voted{clock}</span></>
        ) : (
          <><span className="t-yellow">?</span> Vote <span className="t-dim">· {v.votedIds.length}/{v.order.length} voted{clock}</span></>
        )
    else if (v.stage === 'guess')
      node =
        m.task.kind === 'liar.guess' ? (
          <><span className="t-yellow">✎</span> <b>You were caught</b> — guess the keyword to win{clock}</>
        ) : (
          <><Spinner /> {m.name(v.accusedId)} is guessing the keyword…<span className="t-dim">{clock}</span></>
        )
  } else if (m.mafia) {
    const v = m.mafia
    const dead = v.myRole !== 'spectator' && !v.alive.includes(s.meId)
    if (v.stage === 'night')
      node = m.task.kind === 'mafia.kill'
        ? <><span className="t-red">☾</span> <b>Night {v.day}</b> — pick a target{m.task.myPick ? <span className="t-dim"> (current: {m.name(m.task.myPick)})</span> : null}<span className="t-dim">{clock}</span></>
        : <><Spinner /> Night {v.day} — mafia is choosing…<span className="t-dim">{clock}{dead ? ' · you are out' : ''}</span></>
    else if (v.stage === 'day')
      node = <><Spinner /> Day {v.day} discussion · {v.alive.length} alive<span className="t-dim">{clock}{m.isHost ? ' · /next to open the vote' : ''}</span></>
    else if (v.stage === 'vote')
      node = m.task.kind === 'mafia.vote'
        ? <><span className="t-yellow">?</span> Day {v.day} vote <span className="t-dim">· {v.votedIds.length}/{v.alive.length} voted{clock}</span></>
        : <><span className="t-green">✓</span> {v.myVote === undefined ? (dead ? 'You are out' : 'Spectating') : v.myVote ? `Voted for ${m.name(v.myVote)}` : 'Abstained'} <span className="t-dim">· {v.votedIds.length}/{v.alive.length} voted{clock}</span></>
  } else if (m.wordchain) {
    const v = m.wordchain
    node = m.task.kind === 'word.submit'
      ? <><span className="t-yellow">✎</span> <b>Your turn</b> — start with <b>{v.allowed.join(' / ')}</b>{clock}{m.isHost && v.canReject ? <span className="t-dim"> · /reject to void the last word</span> : null}</>
      : <><Spinner /> {m.name(v.currentTurnId)}'s turn — starts with {v.allowed.join(' / ')}<span className="t-dim">{clock}{m.isHost && v.canReject ? ' · /reject to void the last word' : ''}</span></>
  } else if (m.baseball) {
    const v = m.baseball
    node = m.task.kind === 'baseball.guess'
      ? <><span className="t-yellow">✎</span> <b>Turn {v.turn}/{v.maxTurns}</b> — enter {v.digits} distinct digits <span className="t-dim">· {v.submittedIds.length}/{v.participants.length} submitted{clock}</span></>
      : <><span className="t-green">✓</span> Turn {v.turn}/{v.maxTurns}{v.myGuess ? <> · submitted <b>{v.myGuess}</b></> : ''} <span className="t-dim">· {v.submittedIds.length}/{v.participants.length} submitted{clock}</span></>
  } else if (m.twenty) {
    const v = m.twenty
    const used = `${v.questions.length}/${v.maxQuestions}`
    if (v.stage === 'setup')
      node = m.task.kind === 'twenty.setup'
        ? <><span className="t-yellow">✎</span> <b>You are the setter</b> — /setup &lt;answer&gt; &lt;category&gt;{clock}</>
        : <><Spinner /> {m.name(v.setterId)} is choosing the answer…<span className="t-dim">{clock}</span></>
    else if (v.myRole === 'setter')
      node = <><span className="t-yellow">◆</span> answer <b>{v.answer}</b> <span className="t-dim">· {used} questions{v.pendingId ? ` · reply with ↑/↓ or /reply y|n|m${clock}` : ' · waiting for a question'}</span></>
    else
      node = v.pendingId
        ? <><Spinner /> Waiting for {m.name(v.setterId)}'s reply… <span className="t-dim">{used}{clock}</span></>
        : <><span className="t-yellow">?</span> Ask a yes/no question or /guess <span className="t-dim">· category {v.category} · {used} used</span></>
  } else if (m.quiz) {
    const v = m.quiz
    if (v.stage === 'question') {
      const answered = v.myAnswer !== null
      node = (
        <>
          {answered ? <span className="t-green">✓</span> : <span className="t-yellow">?</span>} Q{v.index + 1}/{v.total}{' '}
          {answered && v.question ? <>answered <b>{v.myAnswer! + 1}. {v.question.choices[v.myAnswer!]}</b></> : null}
          <span className="t-dim"> · {v.answeredIds.length}/{v.participants.length} answered{clock}</span>
        </>
      )
    } else if (v.stage === 'reveal' && v.reveal) {
      const g = v.reveal.gained[s.meId]
      node = (
        <>
          {g ? <span className="t-green">✓ +{g}</span> : <span className="t-red">✗</span>} <span className="t-dim">score {v.scores[s.meId] ?? 0} · next question{clock}</span>
        </>
      )
    }
  }
  if (!node) return null
  return <div className="tm-live">{node}</div>
}

