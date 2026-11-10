export interface HighlightToken {
  offset: number
  text: string
  className?: 'tok-c' | 'tok-tag' | 'tok-attr' | 'tok-str'
}

export interface HighlightLine {
  offset: number
  number: number
  tokens: HighlightToken[]
}

/** Return plain text tokens; React owns escaping and element construction. */
export function highlightHtml(code: string): HighlightLine[] {
  const tokens: HighlightToken[] = []
  const pattern = /<!--[\s\S]*?(?:-->|$)|<\/?[a-zA-Z][^>]*(?:>|$)/g
  let cursor = 0
  for (const match of code.matchAll(pattern)) {
    if (match.index > cursor) tokens.push({ offset: cursor, text: code.slice(cursor, match.index) })
    if (match[0].startsWith('<!--')) {
      tokens.push({ offset: match.index, text: match[0], className: 'tok-c' })
    } else {
      tokens.push(...tagTokens(match[0], match.index))
    }
    cursor = match.index + match[0].length
  }
  if (cursor < code.length) tokens.push({ offset: cursor, text: code.slice(cursor) })
  const lines: HighlightLine[] = []
  let line: HighlightLine = { offset: 0, number: 1, tokens: [] }
  for (const token of tokens) {
    let start = 0
    while (start < token.text.length) {
      const newline = token.text.indexOf('\n', start)
      const end = newline < 0 ? token.text.length : newline
      if (end > start)
        line.tokens.push({
          ...token,
          offset: token.offset + start,
          text: token.text.slice(start, end),
        })
      if (newline < 0) break
      lines.push(line)
      line = { offset: token.offset + newline + 1, number: line.number + 1, tokens: [] }
      start = newline + 1
    }
  }
  lines.push(line)
  return lines
}

function tagTokens(raw: string, offset: number): HighlightToken[] {
  const tokens: HighlightToken[] = []
  const pattern = /(^<\/?)([a-zA-Z0-9:-]+)|([a-zA-Z_:-]+)(\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+)/g
  let cursor = 0
  for (const match of raw.matchAll(pattern)) {
    if (match.index > cursor)
      tokens.push({ offset: offset + cursor, text: raw.slice(cursor, match.index) })
    if (match[1] !== undefined) {
      tokens.push({ offset: offset + match.index, text: match[1] })
      tokens.push({
        offset: offset + match.index + match[1].length,
        text: match[2] ?? '',
        className: 'tok-tag',
      })
    } else {
      const name = match[3] ?? ''
      const equals = match[4] ?? ''
      tokens.push({ offset: offset + match.index, text: name, className: 'tok-attr' })
      tokens.push({ offset: offset + match.index + name.length, text: equals })
      tokens.push({
        offset: offset + match.index + name.length + equals.length,
        text: match[5] ?? '',
        className: 'tok-str',
      })
    }
    cursor = match.index + match[0].length
  }
  if (cursor < raw.length) tokens.push({ offset: offset + cursor, text: raw.slice(cursor) })
  return tokens
}
