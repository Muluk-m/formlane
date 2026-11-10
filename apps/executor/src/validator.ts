import { chromium } from 'playwright'
import { z } from 'zod'

export const browserCheckSchema = z.object({
  name: z.string().min(1).max(160),
  actions: z
    .array(
      z.union([
        z.object({
          kind: z.literal('click'),
          selector: z.string().min(1).max(300),
          value: z.null(),
        }),
        z.object({
          kind: z.literal('fill'),
          selector: z.string().min(1).max(300),
          value: z.string().max(1000),
        }),
        z.object({
          kind: z.literal('press'),
          selector: z.string().min(1).max(300),
          value: z.enum([
            'Enter',
            'Escape',
            'Tab',
            'Space',
            'Backspace',
            'Delete',
            'ArrowUp',
            'ArrowDown',
            'ArrowLeft',
            'ArrowRight',
            'Home',
            'End',
            'PageUp',
            'PageDown',
          ]),
        }),
        z.object({
          kind: z.literal('reload'),
          selector: z.literal('body'),
          value: z.null(),
        }),
      ]),
    )
    .max(8),
  assertion: z.object({
    selector: z.string().min(1).max(300),
    kind: z.enum(['text', 'value', 'count']),
    expected: z.string().max(1000),
  }),
})
export type BrowserCheck = z.infer<typeof browserCheckSchema>
export type ValidationReport = {
  valid: boolean
  artifactHash: string
  issues: string[]
  checks: { name: string; passed: boolean; actual: string }[]
}
export async function artifactHash(html: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(html))
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function validateArtifact(
  html: string,
  checks: BrowserCheck[],
  signal: AbortSignal,
): Promise<ValidationReport> {
  signal.throwIfAborted()
  const report: ValidationReport = {
    valid: false,
    artifactHash: await artifactHash(html),
    issues: [],
    checks: [],
  }
  if (!/^\s*<!doctype html/i.test(html) || !/<\/html>\s*$/i.test(html))
    report.issues.push('Return a complete HTML document.')
  if (html.length > 180_000) report.issues.push('Artifact exceeds 180000 characters.')
  if (checks.length < 2 || !checks.some((check) => check.actions.length))
    report.issues.push(
      'Provide at least two meaningful acceptance checks, including an interaction.',
    )
  if (report.issues.length) return report
  // Never inherit provider/control-plane credentials into the browser process.
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
    chromiumSandbox: true,
    headless: true,
    args: ['--force-webrtc-ip-handling-policy=disable_non_proxied_udp'],
    timeout: 15_000,
    env: Object.fromEntries(
      ['HOME', 'PATH', 'TMPDIR', 'LANG'].flatMap((name) => {
        const value = process.env[name]
        return value === undefined ? [] : [[name, value]]
      }),
    ),
  })
  const closeOnAbort = () => {
    void browser.close().catch(() => undefined)
  }
  signal.addEventListener('abort', closeOnAbort, { once: true })
  try {
    for (const check of checks) {
      signal.throwIfAborted()
      const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false })
      context.setDefaultTimeout(5000)
      context.setDefaultNavigationTimeout(5000)
      const page = await context.newPage()
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message.slice(0, 300)))
      try {
        await context.route('**/*', (route) => route.abort())
        await context.routeWebSocket('**/*', (socket) => socket.close())
        // The immutable parent policy is inherited by srcdoc, including later navigations.
        // The sandbox omits same-origin, popups, downloads and top-navigation permissions.
        await page.setContent(
          `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src about:; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"></head><body><iframe sandbox="allow-scripts allow-forms" title="Candidate"></iframe></body></html>`,
        )
        const frame = page
          .frames()
          .find((candidate) => candidate.parentFrame() === page.mainFrame())
        if (!frame) throw new Error('Candidate iframe was not attached.')
        const loadArtifact = async () => {
          // Observe a new navigation even when reloading the same about:srcdoc URL.
          await Promise.all([
            frame.waitForNavigation({
              url: 'about:srcdoc',
              waitUntil: 'domcontentloaded',
              timeout: 5000,
            }),
            page.locator('iframe').evaluate((element, source) => {
              element.setAttribute('srcdoc', source)
            }, html),
          ])
        }
        await loadArtifact()
        signal.throwIfAborted()
        for (const action of check.actions) {
          signal.throwIfAborted()
          if (action.kind === 'reload') {
            await loadArtifact()
            continue
          }
          const element = frame.locator(action.selector)
          if (action.kind === 'click') await element.click({ timeout: 5000 })
          else if (action.kind === 'press') await element.press(action.value, { timeout: 5000 })
          else await element.fill(action.value, { timeout: 5000 })
        }
        const element = frame.locator(check.assertion.selector)
        const deadline = Date.now() + 5000
        let actual = ''
        let sampled = false
        let sampleError: unknown
        do {
          signal.throwIfAborted()
          const timeout = Math.max(1, Math.min(500, deadline - Date.now()))
          try {
            actual =
              check.assertion.kind === 'count'
                ? String(await element.count())
                : check.assertion.kind === 'value'
                  ? await element.inputValue({ timeout })
                  : ((await element.textContent({ timeout }))?.trim() ?? '')
            sampled = true
            signal.throwIfAborted()
            if (actual === check.assertion.expected) break
          } catch (error) {
            signal.throwIfAborted()
            sampleError = error
          }
          const remaining = deadline - Date.now()
          if (remaining <= 0) break
          const pause = Promise.withResolvers<void>()
          setTimeout(pause.resolve, Math.min(100, remaining))
          await pause.promise
        } while (Date.now() < deadline)
        signal.throwIfAborted()
        if (!sampled)
          throw sampleError ?? new Error('No assertion result was available before the deadline.')
        const passed = actual === check.assertion.expected && errors.length === 0
        report.checks.push({ name: check.name, passed, actual: actual.slice(0, 1000) })
        if (!passed)
          report.issues.push(
            `${check.name}: expected ${JSON.stringify(check.assertion.expected)}, got ${JSON.stringify(actual.slice(0, 300))}. ${errors.join('; ')}`,
          )
      } catch (error) {
        signal.throwIfAborted()
        const detail =
          error instanceof Error ? error.message.slice(0, 400) : 'Browser assertion failed.'
        report.checks.push({ name: check.name, passed: false, actual: detail })
        report.issues.push(`${check.name}: ${detail}`)
      } finally {
        await context.close()
      }
    }
    report.valid = report.issues.length === 0
    return report
  } finally {
    signal.removeEventListener('abort', closeOnAbort)
    await browser.close()
  }
}
