/** 정답 비교용 정규화: NFC, 모든 공백 제거, 영문 소문자. 부분 일치·유사어는 인정하지 않는다. */
export function normalizeAnswer(s: string): string {
  return s.normalize('NFC').replace(/\s+/g, '').toLowerCase()
}

/** 입력이 정답 또는 등록된 별칭과 정확히 일치하는지 */
export function matchesAnswer(input: string, answer: string, aliases: readonly string[] = []): boolean {
  const n = normalizeAnswer(input)
  if (!n) return false
  return [answer, ...aliases].some((a) => normalizeAnswer(a) === n)
}
