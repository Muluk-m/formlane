import type { ProjectSource } from '@atoms-demo/core/project'
import { useI18n } from '@atoms-demo/i18n/react'
import { Button } from '@atoms-demo/ui/components/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@atoms-demo/ui/components/empty'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@atoms-demo/ui/components/table'
import { CheckmarkCircle02Icon, FileCodeIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useId, useMemo, useRef, useState } from 'react'
import {
  type DiffLine,
  diffPage,
  diffProjectSources,
  diffSections,
  type SourceFileDiff,
} from '../features/projects/source-diff'

const statusKeys = {
  added: 'atoms.diff.added',
  removed: 'atoms.diff.removed',
  modified: 'atoms.diff.modified',
} as const

export function VersionDiff({
  before,
  after,
  beforeLabel,
  afterLabel,
}: {
  before: ProjectSource | null
  after: ProjectSource
  beforeLabel: string
  afterLabel: string
}) {
  const { t } = useI18n()
  const files = useMemo(() => diffProjectSources(before, after), [before, after])
  const [selection, setSelection] = useState<string | null>(null)
  const selected = files.find((file) => file.path === selection) ?? files[0]
  const totals = files.reduce(
    (sum, file) => ({
      additions: sum.additions + file.additions,
      removals: sum.removals + file.removals,
    }),
    { additions: 0, removals: 0 },
  )

  return (
    <section
      aria-label={t('atoms.diff.title')}
      className="flex h-full min-h-0 min-w-0 flex-col bg-card"
      data-testid="version-diff"
    >
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <p className="min-w-0 break-words text-sm">
          <span className="text-muted-foreground">{beforeLabel}</span>
          <span aria-hidden="true" className="px-2">
            →
          </span>
          <span className="sr-only">{t('atoms.diff.to')}</span>
          <span className="font-medium">{afterLabel}</span>
        </p>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-muted-foreground">
            {t('atoms.diff.filesChanged', { count: files.length })}
          </span>
          <LineCounts additions={totals.additions} removals={totals.removals} />
        </div>
      </header>
      {!selected ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={1.5} />
            </EmptyMedia>
            <EmptyTitle>{t('atoms.diff.unchanged')}</EmptyTitle>
            <EmptyDescription>{t('atoms.diff.unchangedDescription')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row">
          <nav
            aria-label={t('atoms.diff.changedFiles')}
            className="max-h-40 shrink-0 overflow-auto border-b p-2 md:max-h-none md:w-56 md:border-r md:border-b-0"
          >
            <ul className="space-y-1">
              {files.map((file) => (
                <li key={file.path}>
                  <Button
                    variant={file.path === selected.path ? 'secondary' : 'ghost'}
                    aria-pressed={file.path === selected.path}
                    onClick={() => setSelection(file.path)}
                    className="h-auto min-h-11 w-full justify-start gap-2 py-2 text-left"
                    title={file.path}
                  >
                    <HugeiconsIcon
                      icon={FileCodeIcon}
                      strokeWidth={1.5}
                      className="size-4 shrink-0"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-xs">{file.path}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                        <span className="text-muted-foreground">{t(statusKeys[file.status])}</span>
                        <LineCounts additions={file.additions} removals={file.removals} />
                      </span>
                    </span>
                  </Button>
                </li>
              ))}
            </ul>
          </nav>
          <FileDiff key={selected.path} file={selected} />
        </div>
      )}
    </section>
  )
}

function LineCounts({ additions, removals }: { additions: number; removals: number }) {
  const { t } = useI18n()
  return (
    <span className="inline-flex shrink-0 gap-2 font-mono tabular-nums">
      <span className="text-success">
        <span className="sr-only">{t('atoms.diff.additionCount', { count: additions })}</span>
        <span aria-hidden="true">+{additions}</span>
      </span>
      <span className="text-destructive">
        <span className="sr-only">{t('atoms.diff.removalCount', { count: removals })}</span>
        <span aria-hidden="true">−{removals}</span>
      </span>
    </span>
  )
}

