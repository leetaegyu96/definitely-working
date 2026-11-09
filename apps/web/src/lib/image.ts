import { LIMITS, type ChatImage } from '@relay/shared'

const MAX_SIDE = 1280

/**
 * 채팅 전송용 이미지 준비: 긴 변 1280px 로 줄이고 JPEG 로 압축한 data URL.
 * 투명 배경은 흰색으로 채운다. 움직이는 GIF 는 첫 프레임만 전송된다.
 */
export async function prepareImage(file: Blob): Promise<ChatImage> {
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') throw new Error('이미지 파일(PNG, JPG, WebP, GIF)만 보낼 수 있습니다')
  if (file.size > 25 * 1024 * 1024) throw new Error('25MB 이하 이미지만 보낼 수 있습니다')
  let bmp: ImageBitmap
  try {
    bmp = await createImageBitmap(file)
  } catch {
    throw new Error('이미지를 읽을 수 없습니다')
  }
  for (const [side, quality] of [[MAX_SIDE, 0.82], [1024, 0.72], [800, 0.62], [640, 0.55]] as const) {
    const scale = Math.min(1, side / Math.max(bmp.width, bmp.height))
    const w = Math.max(1, Math.round(bmp.width * scale))
    const h = Math.max(1, Math.round(bmp.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(bmp, 0, 0, w, h)
    const dataUrl = canvas.toDataURL('image/jpeg', quality)
    if (dataUrl.length <= LIMITS.imageMax) {
      bmp.close()
      return { dataUrl, w, h }
    }
  }
  bmp.close()
  throw new Error('이미지가 너무 커서 보낼 수 없습니다')
}

export const imageKB = (img: ChatImage) => Math.round((img.dataUrl.length * 3) / 4 / 1024)

/** 붙여넣기 / 드래그 데이터에서 이미지 파일 꺼내기 */
export function imageFromTransfer(dt: DataTransfer | null): File | null {
  if (!dt) return null
  for (const item of Array.from(dt.items ?? [])) {
    if (item.kind === 'file' && item.type.startsWith('image/')) return item.getAsFile()
  }
  for (const f of Array.from(dt.files ?? [])) if (f.type.startsWith('image/')) return f
  return null
}
