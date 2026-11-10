import { Fragment, type ReactNode } from 'react'

function inline(text: string, offset: number): ReactNode[] {
  const nodes: ReactNode[] = []
  const pattern = /`([^`]+)`|\*\*([^*]+)\*\*/g
  let cursor = 0
  for (const match of text.matchAll(pattern)) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index))
    const key = offset + match.index
    nodes.push(
      match[1] !== undefined ? (
        <code key={key}>{match[1]}</code>
      ) : (
        <strong key={key}>{inline(match[2] ?? '', key + 2)}</strong>
      ),
    )
    cursor = match.index + match[0].length
  }
  nodes.push(text.slice(cursor))
  return nodes
}

export function RichText({ text }: { text: string }) {
  const lines: ReactNode[] = []
  let offset = 0
  for (const line of text.split('\n')) {
    const item = /^\s*[-*]\s+(.+)$/.exec(line)
    lines.push(
      <Fragment key={offset}>
        {item ? <span className="li">{inline(item[1] ?? '', offset)}</span> : inline(line, offset)}
        {'\n'}
      </Fragment>,
    )
    offset += line.length + 1
  }
  return <div className="rich whitespace-pre-wrap">{lines}</div>
}
