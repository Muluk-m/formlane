import { useI18n } from '@atoms-demo/i18n/react'
import { Button } from '@atoms-demo/ui/components/button'
import { ButtonGroup } from '@atoms-demo/ui/components/button-group'
import { useEffect, useMemo, useRef, useState } from 'react'
import { formatBytes } from '../lib/format'
import { highlightHtml } from '../lib/highlight'

export function Stage({
  html,
  code,
  tab,
  device,
  running,
  staleLabel,
  onTab,
  onDevice,
  onBack,
}: {
  html: string
  code: string
  tab: 'preview' | 'code'
  device: 'desktop' | 'mobile'
  running: boolean
  staleLabel: string | null
  onTab: (tab: 'preview' | 'code') => void
  onDevice: (device: 'desktop' | 'mobile') => void
  onBack: () => void
}) {
  const { t, locale } = useI18n()
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
      <div className="min-h-0 flex-1 px-3 pb-3">
        {tab === 'preview' ? (
          <div className="flex h-full items-stretch justify-center">
            {html ? (
              <PreviewFrame key={html} html={html} device={device} />
            ) : (
              <div className="grid h-full w-full place-items-center rounded-lg border border-dashed bg-card p-8 text-center text-muted-foreground">
                <p className="max-w-sm">{t('atoms.emptyPreview')}</p>
              </div>
            )}
          </div>
        ) : (
          <div
            className="flex h-full overflow-hidden rounded-lg border bg-card"
            data-testid="code-view"
          >
            <aside className="hidden w-36 shrink-0 border-r p-3 text-sm xl:block">
              <p className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
                {t('atoms.files')}
              </p>
              <p className="rounded bg-muted px-2 py-1">index.html</p>
              {code && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {formatBytes(new Blob([code]).size, locale)}
                </p>
              )}
            </aside>
            {code ? (
              <CodeBlock code={code} running={running} />
            ) : (
              <div className="grid flex-1 place-items-center text-muted-foreground">
                {t('atoms.emptyCode')}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
function CodeBlock({ code, running }: { code: string; running: boolean }) {
  const [pretty, setPretty] = useState(() => highlightHtml(code))
  useEffect(() => {
    const handle = window.setTimeout(() => setPretty(highlightHtml(code)), running ? 160 : 0)
    return () => window.clearTimeout(handle)
  }, [code, running])
  return (
    <pre className="code-sheet flex-1">
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
