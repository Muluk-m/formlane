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

export function sourceLanguage(path: string) {
  const extension = path.split('.').at(-1)?.toLowerCase()
  switch (extension) {
    case 'html':
    case 'svg':
      return 'html'
    case 'css':
      return 'css'
    case 'js':
    case 'jsx':
      return 'javascript'
    case 'ts':
    case 'tsx':
      return 'typescript'
    case 'json':
      return 'json'
    case 'md':
      return 'markdown'
    default:
      return 'text'
  }
}

export function highlightSource(code: string, path: string): HighlightLine[] {
  const language = sourceLanguage(path)
  if (language === 'html') return highlightHtml(code)
  if (language === 'text') return tokenLines([{ offset: 0, text: code }])
  const pattern =
    language === 'css'
      ? /\/\*[\s\S]*?(?:\*\/|$)|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|#[\da-fA-F]{3,8}\b|[\w-]+(?=\s*:)|[.#]?[\w-]+(?=\s*[{,])/g
      : language === 'markdown'
        ? /^#{1,6}\s.+$|`[^`]*`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]*\)/gm
        : /\/\*[\s\S]*?(?:\*\/|$)|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:import|export|from|default|const|let|var|function|return|if|else|for|while|class|new|async|await|type|interface|extends|implements|true|false|null|undefined|throw|try|catch|switch|case|break|typeof)\b|\b\d+(?:\.\d+)?\b/g
  const tokens: HighlightToken[] = []
  let cursor = 0
  for (const match of code.matchAll(pattern)) {
    if (match.index > cursor) tokens.push({ offset: cursor, text: code.slice(cursor, match.index) })
    const text = match[0]
    const className =
      text.startsWith('//') || text.startsWith('/*')
        ? 'tok-c'
        : /^["'`]/.test(text)
          ? 'tok-str'
          : language === 'css' || /^\d/.test(text)
            ? 'tok-attr'
            : 'tok-tag'
    tokens.push({ offset: match.index, text, className })
    cursor = match.index + text.length
  }
  if (cursor < code.length) tokens.push({ offset: cursor, text: code.slice(cursor) })
  return tokenLines(tokens)
}

/** Return plain text tokens; React owns escaping and element construction. */
function highlightHtml(code: string): HighlightLine[] {
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
  return tokenLines(tokens)
}

function tokenLines(tokens: HighlightToken[]): HighlightLine[] {
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
