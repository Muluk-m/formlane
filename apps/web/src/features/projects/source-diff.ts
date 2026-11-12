import type { ProjectSource } from '@atoms-demo/core/project'

/** Cap the LCS matrix at 1 MB; larger edits use an exact replacement of the middle. */
export const DIFF_MATRIX_CELL_LIMIT = 250_000
export const DIFF_PAGE_LINES = 160

export type DiffLine = {
  kind: 'context' | 'added' | 'removed'
  /** Includes the original line ending, so either source can be reconstructed exactly. */
  text: string
  beforeLine: number | null
  afterLine: number | null
}

export type SourceFileDiff = {
  path: string
  status: 'added' | 'removed' | 'modified'
  additions: number
  removals: number
  coarse: boolean
  lines: DiffLine[]
}

export type DiffSection = { kind: 'lines' | 'context'; start: number; end: number }
export type DiffPageItem =
  | { kind: 'line'; index: number }
  | { kind: 'context'; section: DiffSection }

function splitLines(text: string): string[] {
  const lines: string[] = []
  let start = 0
  while (start < text.length) {
    const newline = text.indexOf('\n', start)
    const end = newline === -1 ? text.length : newline + 1
    lines.push(text.slice(start, end))
    start = end
  }
  return lines
}

/** Line endings are part of equality; an empty file has zero lines. */
export function diffSourceLines(before: string, after: string) {
  const oldLines = splitLines(before)
  const newLines = splitLines(after)
  // Intern once so matrix comparisons remain constant-time even for very long lines.
  const identities = new Map<string, number>()
  function identity(line: string) {
    let id = identities.get(line)
    if (id === undefined) {
      id = identities.size
      identities.set(line, id)
    }
    return id
  }
  const oldIds = oldLines.map(identity)
  const newIds = newLines.map(identity)
  let prefix = 0
  while (prefix < oldIds.length && prefix < newIds.length && oldIds[prefix] === newIds[prefix]) {
    prefix++
  }
  let oldEnd = oldIds.length
  let newEnd = newIds.length
  while (oldEnd > prefix && newEnd > prefix && oldIds[oldEnd - 1] === newIds[newEnd - 1]) {
    oldEnd--
    newEnd--
  }

  const lines: DiffLine[] = []
  let oldIndex = 0
  let newIndex = 0
  let additions = 0
  let removals = 0
  function append(kind: DiffLine['kind']) {
    const text = kind === 'added' ? newLines[newIndex] : oldLines[oldIndex]
    if (text === undefined) throw new RangeError('Diff line index is out of bounds')
    const beforeLine = kind === 'added' ? null : ++oldIndex
    const afterLine = kind === 'removed' ? null : ++newIndex
    if (kind === 'added') additions++
    if (kind === 'removed') removals++
    lines.push({ kind, text, beforeLine, afterLine })
  }
  while (oldIndex < prefix) append('context')

  const oldCount = oldEnd - prefix
  const newCount = newEnd - prefix
  const width = newCount + 1
  const cells = (oldCount + 1) * width
  const coarse = oldCount > 0 && newCount > 0 && cells > DIFF_MATRIX_CELL_LIMIT
  if (oldCount > 0 && newCount > 0 && !coarse) {
    const matrix = new Uint32Array(cells)
    const score = (index: number): number => {
      const value = matrix[index]
      if (value === undefined) throw new RangeError('Diff matrix index is out of bounds')
      return value
    }
    for (let old = oldCount - 1; old >= 0; old--) {
      for (let next = newCount - 1; next >= 0; next--) {
        const at = old * width + next
        matrix[at] =
          oldIds[prefix + old] === newIds[prefix + next]
            ? score(at + width + 1) + 1
            : Math.max(score(at + width), score(at + 1))
      }
    }
    while (oldIndex < oldEnd && newIndex < newEnd) {
      if (oldIds[oldIndex] === newIds[newIndex]) {
        append('context')
      } else {
        const at = (oldIndex - prefix) * width + newIndex - prefix
        append(score(at + width) >= score(at + 1) ? 'removed' : 'added')
      }
    }
  }
  while (oldIndex < oldEnd) append('removed')
  while (newIndex < newEnd) append('added')
  while (oldIndex < oldLines.length) append('context')
  return { lines, additions, removals, coarse }
}

export function diffProjectSources(
  before: ProjectSource | null,
  after: ProjectSource,
): SourceFileDiff[] {
  const oldFiles = before?.files ?? {}
  const paths = [...new Set([...Object.keys(oldFiles), ...Object.keys(after.files)])].sort()
  const changes: SourceFileDiff[] = []
  for (const path of paths) {
    const existed = Object.hasOwn(oldFiles, path)
    const exists = Object.hasOwn(after.files, path)
    if (existed && exists && oldFiles[path] === after.files[path]) continue
    changes.push({
      path,
      status: !existed ? 'added' : !exists ? 'removed' : 'modified',
      ...diffSourceLines(
        existed ? (oldFiles[path] ?? '') : '',
        exists ? (after.files[path] ?? '') : '',
      ),
    })
  }
  return changes
}

/** Keep three unchanged lines beside changes; omitted context remains available on demand. */
export function diffSections(lines: readonly DiffLine[]): DiffSection[] {
  const sections: DiffSection[] = []
  function add(kind: DiffSection['kind'], start: number, end: number) {
    if (start >= end) return
    const previous = sections.at(-1)
    if (previous?.kind === kind && previous.end === start) previous.end = end
    else sections.push({ kind, start, end })
  }
  let cursor = 0
  while (cursor < lines.length) {
    const start = cursor
    const context = lines[cursor]?.kind === 'context'
    while (cursor < lines.length && (lines[cursor]?.kind === 'context') === context) cursor++
    if (!context) {
      add('lines', start, cursor)
      continue
    }
    const leading = start > 0 ? Math.min(3, cursor - start) : 0
    const trailing = cursor < lines.length ? Math.min(3, cursor - start - leading) : 0
    add('lines', start, start + leading)
    add('context', start + leading, cursor - trailing)
    add('lines', cursor - trailing, cursor)
  }
  return sections
}

/** Build only one page of render items, even when an entire large file is expanded. */
export function diffPage(
  sections: readonly DiffSection[],
  expanded: ReadonlySet<number>,
  requestedPage: number,
) {
  let total = 0
  for (const section of sections) {
    total +=
      section.kind === 'context'
        ? 1 + (expanded.has(section.start) ? section.end - section.start : 0)
        : section.end - section.start
  }
  const pageCount = Math.max(1, Math.ceil(total / DIFF_PAGE_LINES))
  const page = Math.max(0, Math.min(pageCount - 1, Math.floor(requestedPage) || 0))
  const first = page * DIFF_PAGE_LINES
  const last = first + DIFF_PAGE_LINES
  const items: DiffPageItem[] = []
  let position = 0
  for (const section of sections) {
    if (position >= last) break
    if (section.kind === 'context') {
      if (position >= first) items.push({ kind: 'context', section })
      position++
      if (!expanded.has(section.start)) continue
    }
    const count = section.end - section.start
    const start = Math.max(0, first - position)
    const end = Math.min(count, last - position)
    for (let offset = start; offset < end; offset++) {
      items.push({ kind: 'line', index: section.start + offset })
    }
    position += count
  }
  return { items, page, pageCount }
}
