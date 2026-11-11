import { useI18n } from '@atoms-demo/i18n/react'
import { FileCodeIcon, Folder01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { type ReactNode, useLayoutEffect, useMemo, useRef } from 'react'
import { Badge } from '#components/badge'
import { Button } from '#components/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '#components/collapsible'
import { Spinner } from '#components/spinner'

type FileNode = { name: string; path: string; children: FileNode[]; file: boolean }

function fileTree(paths: readonly string[]): FileNode[] {
  const root: FileNode[] = []
  for (const path of [...paths].sort()) {
    let children = root
    const parts = path.split('/')
    for (const [index, name] of parts.entries()) {
      const nodePath = parts.slice(0, index + 1).join('/')
      let node = children.find((item) => item.path === nodePath)
      if (!node) {
        node = { name, path: nodePath, children: [], file: index === parts.length - 1 }
        children.push(node)
      }
      children = node.children
    }
  }
  return root
}

function FileList({
  nodes,
  selectedPath,
  activePath,
  onSelect,
}: {
  nodes: FileNode[]
  selectedPath: string | null
  activePath: string | null
  onSelect: (path: string) => void
}) {
  return (
    <ul className="min-w-0 space-y-0.5">
      {nodes.map((node) => (
        <li key={node.path} className="min-w-0">
          {node.file ? (
            <Button
              variant={selectedPath === node.path ? 'secondary' : 'ghost'}
              size="sm"
              className="w-full justify-start"
              aria-pressed={selectedPath === node.path}
              title={node.path}
              data-testid="source-file"
              onClick={() => onSelect(node.path)}
            >
              <HugeiconsIcon
                icon={FileCodeIcon}
                strokeWidth={1.5}
                aria-hidden
                className="shrink-0"
              />
              <span className="truncate font-mono text-xs">{node.name}</span>
              {activePath === node.path && <Spinner className="ml-auto size-3 shrink-0" />}
            </Button>
          ) : (
            <Collapsible defaultOpen>
              <CollapsibleTrigger
                render={<Button variant="ghost" size="sm" className="w-full justify-start" />}
              >
                <HugeiconsIcon
                  icon={Folder01Icon}
                  strokeWidth={1.5}
                  aria-hidden
                  className="mr-1 inline size-3.5"
                />
                <span className="truncate font-mono text-xs">{node.name}</span>
              </CollapsibleTrigger>
              <CollapsibleContent className="ml-3 border-l pl-1">
                <FileList
                  nodes={node.children}
                  selectedPath={selectedPath}
                  activePath={activePath}
                  onSelect={onSelect}
                />
              </CollapsibleContent>
            </Collapsible>
          )}
        </li>
      ))}
    </ul>
  )
}

export function CodeSurface({
  paths,
  selectedPath,
  activePath,
  language,
  templateLabel,
  running,
  draft,
  phaseLabel,
  sizeLabel,
  onSelect,
  onCopy,
  children,
}: {
  paths: readonly string[]
  selectedPath: string | null
  activePath: string | null
  language: string
  templateLabel?: string
  running: boolean
  draft: boolean
  phaseLabel?: string
  sizeLabel: string
  onSelect: (path: string) => void
  onCopy: () => void
  children: ReactNode
}) {
  const { t } = useI18n()
  const source = useRef<HTMLElement>(null)
  const positions = useRef(new Map<string, { top: number; left: number }>())
  const tree = useMemo(() => fileTree(paths), [paths])
  const statusLabel = phaseLabel || t('atoms.files.generating')
  useLayoutEffect(() => {
    const element = source.current
    if (!element || !selectedPath) return
    const position = positions.current.get(selectedPath)
    element.scrollTop = position?.top ?? 0
    element.scrollLeft = position?.left ?? 0
  }, [selectedPath])

  return (
    <div
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm"
      data-testid="code-view"
    >
      <div className="flex min-h-10 shrink-0 flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">
          {t('atoms.files.navigation')}
        </span>
        <span className="text-xs text-muted-foreground">
          {templateLabel && `${templateLabel} · `}
          {t('atoms.files.count', { count: paths.length })}
        </span>
      </div>
      {paths.length > 0 ? (
        <>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col sm:flex-row">
            <nav
              aria-label={t('atoms.files.navigation')}
              className="max-h-36 min-w-0 shrink-0 overflow-auto border-b p-1.5 sm:max-h-none sm:w-40 sm:border-r sm:border-b-0"
            >
              <FileList
                nodes={tree}
                selectedPath={selectedPath}
                activePath={activePath}
                onSelect={onSelect}
              />
            </nav>
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-1.5">
                <span title={selectedPath ?? undefined} className="truncate font-mono text-xs">
                  {selectedPath}
                </span>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-xs text-muted-foreground">{language}</span>
                  <Button variant="ghost" size="sm" onClick={onCopy} disabled={!selectedPath}>
                    {t('atoms.files.copy')}
                  </Button>
                </div>
              </div>
              <section
                ref={source}
                aria-label={t('atoms.files.sourceLabel', { path: selectedPath ?? '' })}
                className="min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                onScroll={(event) => {
                  if (selectedPath)
                    positions.current.set(selectedPath, {
                      top: event.currentTarget.scrollTop,
                      left: event.currentTarget.scrollLeft,
                    })
                }}
              >
                {children}
              </section>
            </div>
          </div>
          <div className="shrink-0 space-y-2 border-t px-3 py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Badge variant={draft ? 'secondary' : 'outline'}>
                {draft
                  ? t(running ? 'atoms.files.liveDraft' : 'atoms.files.unsavedDraft')
                  : t('atoms.files.savedVersion')}
              </Badge>
              <span className="font-mono text-xs text-muted-foreground">{sizeLabel}</span>
            </div>
            {draft && (
              <p className="text-xs leading-5 text-muted-foreground">
                {t('atoms.files.draftHint')}
              </p>
            )}
            {running && (
              <div role="status" className="flex items-start gap-2 text-xs text-muted-foreground">
                <Spinner aria-hidden className="mt-0.5 size-3 shrink-0" />
                <span className="min-w-0 break-words leading-4">
                  {activePath ? t('atoms.files.writing', { path: activePath }) : statusLabel}
                </span>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="grid min-h-0 flex-1 place-items-center overflow-auto px-5 py-8">
          <div className="w-full max-w-sm space-y-5 text-center" data-testid="code-empty">
            <div className="mx-auto grid size-14 place-items-center rounded-2xl border border-border bg-surface-sunken">
              <HugeiconsIcon
                icon={FileCodeIcon}
                strokeWidth={1.5}
                aria-hidden
                className="size-6 text-muted-foreground"
              />
            </div>
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">
                {t(running ? 'atoms.files.generatingTitle' : 'atoms.files.emptyTitle')}
              </h3>
              <p className="text-sm leading-6 text-muted-foreground">
                {t(running ? 'atoms.files.generatingDescription' : 'atoms.files.emptyDescription')}
              </p>
            </div>
            {running && (
              <div
                role="status"
                className="mx-auto flex w-fit max-w-full items-start gap-2 rounded-lg bg-sky-wash px-3 py-2 text-xs text-foreground"
              >
                <Spinner aria-hidden className="mt-0.5 size-3 shrink-0" />
                <span className="min-w-0 break-words text-left leading-4">{statusLabel}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
