import type { ProjectSource } from '@atoms-demo/core/project'
import { describe, expect, it } from 'vitest'
import {
  DIFF_MATRIX_CELL_LIMIT,
  DIFF_PAGE_LINES,
  type DiffLine,
  diffPage,
  diffProjectSources,
  diffSections,
  diffSourceLines,
} from './source-diff'

function source(files: Record<string, string>): ProjectSource {
  return { template: 'vanilla', files }
}

function reconstruct(lines: readonly DiffLine[], side: 'before' | 'after') {
  return lines
    .filter((line) => line.kind !== (side === 'before' ? 'added' : 'removed'))
    .map((line) => line.text)
    .join('')
}

function expectReconstruction(before: string, after: string) {
  const result = diffSourceLines(before, after)
  expect(reconstruct(result.lines, 'before')).toBe(before)
  expect(reconstruct(result.lines, 'after')).toBe(after)
  let oldLine = 0
  let newLine = 0
  for (const line of result.lines) {
    expect(line.beforeLine).toBe(line.kind === 'added' ? null : ++oldLine)
    expect(line.afterLine).toBe(line.kind === 'removed' ? null : ++newLine)
  }
  expect(result.additions).toBe(result.lines.filter((line) => line.kind === 'added').length)
  expect(result.removals).toBe(result.lines.filter((line) => line.kind === 'removed').length)
  return result
}

describe('saved source changes', () => {
  it('lists only changed files in stable path order with statuses and line totals', () => {
    const before = source({
      'same.txt': 'same\n',
      'removed.txt': 'old\n',
      'changed.txt': 'before\n',
      'empty.txt': '',
    })
    const after = source({
      'same.txt': 'same\n',
      'added.txt': 'new\nsecond\n',
      'changed.txt': 'after\n',
      'empty.txt': '',
    })
    const changes = diffProjectSources(before, after)
    expect(
      changes.map(({ path, status, additions, removals }) => ({
        path,
        status,
        additions,
        removals,
      })),
    ).toEqual([
      { path: 'added.txt', status: 'added', additions: 2, removals: 0 },
      { path: 'changed.txt', status: 'modified', additions: 1, removals: 1 },
      { path: 'removed.txt', status: 'removed', additions: 0, removals: 1 },
    ])
    expect(before.files['removed.txt']).toBe('old\n')
    expect(after.files['changed.txt']).toBe('after\n')
    expect(diffProjectSources(after, after)).toEqual([])
  })

  it('treats a null baseline as additions, including an empty added file', () => {
    const changes = diffProjectSources(
      null,
      source({ 'index.html': '<main>Hi</main>\n', 'empty.txt': '' }),
    )
    expect(
      changes.map(({ path, status, additions, removals }) => ({
        path,
        status,
        additions,
        removals,
      })),
    ).toEqual([
      { path: 'empty.txt', status: 'added', additions: 0, removals: 0 },
      { path: 'index.html', status: 'added', additions: 1, removals: 0 },
    ])
    expect(changes[0]?.lines).toEqual([])
    expect(changes[1]?.lines[0]).toMatchObject({ beforeLine: null, afterLine: 1 })
  })

  it('distinguishes an empty removed file from an unchanged empty file', () => {
    expect(diffProjectSources(source({ 'empty.txt': '' }), source({}))).toEqual([
      { path: 'empty.txt', status: 'removed', additions: 0, removals: 0, coarse: false, lines: [] },
    ])
    expect(diffProjectSources(source({ 'empty.txt': '' }), source({ 'empty.txt': '' }))).toEqual([])
  })
})

