import type { ProjectSource } from '@atoms-demo/core/project'
import { useI18n } from '@atoms-demo/i18n/react'
import { Button } from '@atoms-demo/ui/components/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@atoms-demo/ui/components/tabs'
import { CodeSurface } from '@atoms-demo/ui/composites/code-surface'
import {
  ArrowReloadHorizontalIcon,
  ComputerIcon,
  SmartPhone01Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { type ReactNode, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { ProjectBuild } from '../features/projects/workspace'
import { formatBytes } from '../lib/format'
import { highlightSource, sourceLanguage } from '../lib/highlight'

export function Stage({
  html,
  source,
  drafts,
  activePath,
  draft,
  build,
  tab,
  device,
  running,
  staleLabel,
  phaseLabel,
  onTab,
  onDevice,
  onBack,
  versionControl,
  toolbarAction,
  changes,
  candidateNotice,
  onRestore,
  restoreDisabled,
}: {
  html: string
  source: ProjectSource | null
  drafts: Record<string, string>
  activePath: string | null
  draft: boolean
  build: ProjectBuild | null
  tab: 'preview' | 'code' | 'changes'
  device: 'desktop' | 'mobile'
  running: boolean
  staleLabel: string | null
  phaseLabel?: string
  onTab: (tab: 'preview' | 'code' | 'changes') => void
  onDevice: (device: 'desktop' | 'mobile') => void
  onBack: () => void
  versionControl: ReactNode
  toolbarAction?: ReactNode
  changes: ReactNode
  candidateNotice?: ReactNode
  onRestore?: () => void
  restoreDisabled?: boolean
}) {
  const { t, locale } = useI18n()
  const [selection, setSelection] = useState<string | null>(null)
  const [copyError, setCopyError] = useState(false)
  const [previewRevision, setPreviewRevision] = useState(0)
  const paths = useMemo(
    () => [...new Set([...Object.keys(source?.files ?? {}), ...Object.keys(drafts)])].sort(),
    [source, drafts],
  )
  const selectedPath = selection && paths.includes(selection) ? selection : (paths[0] ?? null)
  const code = selectedPath ? (drafts[selectedPath] ?? source?.files[selectedPath] ?? '') : ''
  const language = sourceLanguage(selectedPath ?? '')
  const sizeLabel = useMemo(() => formatBytes(new Blob([code]).size, locale), [code, locale])
  const templateLabel = source ? t(`atoms.files.templates.${source.template}`) : undefined
  async function copyFile() {
    try {
      await navigator.clipboard.writeText(code)
      setCopyError(false)
    } catch {
      setCopyError(true)
    }
  }
  return (
    <Tabs
      value={tab}
      onValueChange={(value) => {
        if (value === 'preview' || value === 'code' || value === 'changes') onTab(value)
      }}
      className="h-full min-h-0 min-w-0 flex-1 gap-0 overflow-hidden rounded-2xl border bg-card shadow-card"
    >
      <div className="flex min-h-14 shrink-0 flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
        <TabsList aria-label={t('atoms.previewTitle')} className="max-w-full">
          <TabsTrigger value="preview" data-testid="tab-preview">
            {t('atoms.preview')}
          </TabsTrigger>
          <TabsTrigger value="code" data-testid="tab-code">
            {t('atoms.code')}
            {running && (
              <span className="size-1.5 motion-safe:animate-pulse rounded-full bg-info" />
            )}
          </TabsTrigger>
          <TabsTrigger value="changes" data-testid="tab-changes">
            {t('atoms.versionReview.changes')}
          </TabsTrigger>
        </TabsList>
        <div className="ml-auto flex min-w-0 items-center gap-2">
          {versionControl}
          {toolbarAction}
        </div>
      </div>
      {candidateNotice}
      {tab === 'preview' && (
        <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={!html}
            aria-label={t('atoms.versionReview.reloadPreview')}
            title={t('atoms.versionReview.reloadPreview')}
            onClick={() => setPreviewRevision((value) => value + 1)}
          >
            <HugeiconsIcon icon={ArrowReloadHorizontalIcon} size={16} strokeWidth={1.5} />
          </Button>
          <span className="min-w-0 flex-1 truncate rounded-md bg-surface-sunken px-3 py-1 text-xs text-muted-foreground">
            {t('atoms.previewAddress')}
          </span>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              size="icon-sm"
              variant={device === 'desktop' ? 'secondary' : 'ghost'}
              data-testid="device-desktop"
              aria-label={t('atoms.desktop')}
              title={t('atoms.desktop')}
              aria-pressed={device === 'desktop'}
              onClick={() => onDevice('desktop')}
            >
              <HugeiconsIcon icon={ComputerIcon} size={16} strokeWidth={1.5} />
            </Button>
            <Button
              size="icon-sm"
              variant={device === 'mobile' ? 'secondary' : 'ghost'}
              data-testid="device-mobile"
              aria-label={t('atoms.mobile')}
              title={t('atoms.mobile')}
              aria-pressed={device === 'mobile'}
              onClick={() => onDevice('mobile')}
            >
              <HugeiconsIcon icon={SmartPhone01Icon} size={16} strokeWidth={1.5} />
            </Button>
          </div>
        </div>
      )}
      {staleLabel && (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b bg-info-bg px-3 py-2 text-xs">
          <span>{staleLabel}</span>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={onBack} data-testid="back-current">
              {t('atoms.backToCurrent')}
            </Button>
            {onRestore && (
              <Button
                variant="outline"
                size="sm"
                disabled={restoreDisabled}
                onClick={onRestore}
                data-testid="restore-viewed"
              >
                {t('atoms.restore')}
              </Button>
            )}
          </div>
        </div>
      )}
      {build && !build.ok && tab === 'code' && (
        <div
          role={build.ok ? 'status' : 'alert'}
          className={`mx-3 mb-2 max-h-32 shrink-0 overflow-auto rounded-lg p-2 text-xs ${build.ok ? 'bg-success-bg text-success' : 'bg-danger-bg text-destructive'}`}
        >
          <p>{t(build.ok ? 'atoms.files.buildPassed' : 'atoms.files.buildFailed')}</p>
          {build.issues.length > 0 && (
            <ul className="mt-1 list-disc space-y-1 pl-4">
              {[...new Set(build.issues)].map((issue) => (
                <li key={issue} className="break-words">
                  {issue}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {copyError && (
        <p role="alert" className="mx-3 mb-2 text-xs text-destructive">
          {t('atoms.files.copyFailed')}
        </p>
      )}
      <div className="min-h-0 min-w-0 flex-1 bg-surface-sunken p-2 sm:p-3">
        <TabsContent value="preview" keepMounted className="h-full min-h-0 data-[hidden]:hidden">
          <div className="flex h-full min-w-0 items-stretch justify-center">
            {html ? (
              <PreviewFrame key={`${previewRevision}:${html}`} html={html} device={device} />
            ) : (
              <div className="grid h-full w-full place-items-center rounded-xl border border-dashed bg-card p-6 text-center text-muted-foreground sm:p-8">
                <p className="max-w-sm">{t('atoms.emptyPreview')}</p>
              </div>
            )}
          </div>
        </TabsContent>
        <TabsContent value="code" keepMounted className="h-full min-h-0 data-[hidden]:hidden">
          <CodeSurface
            paths={paths}
            selectedPath={selectedPath}
            activePath={activePath}
            language={t(`atoms.files.languages.${language}`)}
            templateLabel={templateLabel}
            onSelect={setSelection}
            onCopy={() => void copyFile()}
            running={running && !staleLabel}
            draft={draft}
            phaseLabel={phaseLabel}
            sizeLabel={sizeLabel}
          >
            {selectedPath && <CodeBlock code={code} path={selectedPath} />}
          </CodeSurface>
        </TabsContent>
        <TabsContent
          value="changes"
          keepMounted
          className="h-full min-h-0 overflow-hidden rounded-lg border bg-background data-[hidden]:hidden"
        >
          {changes}
        </TabsContent>
      </div>
    </Tabs>
  )
}
function CodeBlock({ code, path }: { code: string; path: string }) {
  const deferredCode = useDeferredValue(code)
  const pretty = useMemo(() => highlightSource(deferredCode, path), [deferredCode, path])
  return (
    <pre className="code-sheet min-h-full w-max min-w-full overflow-visible!">
      {pretty.map((line) => (
        <span key={line.offset} data-line={line.number} className="code-line">
          {line.tokens.length
            ? line.tokens.map((token) => (
                <span key={token.offset} className={token.className}>
                  {token.text}
                </span>
              ))
            : ' '}
        </span>
      ))}
    </pre>
  )
}

function PreviewFrame({ html, device }: { html: string; device: 'desktop' | 'mobile' }) {
  const { t } = useI18n()
  const frame = useRef<HTMLIFrameElement>(null)
  const [failed, setFailed] = useState(false)
  const document = useMemo(() => {
    const bridge =
      '<script>addEventListener("error",()=>parent.postMessage({type:"atoms-preview-error"},"*"));addEventListener("unhandledrejection",()=>parent.postMessage({type:"atoms-preview-error"},"*"));</script>'
    return /<head(?:\s[^>]*)?>/i.test(html)
      ? html.replace(/<head(?:\s[^>]*)?>/i, (head) => head + bridge)
      : bridge + html
  }, [html])
  useEffect(() => {
    const receive = (event: MessageEvent<unknown>) => {
      if (
        event.source !== frame.current?.contentWindow ||
        typeof event.data !== 'object' ||
        event.data === null
      )
        return
      if ('type' in event.data && event.data.type === 'atoms-preview-error') setFailed(true)
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [])
  return (
    <div className={`device ${device}`} data-testid="preview-frame">
      {failed && (
        <p role="alert" className="shrink-0 bg-danger-bg p-3 text-sm text-destructive">
          {t('atoms.previewError')}
        </p>
      )}
      <iframe
        ref={frame}
        title={t('atoms.previewTitle')}
        sandbox="allow-scripts allow-forms allow-popups"
        srcDoc={document}
      />
    </div>
  )
}