function FileDiff({ file }: { file: SourceFileDiff }) {
  const { t } = useI18n()
  const id = useId()
  const scrollRef = useRef<HTMLElement>(null)
  const sections = useMemo(() => diffSections(file.lines), [file])
  const [view, setView] = useState<{ file: SourceFileDiff; expanded: Set<number>; page: number }>(
    () => ({
      file,
      expanded: new Set(),
      page: 0,
    }),
  )
  // Snapshot changes reset pagination/context even if this path still exists in the next comparison.
  const expanded = useMemo(
    () => (view.file === file ? view.expanded : new Set<number>()),
    [view, file],
  )
  const page = diffPage(sections, expanded, view.file === file ? view.page : 0)
  function navigate(next: number) {
    setView({ file, expanded, page: next })
    scrollRef.current?.scrollTo({ top: 0, left: 0 })
  }
  function toggleContext(start: number) {
    const next = new Set(expanded)
    if (next.has(start)) next.delete(start)
    else next.add(start)
    setView({ file, expanded: next, page: page.page })
  }

  return (
    <section aria-labelledby={`${id}-path`} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
        <h3 id={`${id}-path`} className="min-w-0 break-all font-mono text-xs font-medium">
          {file.path}
        </h3>
        <span className="text-xs text-muted-foreground">{t(statusKeys[file.status])}</span>
      </div>
      {file.coarse && (
        <p className="shrink-0 border-b bg-info-bg px-3 py-2 text-xs text-info">
          {t('atoms.diff.coarse')}
        </p>
      )}
      {expanded.size > 0 && (
        <div className="shrink-0 border-b px-3 py-1">
          <Button
            variant="ghost"
            onClick={() => {
              setView({ file, expanded: new Set(), page: 0 })
              scrollRef.current?.scrollTo({ top: 0 })
            }}
          >
            {t('atoms.diff.collapseContext')}
          </Button>
        </div>
      )}
      {file.lines.length === 0 ? (
        <Empty>
          <EmptyDescription>{t('atoms.diff.emptyFile')}</EmptyDescription>
        </Empty>
      ) : (
        <section
          ref={scrollRef}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: This scroll region needs keyboard focus for arrow and page scrolling.
          tabIndex={0}
          aria-label={t('atoms.diff.fileChanges', { path: file.path })}
          className="min-h-0 flex-1 overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&_[data-slot=table-container]]:overflow-visible"
        >
          <Table
            aria-label={t('atoms.diff.unified')}
            className="w-max min-w-full font-mono text-xs tabular-nums"
          >
            <TableHeader className="sticky top-0 z-10 bg-surface-sunken">
              <TableRow>
                <TableHead scope="col" className="w-14 px-1 text-right text-muted-foreground">
                  {t('atoms.diff.before')}
                </TableHead>
                <TableHead scope="col" className="w-14 px-1 text-right text-muted-foreground">
                  {t('atoms.diff.after')}
                </TableHead>
                <TableHead scope="col" className="px-3 text-muted-foreground">
                  {t('atoms.diff.source')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {page.items.map((item) =>
                item.kind === 'context' ? (
                  <TableRow key={`context-${item.section.start}`} className="bg-surface-sunken">
                    <TableCell colSpan={3} className="px-3 py-1">
                      <Button
                        variant="ghost"
                        aria-expanded={expanded.has(item.section.start)}
                        onClick={() => toggleContext(item.section.start)}
                      >
                        {t(
                          expanded.has(item.section.start)
                            ? 'atoms.diff.hideLines'
                            : 'atoms.diff.showLines',
                          { count: item.section.end - item.section.start },
                        )}
                      </Button>
                    </TableCell>
                  </TableRow>
                ) : (
                  <DiffRow key={item.index} line={file.lines[item.index]} />
                ),
              )}
            </TableBody>
          </Table>
        </section>
      )}
      {page.pageCount > 1 && (
        <nav
          aria-label={t('atoms.diff.pagination')}
          className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t px-3 py-2"
        >
          <Button
            variant="outline"
            disabled={page.page === 0}
            onClick={() => navigate(page.page - 1)}
          >
            {t('atoms.diff.previous')}
          </Button>
          <span role="status" className="text-xs text-muted-foreground">
            {t('atoms.diff.page', { current: page.page + 1, total: page.pageCount })}
          </span>
          <Button
            variant="outline"
            disabled={page.page + 1 === page.pageCount}
            onClick={() => navigate(page.page + 1)}
          >
            {t('atoms.diff.next')}
          </Button>
        </nav>
      )}
    </section>
  )
}

function DiffRow({ line }: { line: DiffLine | undefined }) {
  const { t } = useI18n()
  if (line === undefined) throw new RangeError('Diff row index is out of bounds')
  const endsWithNewline = line.text.endsWith('\n')
  const crlf = line.text.endsWith('\r\n')
  const content = endsWithNewline ? line.text.slice(0, crlf ? -2 : -1) : line.text
  const tone =
    line.kind === 'added'
      ? 'bg-success-bg text-success'
      : line.kind === 'removed'
        ? 'bg-danger-bg text-destructive'
        : 'text-foreground'
  return (
    <TableRow className={`border-0 leading-6 hover:bg-transparent ${tone}`}>
      <TableCell className="w-14 select-none border-r border-border px-2 py-0 text-right text-muted-foreground">
        {line.beforeLine}
      </TableCell>
      <TableCell className="w-14 select-none border-r border-border px-2 py-0 text-right text-muted-foreground">
        {line.afterLine}
      </TableCell>
      <TableCell className="py-0 pr-4 pl-0">
        <span aria-hidden="true" className="inline-block w-7 select-none text-center">
          {line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' '}
        </span>
        {line.kind !== 'context' && <span className="sr-only">{t(statusKeys[line.kind])}: </span>}
        <code className="whitespace-pre">{content}</code>
        {!endsWithNewline && (
          <span className="ml-4 whitespace-nowrap text-muted-foreground">
            {t('atoms.diff.noNewline')}
          </span>
        )}
        {crlf && (
          <span className="ml-4 whitespace-nowrap text-muted-foreground">
            {t('atoms.diff.crlf')}
          </span>
        )}
      </TableCell>
    </TableRow>
  )
}