describe('exact line changes', () => {
  it('keeps unchanged lines and assigns both line numbers across an insertion and deletion', () => {
    const result = expectReconstruction('one\nold\nkeep\nlast\n', 'one\nkeep\nnew\nlast\n')
    expect(result.lines).toEqual([
      { kind: 'context', text: 'one\n', beforeLine: 1, afterLine: 1 },
      { kind: 'removed', text: 'old\n', beforeLine: 2, afterLine: null },
      { kind: 'context', text: 'keep\n', beforeLine: 3, afterLine: 2 },
      { kind: 'added', text: 'new\n', beforeLine: null, afterLine: 3 },
      { kind: 'context', text: 'last\n', beforeLine: 4, afterLine: 4 },
    ])
  })

  it.each([
    ['', '', 0, 0],
    ['', '\n', 1, 0],
    ['\n', '', 0, 1],
    ['line', 'line\n', 1, 1],
    ['line\n', 'line', 1, 1],
    ['line\n', 'line\n\n', 1, 0],
    ['line\r\n', 'line\n', 1, 1],
    ['\r', '\r\n', 1, 1],
  ])('preserves empty lines and endings for %j → %j', (before, after, additions, removals) => {
    const result = expectReconstruction(before, after)
    expect(result.additions).toBe(additions)
    expect(result.removals).toBe(removals)
  })

  it('reconstructs repeated lines, unicode, and untrusted markup without interpreting source', () => {
    const texts = [
      '',
      '\n',
      'a',
      'a\n',
      'a\na\n',
      'a\nb\na\n',
      'b\na\nb',
      '中文🙂\r\n',
      '<script>alert("x")</script>\n<img src=x onerror=alert(1)>',
      '&lt;main&gt;\n',
    ]
    for (const before of texts) {
      for (const after of texts) expectReconstruction(before, after)
    }
  })

  it('uses the bounded matrix at its limit, and exact coarse replacement above it', () => {
    const atLimit = Math.sqrt(DIFF_MATRIX_CELL_LIMIT) - 1
    const precise = expectReconstruction('a\n'.repeat(atLimit), 'b\n'.repeat(atLimit))
    expect(precise.coarse).toBe(false)
    const before = `shared first\n${'a\n'.repeat(atLimit + 1)}shared last\n`
    const after = `shared first\n${'b\n'.repeat(atLimit + 1)}shared last\n`
    const coarse = expectReconstruction(before, after)
    expect(coarse.coarse).toBe(true)
    expect(coarse.additions).toBe(atLimit + 1)
    expect(coarse.removals).toBe(atLimit + 1)
    expect(coarse.lines[0]?.kind).toBe('context')
    expect(coarse.lines.at(-1)?.kind).toBe('context')
  })

  it('trims a large shared prefix and suffix before deciding whether to simplify', () => {
    const unchanged = 'same\n'.repeat(2_000)
    const result = expectReconstruction(
      `${unchanged}old\n${unchanged}`,
      `${unchanged}new\n${unchanged}`,
    )
    expect(result.coarse).toBe(false)
    expect(result.additions).toBe(1)
    expect(result.removals).toBe(1)
  })
})

describe('bounded unified diff presentation', () => {
  it('keeps three context lines around changes and makes the rest expandable', () => {
    const before = `${'leading\n'.repeat(10)}old\n${'middle\n'.repeat(10)}old\n${'trailing\n'.repeat(10)}`
    const after = before.replaceAll('old\n', 'new\n')
    const { lines } = diffSourceLines(before, after)
    const sections = diffSections(lines)
    expect(sections.filter((section) => section.kind === 'context')).toEqual([
      { kind: 'context', start: 0, end: 7 },
      { kind: 'context', start: 15, end: 19 },
      { kind: 'context', start: 27, end: 34 },
    ])
    expect(sections[0]?.start).toBe(0)
    expect(sections.at(-1)?.end).toBe(lines.length)
    sections.slice(1).forEach((section, index) => {
      expect(section.start).toBe(sections[index]?.end)
    })
  })

  it('keeps overlapping short context in a single visible section', () => {
    const result = diffSourceLines('old\na\nb\nc\nd\ne\nold\n', 'new\na\nb\nc\nd\ne\nnew\n')
    expect(diffSections(result.lines)).toEqual([
      { kind: 'lines', start: 0, end: result.lines.length },
    ])
  })

  it('paginates large additions without dropping or duplicating a line', () => {
    const { lines } = diffSourceLines('', 'new\n'.repeat(DIFF_PAGE_LINES * 3 + 1))
    const sections = diffSections(lines)
    const seen: number[] = []
    for (let page = 0; page < 4; page++) {
      const result = diffPage(sections, new Set(), page)
      expect(result.pageCount).toBe(4)
      expect(result.items.length).toBeLessThanOrEqual(DIFF_PAGE_LINES)
      for (const item of result.items) if (item.kind === 'line') seen.push(item.index)
    }
    expect(seen).toEqual(lines.map((_, index) => index))
    expect(diffPage(sections, new Set(), -1).page).toBe(0)
    expect(diffPage(sections, new Set(), 99).page).toBe(3)
  })

  it('bounds expanded context and preserves access to every line across page boundaries', () => {
    const { lines } = diffSourceLines(
      `${'same\n'.repeat(1_000)}old\n`,
      `${'same\n'.repeat(1_000)}new\n`,
    )
    const sections = diffSections(lines)
    const collapsed = diffPage(sections, new Set(), 0)
    expect(collapsed.pageCount).toBe(1)
    expect(collapsed.items[0]?.kind).toBe('context')
    const expanded = new Set(
      sections.filter((section) => section.kind === 'context').map((section) => section.start),
    )
    const first = diffPage(sections, expanded, 0)
    const seen: number[] = []
    for (let page = 0; page < first.pageCount; page++) {
      const result = diffPage(sections, expanded, page)
      expect(result.items.length).toBeLessThanOrEqual(DIFF_PAGE_LINES)
      for (const item of result.items) if (item.kind === 'line') seen.push(item.index)
    }
    expect(seen).toEqual(lines.map((_, index) => index))
    expect(diffPage(sections, new Set(), first.pageCount - 1).page).toBe(0)
    expect(diffPage([], new Set(), 0)).toEqual({ items: [], page: 0, pageCount: 1 })
  })
})
