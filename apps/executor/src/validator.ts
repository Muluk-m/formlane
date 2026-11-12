import { MAX_PREVIEW_BYTES } from '@atoms-demo/core/project'
import { chromium } from 'playwright'
import { z } from 'zod'

const defaultViewport = { width: 1280, height: 720 }
const browserAssertionSchema = z
  .object({
    selector: z.string().min(1).max(300),
    kind: z.enum(['text', 'value', 'count', 'attribute', 'no-horizontal-overflow']),
    attribute: z.string().min(1).max(100).nullish(),
    expected: z.string().max(1000),
  })
  .superRefine((assertion, context) => {
    if (assertion.kind === 'attribute' && !assertion.attribute)
      context.addIssue({
        code: 'custom',
        path: ['attribute'],
        message: 'Attribute assertions require an attribute name.',
      })
    if (assertion.kind === 'no-horizontal-overflow' && assertion.expected !== 'true')
      context.addIssue({
        code: 'custom',
        path: ['expected'],
        message: 'No-horizontal-overflow assertions require expected "true".',
      })
  })

export const browserCheckSchema = z
  .object({
    name: z.string().min(1).max(160),
    viewport: z
      .object({
        width: z.number().int().min(375).max(1440),
        height: z.number().int().min(640).max(1200),
      })
      .nullish()
      .default(defaultViewport),
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
      .max(16),
    assertion: browserAssertionSchema.nullish(),
    assertions: z.array(browserAssertionSchema).max(12).optional().default([]),
  })
  .superRefine((check, context) => {
    const count = check.assertions.length + (check.assertion ? 1 : 0)
    if (count < 1 || count > 12)
      context.addIssue({
        code: 'custom',
        path: ['assertions'],
        message: 'Provide 1–12 assertions in total per check.',
      })
  })
export const browserChecksSchema = z.array(browserCheckSchema).min(2).max(16)
// Input keeps old durable checkpoints and callers without viewport/assertions valid.
export type BrowserCheck = z.input<typeof browserCheckSchema>
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
  if (new TextEncoder().encode(html).byteLength > MAX_PREVIEW_BYTES)
    report.issues.push(`Artifact exceeds ${MAX_PREVIEW_BYTES} UTF-8 bytes.`)
  const parsedChecks = browserChecksSchema.safeParse(checks)
  if (!parsedChecks.success)
    report.issues.push(`Invalid acceptance checks: ${parsedChecks.error.message}`)
  if (parsedChecks.success && !parsedChecks.data.some((check) => check.actions.length))
    report.issues.push(
      'Provide at least two meaningful acceptance checks, including an interaction.',
    )
  if (report.issues.length || !parsedChecks.success) return report
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
    for (const check of parsedChecks.data) {
      signal.throwIfAborted()
      const context = await browser.newContext({
        serviceWorkers: 'block',
        acceptDownloads: false,
        viewport: check.viewport ?? defaultViewport,
      })
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
          `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src about:; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}iframe{display:block;width:100%;height:100%;border:0}</style></head><body><iframe sandbox="allow-scripts allow-forms" title="Candidate"></iframe></body></html>`,
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
        const assertions = check.assertion
          ? [check.assertion, ...check.assertions]
          : check.assertions
        // Poll together so one failure cannot consume the other assertions' shared budget.
        const deadline = Date.now() + 5000
        const outcomes = await Promise.all(
          assertions.map(async (assertion, index) => {
            const element = frame.locator(assertion.selector)
            let actual: string | null = null
            let sampled = false
            let matches = false
            let sampleError: unknown
            do {
              signal.throwIfAborted()
              const timeout = Math.max(1, Math.min(500, deadline - Date.now()))
              try {
                if (assertion.kind === 'no-horizontal-overflow') {
                  actual = String(
                    await frame.evaluate(() => {
                      const root = document.documentElement
                      return (
                        Math.max(root.scrollWidth, document.body?.scrollWidth ?? 0) <=
                        root.clientWidth
                      )
                    }),
                  )
                } else if (assertion.kind === 'attribute') {
                  if (!assertion.attribute) throw new Error('Attribute assertion requires a name.')
                  actual = await element.getAttribute(assertion.attribute, { timeout })
                } else if (assertion.kind === 'count') {
                  actual = String(await element.count())
                } else if (assertion.kind === 'value') {
                  actual = await element.inputValue({ timeout })
                } else {
                  actual = (await element.textContent({ timeout }))?.trim() ?? ''
                }
                sampled = true
                signal.throwIfAborted()
                matches =
                  assertion.kind === 'text'
                    ? (actual?.includes(assertion.expected) ?? false)
                    : actual === assertion.expected
                if (matches) break
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
            const detail = sampled
              ? JSON.stringify(actual?.slice(0, 300) ?? null)
              : sampleError instanceof Error
                ? sampleError.message.slice(0, 300)
                : 'No assertion result.'
            return {
              actual: sampled ? (actual?.slice(0, 1000) ?? 'null') : detail,
              issue:
                sampled && matches
                  ? null
                  : `${check.name} assertion ${index + 1} (${assertion.kind}, ${assertion.selector}): expected ${JSON.stringify(assertion.expected)}, got ${detail}.`,
            }
          }),
        )
        const results = outcomes.map((outcome) => outcome.actual)
        let passed = true
        for (const outcome of outcomes) {
          if (outcome.issue) {
            passed = false
            report.issues.push(outcome.issue)
          }
        }
        if (errors.length) {
          passed = false
          report.issues.push(`${check.name}: ${errors.join('; ')}`)
        }
        report.checks.push({
          name: check.name,
          passed,
          actual: (results.length === 1
            ? (results[0] ?? '')
            : results.map((result, index) => `${index + 1}: ${result}`).join('; ')
          ).slice(0, 1000),
        })
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
