import { create } from 'zustand'
import { load, save } from '../lib/storage'

export type ThemeId = 'ai' | 'terminal'
export type Appearance = 'system' | 'light' | 'dark'
export type WorkViewKey = 'ctrl-shift-space' | 'ctrl-period'

export const THEMES: { id: ThemeId; label: string; desc: string }[] = [
  { id: 'ai', label: 'Relay Chat', desc: '어시스턴트 대화형 화면' },
  { id: 'terminal', label: 'Terminal', desc: 'WSL 셸 + Relay CLI' },
]

export const WORK_VIEW_KEYS: Record<WorkViewKey, string> = {
  'ctrl-shift-space': 'Ctrl + Shift + Space',
  'ctrl-period': 'Ctrl + .',
}

interface PrefsState {
  theme: ThemeId
  appearance: Appearance
  nickname: string
  /** 업무 보기: 세션/대화 영역을 숨기고 일반 업무 화면만 표시 */
  workView: boolean
  workViewKey: WorkViewKey
  sidebarOpen: boolean
  model: string
  /** AI Chat 산출물 패널 / Terminal 분할 창 */
  sidePanel: boolean
  setSidePanel(v: boolean): void
  setTheme(t: ThemeId): void
  setAppearance(a: Appearance): void
  setNickname(n: string): void
  setWorkView(v: boolean): void
  toggleWorkView(): void
  setWorkViewKey(k: WorkViewKey): void
  setSidebarOpen(v: boolean): void
  setModel(m: string): void
}

const KEY = 'relay.prefs.v1'
type Persisted = Pick<PrefsState, 'theme' | 'appearance' | 'nickname' | 'workView' | 'workViewKey' | 'sidebarOpen' | 'model' | 'sidePanel'>
const initial: Persisted = {
  theme: 'ai',
  appearance: 'system',
  nickname: '',
  workView: false,
  workViewKey: 'ctrl-shift-space',
  sidebarOpen: true,
  model: 'relay-4',
  sidePanel: true,
  ...load<Partial<Persisted>>(KEY, {}),
}

export const usePrefs = create<PrefsState>((set) => ({
  ...initial,
  setTheme: (theme) => set({ theme }),
  setAppearance: (appearance) => set({ appearance }),
  setNickname: (nickname) => set({ nickname }),
  setWorkView: (workView) => set({ workView }),
  toggleWorkView: () => set((s) => ({ workView: !s.workView })),
  setWorkViewKey: (workViewKey) => set({ workViewKey }),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  setModel: (model) => set({ model }),
  setSidePanel: (sidePanel) => set({ sidePanel }),
}))

usePrefs.subscribe((s) => {
  const { theme, appearance, nickname, workView, workViewKey, sidebarOpen, model, sidePanel } = s
  save(KEY, { theme, appearance, nickname, workView, workViewKey, sidebarOpen, model, sidePanel })
})
