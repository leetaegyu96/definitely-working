/** 배포 하위 경로(context path) 대응. 빌드 시 BASE_PATH 로 지정 (기본 "/") */
export const BASE = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + '/'

export const homePath = () => BASE
export const sessionPath = (code: string) => `${BASE}s/${code}`
export const inviteUrl = (code: string) => `${location.origin}${sessionPath(code)}`

/** 현재 URL이 초대 경로면 코드 반환 */
export function inviteCodeFromLocation(): string | null {
  const rest = location.pathname.startsWith(BASE) ? location.pathname.slice(BASE.length) : location.pathname.replace(/^\//, '')
  const m = rest.match(/^s\/([A-Za-z0-9]{6})\/?$/)
  return m ? m[1].toUpperCase() : null
}

export function resetToHome() {
  if (inviteCodeFromLocation()) history.replaceState(null, '', homePath())
}
