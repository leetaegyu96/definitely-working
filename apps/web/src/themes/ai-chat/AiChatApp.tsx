import {
  Briefcase,
  ChevronDown,
  Copy,
  Download,
  Eye,
  EyeOff,
  HelpCircle,
  Link2,
  LogIn,
  LogOut,
  MoreHorizontal,
  PanelLeft,
  PanelRight,
  Pencil,
  Plus,
  Search,
  Settings,
  SquarePen,
  SquareTerminal,
  Trash2,
  Users,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { inviteUrl, leaveSession } from '../../features/rooms/api'
import { needsAttention, useSessionModel, type SessionModel } from '../../game-ui/model'
import { homePath } from '../../lib/paths'
import { load, save } from '../../lib/storage'
import { usePrefs, WORK_VIEW_KEYS } from '../../stores/prefs'
import { useSession } from '../../stores/session'
import './ai-chat.css'
import { ArtifactPanel } from './ArtifactPanel'
import { ConversationView } from './ConversationView'
import { CONVERSATIONS, GROUP_LABEL, type DemoConversation, type DemoMessage } from './data'
import { JoinDialog, NewSessionDialog, SearchDialog, SettingsDialog } from './Dialogs'
import { SessionView } from './SessionView'
import { Avatar, BrandMark, MenuItem, MenuSep, Popover, useToast } from './ui'

type View = { kind: 'conv'; id: string } | { kind: 'new' } | { kind: 'session' }

const CONV_KEY = 'relay.ai.conversations.v1'
const MODELS = [
  { id: 'relay-4', name: 'Relay 4', desc: '복잡한 업무와 문서 작업에 적합' },
  { id: 'relay-4-mini', name: 'Relay 4 mini', desc: '빠른 답변이 필요한 일상 업무' },
]

function useConversations() {
  const [list, setList] = useState<DemoConversation[]>(() => load<DemoConversation[] | null>(CONV_KEY, null) ?? CONVERSATIONS)
  useEffect(() => save(CONV_KEY, list), [list])
  return [list, setList] as const
}

export function AiChatApp() {
  const prefs = usePrefs()
  const session = useSession()
  const model = useSessionModel()
  const [convs, setConvs] = useConversations()
  const [view, setView] = useState<View>(() => (session.membership ? { kind: 'session' } : { kind: 'conv', id: convs[0]?.id ?? '' }))
  const lastConv = useRef<string>(convs[0]?.id ?? '')
  const [dialog, setDialog] = useState<null | 'new' | 'join' | 'settings' | 'search'>(null)
  const [toastNode, toast] = useToast()
  const isNarrow = () => window.matchMedia('(max-width: 760px)').matches

  // 좁은 화면에서는 사이드바를 닫은 상태로 시작
  useEffect(() => {
    if (isNarrow()) prefs.setSidebarOpen(false)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const select = (v: View) => {
    setView(v)
    if (isNarrow()) prefs.setSidebarOpen(false)
  }

  // 초대 링크로 들어온 경우 참여 대화상자
  useEffect(() => {
    if (session.pendingInvite) setDialog('join')
  }, [session.pendingInvite])

  // 세션이 생기면(재접속 포함) 세션 화면, 사라지면 이전 대화로
  const hasRoom = !!session.snapshot
  useEffect(() => {
    if (!hasRoom && view.kind === 'session' && !session.membership) setView({ kind: 'conv', id: lastConv.current })
  }, [hasRoom, session.membership]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (session.notice) {
      toast(session.notice)
      session.setNotice(null)
    }
  }, [session.notice]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (view.kind === 'conv') lastConv.current = view.id
  }, [view])

  // Ctrl+K 검색, Ctrl+Shift+O 새 채팅
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setDialog('search')
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'o') {
        e.preventDefault()
        setView({ kind: 'new' })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 업무 보기에서는 세션 화면 대신 마지막 업무 대화를 보여준다
  const effective: View = prefs.workView && view.kind === 'session' ? { kind: 'conv', id: lastConv.current } : view
  const conv = effective.kind === 'conv' ? (convs.find((c) => c.id === effective.id) ?? null) : null
  const showSession = effective.kind === 'session' && model

  // 브라우저 탭 제목은 항상 업무 맥락
  useEffect(() => {
    const t = showSession ? model!.snap.name : conv?.title
    document.title = t ? `${t} | Relay` : 'Relay'
  }, [showSession, model?.snap.name, conv?.title]) // eslint-disable-line react-hooks/exhaustive-deps

  const appendMessages = useCallback(
    (convId: string | null, msgs: DemoMessage[]) => {
      let id = convId
      if (!id) {
        id = `c-${Date.now().toString(36)}`
        const title = msgs[0].content.replace(/\s+/g, ' ').slice(0, 28)
        const created: DemoConversation = { id, title, group: 'today', messages: msgs }
        setConvs((l) => [created, ...l])
        setView({ kind: 'conv', id })
        return id
      }
      setConvs((l) => l.map((c) => (c.id === id ? { ...c, messages: [...c.messages, ...msgs] } : c)))
      return id
    },
    [setConvs],
  )

  const replaceMessage = useCallback(
    (convId: string, index: number, msg: DemoMessage) =>
      setConvs((l) => l.map((c) => (c.id === convId ? { ...c, messages: c.messages.map((m, i) => (i === index ? msg : m)) } : c))),
    [setConvs],
  )

  return (
    <div className={`ac-root${prefs.sidebarOpen ? '' : ' sb-closed'}`}>
      {prefs.sidebarOpen && (
        <Sidebar
          convs={convs}
          view={effective}
          model={model}
          onSelect={select}
          onDialog={(d) => {
            if (isNarrow()) prefs.setSidebarOpen(false)
            setDialog(d)
          }}
          onRename={(id, title) => setConvs((l) => l.map((c) => (c.id === id ? { ...c, title } : c)))}
          onDelete={(id) => {
            setConvs((l) => l.filter((c) => c.id !== id))
            if (effective.kind === 'conv' && effective.id === id) setView({ kind: 'new' })
            toast('대화를 삭제했습니다')
          }}
          toast={toast}
        />
      )}
      {prefs.sidebarOpen && <div className="ac-sb-backdrop" onClick={() => prefs.setSidebarOpen(false)} />}
      <main className="ac-main">
        <TopBar
          conv={conv}
          model={showSession ? model : null}
          onNew={() => setView({ kind: 'new' })}
          onLeft={() => setView({ kind: 'conv', id: lastConv.current })}
          onRename={(title) => conv && setConvs((l) => l.map((c) => (c.id === conv.id ? { ...c, title } : c)))}
          onDelete={() => {
            if (!conv) return
            setConvs((l) => l.filter((c) => c.id !== conv.id))
            setView({ kind: 'new' })
            toast('대화를 삭제했습니다')
          }}
          toast={toast}
        />
        {showSession ? (
          <SessionView key={model!.snap.code} m={model!} toast={toast} />
        ) : effective.kind === 'session' ? (
          <div className="ac-main-body"><div className="ac-empty"><p className="ac-muted">세션에 다시 연결하는 중…</p></div></div>
        ) : (
          <ConversationView conv={conv} onSend={appendMessages} onReplace={replaceMessage} />
        )}
      </main>
      {prefs.sidePanel && <ArtifactPanel />}

      <NewSessionDialog open={dialog === 'new'} onClose={() => setDialog(null)} onCreated={() => { setDialog(null); setView({ kind: 'session' }); prefs.setWorkView(false) }} />
      <JoinDialog
        open={dialog === 'join'}
        initialCode={session.pendingInvite}
        onClose={() => {
          setDialog(null)
          if (session.pendingInvite) {
            session.setPendingInvite(null)
            history.replaceState(null, '', homePath())
          }
        }}
        onJoined={() => {
          setDialog(null)
          setView({ kind: 'session' })
          prefs.setWorkView(false)
        }}
      />
      <SettingsDialog open={dialog === 'settings'} onClose={() => setDialog(null)} />
      <SearchDialog
        open={dialog === 'search'}
        onClose={() => setDialog(null)}
        conversations={convs}
        onPick={(id) => {
          setDialog(null)
          setView({ kind: 'conv', id })
        }}
      />
      {toastNode}
    </div>
  )
}

/* ───────────────────────── Sidebar ───────────────────────── */

function Sidebar({
  convs,
  view,
  model,
  onSelect,
  onDialog,
  onRename,
  onDelete,
  toast,
}: {
  convs: DemoConversation[]
  view: View
  model: SessionModel | null
  onSelect(v: View): void
  onDialog(d: 'new' | 'join' | 'settings' | 'search'): void
  onRename(id: string, title: string): void
  onDelete(id: string): void
  toast(s: string): void
}) {
  const prefs = usePrefs()
  const status = useSession((s) => s.status)
  const membership = useSession((s) => s.membership)
  const [menu, setMenu] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [userMenu, setUserMenu] = useState(false)
  const attention = prefs.workView && needsAttention(model)

  const groups = useMemo(() => {
    const g: Record<string, DemoConversation[]> = { today: [], week: [], month: [] }
    for (const c of convs) g[c.group].push(c)
    return g
  }, [convs])

  return (
    <aside className="ac-sidebar">
      <div className="ac-sb-top">
        <button type="button" className="ac-brand" onClick={() => onSelect({ kind: 'new' })}>
          <BrandMark size={22} />
          <span>Relay</span>
        </button>
        <button type="button" className="ac-icon-btn" title="사이드바 닫기" onClick={() => prefs.setSidebarOpen(false)}>
          <PanelLeft size={18} />
        </button>
      </div>

      <nav className="ac-sb-nav">
        <button type="button" className={`ac-sb-item${view.kind === 'new' ? ' active' : ''}`} onClick={() => onSelect({ kind: 'new' })}>
          <SquarePen size={16} /> <span>새 채팅</span> <span className="ac-sb-hint">Ctrl+Shift+O</span>
        </button>
        <button type="button" className="ac-sb-item" onClick={() => onDialog('search')}>
          <Search size={16} /> <span>채팅 검색</span> <span className="ac-sb-hint">Ctrl+K</span>
        </button>
      </nav>

      <div className="ac-sb-scroll">
        {!prefs.workView && (
          <div className="ac-sb-section">
            <div className="ac-sb-label">
              <span>워크스페이스</span>
              <button type="button" className="ac-icon-btn sm" title="새 공유 세션" onClick={() => onDialog('new')}>
                <Plus size={15} />
              </button>
            </div>
            {model && (
              <button
                type="button"
                className={`ac-sb-item ac-sb-session${view.kind === 'session' ? ' active' : ''}`}
                onClick={() => onSelect({ kind: 'session' })}
              >
                <Users size={16} />
                <span className="ac-sb-title">{model.snap.name}</span>
                <span className={`ac-sb-badge${status === 'online' ? '' : ' warn'}`}>
                  {status === 'online' ? `${model.online}명` : '재연결'}
                </span>
              </button>
            )}
            {!model && membership && (
              <div className="ac-sb-item ac-sb-muted"><Users size={16} /> <span>세션에 다시 연결하는 중…</span></div>
            )}
            {!model && !membership && (
              <>
                <button type="button" className="ac-sb-item" onClick={() => onDialog('new')}>
                  <Briefcase size={16} /> <span>새 공유 세션</span>
                </button>
                <button type="button" className="ac-sb-item" onClick={() => onDialog('join')}>
                  <LogIn size={16} /> <span>코드로 참여</span>
                </button>
              </>
            )}
          </div>
        )}
        {(['today', 'week', 'month'] as const).map((g) =>
          groups[g].length ? (
            <div key={g} className="ac-sb-section">
              <div className="ac-sb-label"><span>{GROUP_LABEL[g]}</span></div>
              {groups[g].map((c) => (
                <div key={c.id} className={`ac-sb-conv${view.kind === 'conv' && view.id === c.id ? ' active' : ''}${menu === c.id ? ' menu-open' : ''}`}>
                  {renaming === c.id ? (
                    <input
                      className="ac-sb-rename"
                      defaultValue={c.title}
                      autoFocus
                      onBlur={(e) => {
                        if (e.target.value.trim()) onRename(c.id, e.target.value.trim())
                        setRenaming(null)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                        if (e.key === 'Escape') setRenaming(null)
                      }}
                    />
                  ) : (
                    <button type="button" className="ac-sb-conv-btn" onClick={() => onSelect({ kind: 'conv', id: c.id })} title={c.title}>
                      {c.title}
                    </button>
                  )}
                  <button type="button" className="ac-sb-more" data-popover-anchor onClick={() => setMenu(menu === c.id ? null : c.id)} aria-label="옵션">
                    <MoreHorizontal size={16} />
                  </button>
                  <Popover open={menu === c.id} onClose={() => setMenu(null)} align="right">
                    <MenuItem icon={<Pencil size={15} />} onClick={() => { setMenu(null); setRenaming(c.id) }}>이름 바꾸기</MenuItem>
                    <MenuItem icon={<Download size={15} />} onClick={() => { setMenu(null); exportConversation(c); toast('Markdown 파일로 내보냈습니다') }}>내보내기</MenuItem>
                    <MenuSep />
                    <MenuItem icon={<Trash2 size={15} />} danger onClick={() => { setMenu(null); onDelete(c.id) }}>삭제</MenuItem>
                  </Popover>
                </div>
              ))}
            </div>
          ) : null,
        )}
      </div>

      <div className="ac-sb-foot">
        <button type="button" className="ac-sb-user" data-popover-anchor onClick={() => setUserMenu((v) => !v)}>
          <span className="ac-sb-avatar">
            <Avatar name={prefs.nickname || 'G'} size={30} />
            {attention && <i className="ac-dot" title="확인이 필요한 항목이 있습니다" />}
          </span>
          <span className="ac-sb-user-text">
            <strong>{prefs.nickname || '게스트'}</strong>
            <span>{status === 'online' ? '개인 워크스페이스' : status === 'reconnecting' ? '다시 연결하는 중…' : '오프라인'}</span>
          </span>
        </button>
        <Popover open={userMenu} onClose={() => setUserMenu(false)} side="top" className="ac-user-menu">
          <MenuItem icon={<Settings size={15} />} onClick={() => { setUserMenu(false); onDialog('settings') }}>설정</MenuItem>
          <MenuItem
            icon={prefs.workView ? <Eye size={15} /> : <EyeOff size={15} />}
            hint={WORK_VIEW_KEYS[prefs.workViewKey]}
            onClick={() => { setUserMenu(false); prefs.toggleWorkView() }}
          >
            {prefs.workView ? '공유 세션 표시' : '업무 보기'}
          </MenuItem>
          <MenuItem icon={<SquareTerminal size={15} />} onClick={() => { setUserMenu(false); prefs.setTheme('terminal') }}>
            터미널 인터페이스로 전환
          </MenuItem>
          <MenuSep />
          <MenuItem icon={<HelpCircle size={15} />} onClick={() => { setUserMenu(false); onDialog('settings') }}>도움말 및 정보</MenuItem>
        </Popover>
      </div>
    </aside>
  )
}

function exportConversation(c: DemoConversation) {
  const md = `# ${c.title}\n\n` + c.messages.map((m) => `**${m.role === 'user' ? '나' : 'Relay'}**\n\n${m.content}`).join('\n\n---\n\n')
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${c.title.replace(/[\\/:*?"<>|]/g, '_')}.md`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

/* ───────────────────────── Top bar ───────────────────────── */

function TopBar({
  conv,
  model,
  onNew,
  onLeft,
  onRename,
  onDelete,
  toast,
}: {
  conv: DemoConversation | null
  model: SessionModel | null
  onNew(): void
  onLeft(): void
  onRename(title: string): void
  onDelete(): void
  toast(s: string): void
}) {
  const prefs = usePrefs()
  const [open, setOpen] = useState<null | 'model' | 'more' | 'share' | 'people'>(null)
  const close = useCallback(() => setOpen(null), [])
  const current = MODELS.find((m) => m.id === prefs.model) ?? MODELS[0]

  return (
    <header className="ac-topbar">
      <div className="ac-tb-left">
        {!prefs.sidebarOpen && (
          <>
            <button type="button" className="ac-icon-btn" title="사이드바 열기" onClick={() => prefs.setSidebarOpen(true)}>
              <PanelLeft size={18} />
            </button>
            <button type="button" className="ac-icon-btn" title="새 채팅" onClick={onNew}>
              <SquarePen size={18} />
            </button>
          </>
        )}
        {model ? (
          <div className="ac-tb-session">
            <strong>{model.snap.name}</strong>
            <span>공유 세션 · {model.meta.workTitle}</span>
          </div>
        ) : (
          <div className="ac-rel">
            <button type="button" className="ac-model-btn" data-popover-anchor onClick={() => setOpen(open === 'model' ? null : 'model')}>
              {current.name} <ChevronDown size={16} />
            </button>
            <Popover open={open === 'model'} onClose={close} className="ac-model-menu">
              {MODELS.map((m) => (
                <MenuItem key={m.id} checked={m.id === prefs.model} onClick={() => { prefs.setModel(m.id); close() }}>
                  <span className="ac-model-opt"><strong>{m.name}</strong><span>{m.desc}</span></span>
                </MenuItem>
              ))}
            </Popover>
          </div>
        )}
      </div>

      <div className="ac-tb-right">
        {model && (
          <>
            <div className="ac-rel">
              <button type="button" className="ac-people" data-popover-anchor onClick={() => setOpen(open === 'people' ? null : 'people')} title="참여자">
                {model.players.slice(0, 4).map((p) => <Avatar key={p.id} name={p.name} size={24} dim={!p.connected} />)}
                {model.players.length > 4 && <span className="ac-people-more">+{model.players.length - 4}</span>}
              </button>
              <Popover open={open === 'people'} onClose={close} align="right" className="ac-people-menu">
                <div className="ac-pop-title">참여자 {model.players.length}명</div>
                {model.players.map((p) => (
                  <div key={p.id} className="ac-person-row">
                    <Avatar name={p.name} size={26} dim={!p.connected} />
                    <span className="ac-person-name">
                      {p.name}
                      {p.id === model.snap.meId && <em> (나)</em>}
                    </span>
                    <span className="ac-person-tag">
                      {p.id === model.snap.hostId ? '호스트' : p.spectator ? '관전' : ''}
                      {!p.connected && ' 오프라인'}
                    </span>
                  </div>
                ))}
              </Popover>
            </div>
            <div className="ac-rel">
              <button type="button" className="ac-btn ghost" data-popover-anchor onClick={() => setOpen(open === 'share' ? null : 'share')}>
                <Link2 size={15} /> 공유
              </button>
              <Popover open={open === 'share'} onClose={close} align="right" className="ac-share">
                <div className="ac-pop-title">세션에 초대</div>
                <p className="ac-pop-desc">링크를 받은 사람은 이름만 입력하고 참여할 수 있습니다.</p>
                <div className="ac-share-row">
                  <input readOnly value={inviteUrl(model.snap.code)} onFocus={(e) => e.target.select()} />
                  <button
                    type="button"
                    className="ac-btn primary sm"
                    onClick={() =>
                      navigator.clipboard?.writeText(inviteUrl(model.snap.code)).then(
                        () => toast('초대 링크를 복사했습니다'),
                        () => toast('복사하지 못했습니다'),
                      )
                    }
                  >
                    <Copy size={14} /> 복사
                  </button>
                </div>
                <div className="ac-share-code">
                  세션 코드 <code>{model.snap.code}</code>
                </div>
              </Popover>
            </div>
          </>
        )}
        {!prefs.sidePanel && (
          <button type="button" className="ac-icon-btn ac-hide-narrow" title="산출물 패널 열기" onClick={() => prefs.setSidePanel(true)}>
            <PanelRight size={18} />
          </button>
        )}
        {(conv || model) && (
          <div className="ac-rel">
            <button type="button" className="ac-icon-btn" data-popover-anchor onClick={() => setOpen(open === 'more' ? null : 'more')} aria-label="더 보기">
              <MoreHorizontal size={18} />
            </button>
            <Popover open={open === 'more'} onClose={close} align="right">
              {model ? (
                <>
                  <MenuItem icon={<EyeOff size={15} />} hint={WORK_VIEW_KEYS[prefs.workViewKey]} onClick={() => { close(); prefs.setWorkView(true) }}>
                    업무 보기
                  </MenuItem>
                  <MenuItem icon={<SquareTerminal size={15} />} onClick={() => { close(); prefs.setTheme('terminal') }}>터미널에서 열기</MenuItem>
                  <MenuSep />
                  <MenuItem
                    icon={<LogOut size={15} />}
                    danger
                    onClick={async () => {
                      close()
                      await leaveSession()
                      onLeft()
                      toast('세션에서 나왔습니다')
                    }}
                  >
                    세션 나가기
                  </MenuItem>
                </>
              ) : (
                conv && (
                  <>
                    <MenuItem
                      icon={<Pencil size={15} />}
                      onClick={() => {
                        close()
                        const t = window.prompt('대화 이름', conv.title)
                        if (t?.trim()) onRename(t.trim())
                      }}
                    >
                      이름 바꾸기
                    </MenuItem>
                    <MenuItem icon={<Download size={15} />} onClick={() => { close(); exportConversation(conv); toast('Markdown 파일로 내보냈습니다') }}>
                      내보내기 (.md)
                    </MenuItem>
                    <MenuSep />
                    <MenuItem icon={<Trash2 size={15} />} danger onClick={() => { close(); onDelete() }}>삭제</MenuItem>
                  </>
                )
              )}
            </Popover>
          </div>
        )}
      </div>
    </header>
  )
}
