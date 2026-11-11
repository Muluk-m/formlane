import type { ProjectSource } from '@atoms-demo/core/project'
import { useI18n } from '@atoms-demo/i18n/react'
import { Button } from '@atoms-demo/ui/components/button'
import { ButtonGroup } from '@atoms-demo/ui/components/button-group'
import { CodeSurface } from '@atoms-demo/ui/composites/code-surface'
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
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
}: {
  html: string
  source: ProjectSource | null
  drafts: Record<string, string>
  activePath: string | null
  draft: boolean
  build: ProjectBuild | null
  tab: 'preview' | 'code'
  device: 'desktop' | 'mobile'
  running: boolean
  staleLabel: string | null
  phaseLabel?: string
  onTab: (tab: 'preview' | 'code') => void
  onDevice: (device: 'desktop' | 'mobile') => void
  onBack: () => void
}) {
  const { t, locale } = useI18n()
  const [selection, setSelection] = useState<string | null>(null)
  const [copyError, setCopyError] = useState(false)
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
    <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-surface-sunken">
      <div className="flex flex-wrap items-center justify-between gap-2 p-3">
        <ButtonGroup aria-label={t('atoms.preview')}>
          <Button
            data-testid="tab-preview"
            variant={tab === 'preview' ? 'default' : 'outline'}
            aria-pressed={tab === 'preview'}
            onClick={() => onTab('preview')}
          >
            {t('atoms.preview')}
          </Button>
          <Button
            data-testid="tab-code"
            variant={tab === 'code' ? 'default' : 'outline'}
            aria-pressed={tab === 'code'}
            onClick={() => onTab('code')}
          >
            {t('atoms.code')}
            {running && <span className="size-1.5 animate-pulse rounded-full bg-current" />}
          </Button>
        </ButtonGroup>
        {tab === 'preview' && (
          <ButtonGroup aria-label={t('atoms.previewTitle')}>
            <Button
              data-testid="device-desktop"
              variant={device === 'desktop' ? 'default' : 'outline'}
              aria-pressed={device === 'desktop'}
              onClick={() => onDevice('desktop')}
            >
              {t('atoms.desktop')}
            </Button>
            <Button
              data-testid="device-mobile"
              variant={device === 'mobile' ? 'default' : 'outline'}
              aria-pressed={device === 'mobile'}
              onClick={() => onDevice('mobile')}
            >
              {t('atoms.mobile')}
            </Button>
          </ButtonGroup>
        )}
      </div>
      {staleLabel && (
        <div className="mx-3 mb-2 flex items-center justify-between gap-2 rounded-lg bg-card p-2 text-sm">
          <span>{staleLabel}</span>
          <Button variant="ghost" onClick={onBack} data-testid="back-current">
            {t('atoms.backToCurrent')}
          </Button>
        </div>
      )}
      {templateLabel && (
        <p className="mx-3 mb-2 text-xs text-muted-foreground">
          {t('atoms.files.template', { template: templateLabel })}
        </p>
      )}
      {build && (
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
      <div className="min-h-0 flex-1 px-3 pb-3">
        <div hidden={tab !== 'preview'} className="h-full">
          <div className="flex h-full items-stretch justify-center">
            {html ? (
              <PreviewFrame key={html} html={html} device={device} />
            ) : (
              <div className="grid h-full w-full place-items-center rounded-lg border border-dashed bg-card p-8 text-center text-muted-foreground">
                <p className="max-w-sm">{t('atoms.emptyPreview')}</p>
              </div>
            )}
          </div>
        </div>
        <div hidden={tab !== 'code'} className="h-full">
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
        </div>
      </div>
    </section>
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
      <div className="flex h-8 shrink-0 items-center border-b bg-muted px-3 text-xs text-muted-foreground">
        {t('atoms.previewAddress')}
      </div>
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
