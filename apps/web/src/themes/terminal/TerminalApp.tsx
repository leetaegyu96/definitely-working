import { ChevronDown, Plus, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { needsAttention, useSessionModel } from '../../game-ui/model'
import { usePrefs, WORK_VIEW_KEYS } from '../../stores/prefs'
import { AgentPane } from './AgentPane'
import { RelayTab } from './RelayTab'
import { ShellTab } from './ShellTab'
import { StreamTab, type StreamKind } from './StreamTab'
import { displayPath, HOST, PROJECT, USER } from './shell'
import './terminal.css'

type Tab = { id: string; kind: 'relay' | 'bash' | StreamKind }

const TAB_TITLE: Record<Tab['kind'], string> = {
  relay: 'relay — billing-api',
  bash: `${USER}@${HOST}: ${displayPath(PROJECT)}`,
  devserver: 'pnpm dev — billing-api',
  docker: 'docker compose logs -f',
}

function TuxIcon() {
  // 일반적인 리눅스 셸 아이콘 (원형 + 프롬프트 기호)
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
      <circle cx="8" cy="8" r="7.5" fill="#e95420" />
      <path d="M4.6 5.6 7 8l-2.4 2.4M8.2 10.6h3.2" stroke="#fff" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
function RelayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
      <rect width="16" height="16" rx="3.5" fill="#2b2b2b" stroke="#5a5a5a" />
      <path d="M5 11V5h3.2a2 2 0 0 1 0 4H6.5m1.7 0L11 11" fill="none" stroke="#d7d7d7" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

let tabSeq = 1

export function TerminalApp() {
  const prefs = usePrefs()
  const m = useSessionModel()
  const [tabs, setTabs] = useState<Tab[]>([
    { id: 'relay', kind: 'relay' },
    { id: 'bash-0', kind: 'bash' },
    { id: 'dev', kind: 'devserver' },
    { id: 'docker', kind: 'docker' },
  ])
  const [ratio, setRatio] = useState(0.64)
  const split = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState('relay')
  const [menu, setMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    document.title = TAB_TITLE[tabs.find((t) => t.id === active)?.kind ?? 'relay']
  }, [active, tabs])

  useEffect(() => {
    if (!menu) return
    const close = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menu])

  // Ctrl+Shift+T 새 탭, Ctrl+Tab 탭 전환
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        prefs.setSidePanel(!prefs.sidePanel)
      } else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 't') {
        e.preventDefault()
        newTab()
      } else if (e.ctrlKey && e.key === 'Tab') {
        e.preventDefault()
        setActive((cur) => {
          const i = tabs.findIndex((t) => t.id === cur)
          return tabs[(i + (e.shiftKey ? -1 : 1) + tabs.length) % tabs.length].id
        })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  function newTab() {
    const id = `bash-${tabSeq++}`
    setTabs((t) => [...t, { id, kind: 'bash' }])
    setActive(id)
  }
  function openRelay() {
    if (!tabs.some((t) => t.kind === 'relay')) setTabs((t) => [{ id: 'relay', kind: 'relay' }, ...t])
    setActive('relay')
  }
  function closeTab(id: string) {
    const rest = tabs.filter((t) => t.id !== id)
    if (!rest.length) {
      setTabs([{ id: 'relay', kind: 'relay' }])
      setActive('relay')
      return
    }
    setTabs(rest)
    if (active === id) setActive(rest[Math.max(0, tabs.findIndex((t) => t.id === id) - 1)].id)
  }

  const attention = prefs.workView && needsAttention(m)

  return (
    <div className="tm-root">
      <div className="tm-tabbar">
        <div className="tm-tabs" role="tablist">
          {tabs.map((t) => (
            <div
              key={t.id}
              role="tab"
              aria-selected={active === t.id}
              className={`tm-tab${active === t.id ? ' on' : ''}`}
              onMouseDown={(e) => e.button === 1 && closeTab(t.id)}
              onClick={() => setActive(t.id)}
            >
              {t.kind === 'relay' ? <RelayIcon /> : <TuxIcon />}
              <span className="tm-tab-title">{TAB_TITLE[t.kind]}</span>
              {t.kind === 'relay' && attention && <i className="tm-tab-dot" />}
              <button
                type="button"
                className="tm-tab-x"
                aria-label="탭 닫기"
                onClick={(e) => {
                  e.stopPropagation()
                  closeTab(t.id)
                }}
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
        <button type="button" className="tm-tb-btn" title="새 탭 (Ctrl+Shift+T)" onClick={newTab}>
          <Plus size={15} />
        </button>
        <div className="tm-rel" ref={menuRef}>
          <button type="button" className="tm-tb-btn" title="프로필 및 설정" onClick={() => setMenu((v) => !v)}>
            <ChevronDown size={15} />
          </button>
          {menu && (
            <div className="tm-menu">
              <button type="button" onClick={() => { setMenu(false); newTab() }}>
                <TuxIcon /> <span>Ubuntu-22.04</span> <kbd>Ctrl+Shift+T</kbd>
              </button>
              <button type="button" onClick={() => { setMenu(false); openRelay() }}>
                <RelayIcon /> <span>Relay CLI</span>
              </button>
              <hr />
              <button type="button" onClick={() => { setMenu(false); prefs.setSidePanel(!prefs.sidePanel) }}>
                <span className="tm-menu-pad" /> <span>{prefs.sidePanel ? '오른쪽 창 닫기' : '창 분할 (오른쪽 에이전트)'}</span> <kbd>Alt+Shift+D</kbd>
              </button>
              <button type="button" onClick={() => { setMenu(false); prefs.toggleWorkView() }}>
                <span className="tm-menu-pad" /> <span>{prefs.workView ? '세션 출력 표시' : '업무 보기 (세션 출력 숨김)'}</span> <kbd>{WORK_VIEW_KEYS[prefs.workViewKey]}</kbd>
              </button>
              <button type="button" onClick={() => { setMenu(false); prefs.setTheme('ai') }}>
                <span className="tm-menu-pad" /> <span>Relay Chat 인터페이스로 전환</span>
              </button>
            </div>
          )}
        </div>
        <div className="tm-drag" />
      </div>
      <div className="tm-body">
        {tabs.map((t) =>
          t.kind === 'relay' ? (
            <div key={t.id} ref={split} className={`tm-split${active === t.id ? '' : ' hidden'}`}>
              <div className="tm-pane" style={{ flexBasis: prefs.sidePanel ? `${ratio * 100}%` : '100%' }}>
                <RelayTab active={active === t.id} onShell={() => closeTab(t.id)} />
              </div>
              {prefs.sidePanel && (
                <>
                  <div
                    className="tm-divider"
                    onMouseDown={(e) => {
                      e.preventDefault()
                      const box = split.current!.getBoundingClientRect()
                      const move = (ev: MouseEvent) => setRatio(Math.min(0.8, Math.max(0.4, (ev.clientX - box.left) / box.width)))
                      const up = () => {
                        window.removeEventListener('mousemove', move)
                        window.removeEventListener('mouseup', up)
                      }
                      window.addEventListener('mousemove', move)
                      window.addEventListener('mouseup', up)
                    }}
                  />
                  <div className="tm-pane tm-pane-side">
                    <AgentPane />
                  </div>
                </>
              )}
            </div>
          ) : t.kind === 'devserver' || t.kind === 'docker' ? (
            <StreamTab key={t.id} kind={t.kind} active={active === t.id} />
          ) : (
            <ShellTab key={t.id} active={active === t.id} onOpenRelay={openRelay} onExit={() => closeTab(t.id)} />
          ),
        )}
      </div>
    </div>
  )
}
