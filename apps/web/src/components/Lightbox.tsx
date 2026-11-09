import { useEffect } from 'react'
import { create } from 'zustand'

/** 이미지 크게 보기 (테마 공용). 클릭이나 Esc 로 닫힌다 */
export const useLightbox = create<{ src: string | null; open(src: string): void; close(): void }>((set) => ({
  src: null,
  open: (src) => set({ src }),
  close: () => set({ src: null }),
}))

export function Lightbox() {
  const { src, close } = useLightbox()
  useEffect(() => {
    if (!src) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [src, close])
  if (!src) return null
  return (
    <div className="lightbox" onClick={close} role="dialog" aria-label="이미지 보기">
      <img src={src} alt="" />
    </div>
  )
}
