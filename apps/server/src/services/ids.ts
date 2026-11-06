import { randomBytes, randomInt } from 'node:crypto'

/** 혼동되는 문자(0/O, 1/I/L)를 제외한 32자 → 6자리 = 약 10억 조합 */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

export function newRoomCode(): string {
  let s = ''
  for (let i = 0; i < 6; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
  return s
}

export const newId = () => randomBytes(6).toString('base64url')
export const newToken = () => randomBytes(24).toString('base64url')
