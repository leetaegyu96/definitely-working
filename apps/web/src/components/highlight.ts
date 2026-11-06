/** 아주 작은 정규식 기반 하이라이터 (ts/js/sql/bash). XSS 안전: 토큰 배열만 반환 */
export type Tok = { t: string; c?: 'kw' | 'str' | 'com' | 'num' | 'fn' | 'type' | 'op' }

const KW: Record<string, RegExp> = {
  ts: /^(?:const|let|var|function|async|await|return|if|else|for|of|in|while|try|catch|throw|new|export|import|from|type|interface|class|extends|implements|public|private|readonly|default|switch|case|break|continue|true|false|null|undefined|this)\b/,
  sql: /^(?:SELECT|FROM|WHERE|JOIN|LEFT|RIGHT|INNER|ON|AND|OR|NOT|IN|AS|ORDER|BY|GROUP|HAVING|LIMIT|UPDATE|SET|INSERT|INTO|VALUES|DELETE|CASE|WHEN|THEN|ELSE|END|COUNT|SUM|AVG|DESC|ASC|NOW|INTERVAL|DATE_TRUNC|RETURNING|CREATE|INDEX|TABLE|NULL|IS|DISTINCT|WITH)\b/i,
  bash: /^(?:if|then|fi|for|do|done|echo|export|cd|sudo|kafka-consumer-groups|git|npm|pnpm|make)\b/,
}

export function highlight(code: string, lang: string): Tok[][] {
  const l = lang === 'js' || lang === 'tsx' || lang === 'typescript' ? 'ts' : lang === 'sh' || lang === 'shell' ? 'bash' : lang
  const kw = KW[l]
  return code.split('\n').map((line) => {
    const out: Tok[] = []
    let rest = line
    const push = (t: string, c?: Tok['c']) => {
      if (!t) return
      const last = out[out.length - 1]
      if (last && last.c === c && !c) last.t += t
      else out.push({ t, c })
    }
    while (rest.length) {
      let m: RegExpMatchArray | null
      if (!kw) {
        push(rest)
        break
      }
      if ((l === 'ts' && (m = rest.match(/^\/\/.*/))) || (l === 'sql' && (m = rest.match(/^--.*/))) || (l === 'bash' && (m = rest.match(/^#.*/)))) {
        push(m[0], 'com')
      } else if ((m = rest.match(/^(?:'(?:[^'\\]|\\.)*'?|"(?:[^"\\]|\\.)*"?|`(?:[^`\\]|\\.)*`?)/))) {
        push(m[0], 'str')
      } else if ((m = rest.match(/^\d[\d_.]*/))) {
        push(m[0], 'num')
      } else if ((m = rest.match(kw))) {
        push(m[0], 'kw')
      } else if (l === 'ts' && (m = rest.match(/^[A-Z][A-Za-z0-9_]*/))) {
        push(m[0], 'type')
      } else if ((m = rest.match(/^[A-Za-z_$][\w$]*(?=\s*\()/))) {
        push(m[0], 'fn')
      } else if ((m = rest.match(/^[A-Za-z_$][\w$]*/))) {
        push(m[0])
      } else if ((m = rest.match(/^\$\{|^[=<>!+\-*/%&|?:]+/))) {
        push(m[0], 'op')
      } else {
        push(rest[0])
        rest = rest.slice(1)
        continue
      }
      rest = rest.slice(m[0].length)
    }
    return out
  })
}
