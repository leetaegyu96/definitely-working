/**
 * 제한된 마크다운 렌더러 (제목, 문단, 목록, 체크리스트, 코드블록, 표, 인용, 굵게, 인라인 코드).
 * React 엘리먼트로만 출력하므로 사용자 입력이 들어와도 HTML로 해석되지 않는다.
 */
import { Fragment, useState, type ReactNode } from 'react'
import { Check, Copy } from 'lucide-react'
import { highlight } from './highlight'

type Block =
  | { k: 'h'; level: number; text: string }
  | { k: 'p'; text: string }
  | { k: 'ul' | 'ol'; items: string[] }
  | { k: 'todo'; items: { done: boolean; text: string }[] }
  | { k: 'code'; lang: string; code: string }
  | { k: 'table'; head: string[]; align: ('l' | 'r' | 'c')[]; rows: string[][] }
  | { k: 'quote'; text: string }
  | { k: 'hr' }

function parse(src: string): Block[] {
  const lines = src.replace(/\r/g, '').split('\n')
  const out: Block[] = []
  let i = 0
  const isSpecial = (l: string) => /^(#{1,4}\s|```|\s*[-*]\s|\s*\d+\.\s|\||>\s?|---\s*$)/.test(l)
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i++
      continue
    }
    let m: RegExpMatchArray | null
    if ((m = line.match(/^```(\w*)/))) {
      const lang = m[1] || 'text'
      const buf: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) buf.push(lines[i++])
      i++
      out.push({ k: 'code', lang, code: buf.join('\n') })
    } else if ((m = line.match(/^(#{1,4})\s+(.*)/))) {
      out.push({ k: 'h', level: m[1].length, text: m[2] })
      i++
    } else if (/^---\s*$/.test(line)) {
      out.push({ k: 'hr' })
      i++
    } else if (line.startsWith('|')) {
      const rows: string[][] = []
      while (i < lines.length && lines[i].startsWith('|')) {
        rows.push(lines[i].replace(/^\||\|\s*$/g, '').split('|').map((c) => c.trim()))
        i++
      }
      const sep = rows[1] ?? []
      const align = sep.map((c) => (c.endsWith(':') && c.startsWith(':') ? 'c' : c.endsWith(':') ? 'r' : 'l')) as ('l' | 'r' | 'c')[]
      out.push({ k: 'table', head: rows[0], align, rows: rows.slice(2) })
    } else if (/^\s*[-*]\s\[[ x]\]/.test(line)) {
      const items: { done: boolean; text: string }[] = []
      while (i < lines.length && (m = lines[i].match(/^\s*[-*]\s\[([ x])\]\s+(.*)/))) {
        items.push({ done: m[1] === 'x', text: m[2] })
        i++
      }
      out.push({ k: 'todo', items })
    } else if (/^\s*[-*]\s/.test(line)) {
      const items: string[] = []
      while (i < lines.length && (m = lines[i].match(/^\s*[-*]\s+(.*)/))) {
        items.push(m[1])
        i++
      }
      out.push({ k: 'ul', items })
    } else if (/^\s*\d+\.\s/.test(line)) {
      const items: string[] = []
      while (i < lines.length && (m = lines[i].match(/^\s*\d+\.\s+(.*)/))) {
        items.push(m[1])
        i++
      }
      out.push({ k: 'ol', items })
    } else if (line.startsWith('>')) {
      const buf: string[] = []
      while (i < lines.length && lines[i].startsWith('>')) buf.push(lines[i++].replace(/^>\s?/, ''))
      out.push({ k: 'quote', text: buf.join(' ') })
    } else {
      const buf: string[] = [line]
      i++
      while (i < lines.length && lines[i].trim() && !isSpecial(lines[i])) buf.push(lines[i++])
      out.push({ k: 'p', text: buf.join('\n') })
    }
  }
  return out
}

export function Inline({ text }: { text: string }) {
  const parts: ReactNode[] = []
  const re = /(`[^`]+`|\*\*[^*]+\*\*)/g
  let last = 0
  let m: RegExpExecArray | null
  let k = 0
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(<Fragment key={k++}>{text.slice(last, m.index)}</Fragment>)
    const tok = m[0]
    if (tok.startsWith('`')) parts.push(<code key={k++} className="md-ic">{tok.slice(1, -1)}</code>)
    else parts.push(<strong key={k++}>{tok.slice(2, -2)}</strong>)
    last = m.index + tok.length
  }
  if (last < text.length) parts.push(<Fragment key={k++}>{text.slice(last)}</Fragment>)
  return <>{parts}</>
}

export function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false)
  const lines = highlight(code, lang)
  return (
    <div className="md-code">
      <div className="md-code-head">
        <span>{lang === 'text' ? '' : lang}</span>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(code).catch(() => {})
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          }}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? '복사됨' : '코드 복사'}
        </button>
      </div>
      <pre>
        <code>
          {lines.map((toks, li) => (
            <Fragment key={li}>
              {toks.map((t, ti) => (t.c ? <span key={ti} className={`hl-${t.c}`}>{t.t}</span> : <Fragment key={ti}>{t.t}</Fragment>))}
              {li < lines.length - 1 ? '\n' : null}
            </Fragment>
          ))}
        </code>
      </pre>
    </div>
  )
}

export function Markdown({ text }: { text: string }) {
  const blocks = parse(text)
  return (
    <div className="md">
      {blocks.map((b, i) => {
        switch (b.k) {
          case 'h': {
            const Tag = (`h${Math.min(b.level + 1, 5)}` as 'h3')
            return <Tag key={i}><Inline text={b.text} /></Tag>
          }
          case 'p':
            return (
              <p key={i}>
                {b.text.split('\n').map((l, j, a) => (
                  <Fragment key={j}>
                    <Inline text={l} />
                    {j < a.length - 1 && <br />}
                  </Fragment>
                ))}
              </p>
            )
          case 'ul':
            return <ul key={i}>{b.items.map((t, j) => <li key={j}><Inline text={t} /></li>)}</ul>
          case 'ol':
            return <ol key={i}>{b.items.map((t, j) => <li key={j}><Inline text={t} /></li>)}</ol>
          case 'todo':
            return (
              <ul key={i} className="md-todo">
                {b.items.map((t, j) => (
                  <li key={j}>
                    <input type="checkbox" defaultChecked={t.done} aria-label={t.text} />
                    <span><Inline text={t.text} /></span>
                  </li>
                ))}
              </ul>
            )
          case 'code':
            return <CodeBlock key={i} lang={b.lang} code={b.code} />
          case 'quote':
            return <blockquote key={i}><Inline text={b.text} /></blockquote>
          case 'hr':
            return <hr key={i} />
          case 'table':
            return (
              <div key={i} className="md-table">
                <table>
                  <thead>
                    <tr>{b.head.map((h, j) => <th key={j} className={`al-${b.align[j] ?? 'l'}`}><Inline text={h} /></th>)}</tr>
                  </thead>
                  <tbody>
                    {b.rows.map((r, ri) => (
                      <tr key={ri}>{r.map((c, j) => <td key={j} className={`al-${b.align[j] ?? 'l'}`}><Inline text={c} /></td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
        }
      })}
    </div>
  )
}
