import { expect, it } from 'vitest'
import { applyFileEdits } from './agents'
import { validateArtifact } from './validator'

const html = `<!doctype html><html><body>
<input id="name" value="">
<button id="save" onclick="document.querySelector('#status').textContent='Saved '+document.querySelector('#name').value">Save</button>
<p id="status" data-state="ready">Not saved</p>
</body></html>`

it('accepts contained text after an interaction and exact non-text assertions', async () => {
  const report = await validateArtifact(
    html,
    [
      {
        name: 'save a name',
        actions: [
          { kind: 'fill', selector: '#name', value: 'Ada' },
          { kind: 'click', selector: '#save', value: null },
        ],
        assertions: [
          { kind: 'text', selector: '#status', expected: 'Saved' },
          { kind: 'value', selector: '#name', expected: 'Ada' },
        ],
      },
      {
        name: 'fresh initial state',
        actions: [],
        assertions: [
          { kind: 'text', selector: '#status', expected: 'Not saved' },
          { kind: 'count', selector: 'button', expected: '1' },
          { kind: 'attribute', selector: '#status', attribute: 'data-state', expected: 'ready' },
        ],
      },
    ],
    AbortSignal.timeout(20_000),
  )
  expect(report.issues).toEqual([])
  expect(report.valid).toBe(true)
  expect(report.checks.map((check) => check.passed)).toEqual([true, true])
}, 25_000)

it('rejects missing text and substring matches for non-text assertions', async () => {
  const report = await validateArtifact(
    html,
    [
      {
        name: 'missing text',
        actions: [{ kind: 'click', selector: '#save', value: null }],
        assertions: [{ kind: 'text', selector: '#status', expected: 'Deleted' }],
      },
      {
        name: 'value remains exact',
        actions: [{ kind: 'fill', selector: '#name', value: 'Ada Lovelace' }],
        assertions: [{ kind: 'value', selector: '#name', expected: 'Ada' }],
      },
      {
        name: 'attribute remains exact',
        actions: [],
        assertions: [
          { kind: 'attribute', selector: '#status', attribute: 'data-state', expected: 'read' },
        ],
      },
      {
        name: 'count remains exact',
        actions: [],
        assertions: [{ kind: 'count', selector: 'button', expected: '0' }],
      },
    ],
    AbortSignal.timeout(40_000),
  )
  expect(report.valid).toBe(false)
  expect(report.checks.map((check) => check.passed)).toEqual([false, false, false, false])
  expect(report.issues).toHaveLength(4)
}, 45_000)

it('shares the polling deadline without starving assertions after an incorrect expectation', async () => {
  const report = await validateArtifact(
    html,
    [
      {
        name: 'incorrect first expectation',
        actions: [
          { kind: 'fill', selector: '#name', value: 'Ada' },
          { kind: 'click', selector: '#save', value: null },
        ],
        assertion: { kind: 'text', selector: '#status', expected: 'Deleted' },
        assertions: [
          { kind: 'text', selector: '#status', expected: 'Saved Ada' },
          { kind: 'value', selector: '#name', expected: 'Ada' },
          { kind: 'attribute', selector: '#status', attribute: 'data-state', expected: 'ready' },
          { kind: 'count', selector: 'button', expected: '1' },
          { kind: 'no-horizontal-overflow', selector: 'body', expected: 'true' },
        ],
      },
      {
        name: 'multiple real failures share one deadline',
        actions: [],
        assertions: [
          { kind: 'text', selector: '#status', expected: 'Deleted' },
          { kind: 'value', selector: '#name', expected: 'Ada' },
          { kind: 'attribute', selector: '#status', attribute: 'data-state', expected: 'read' },
          { kind: 'text', selector: '#missing', expected: '' },
        ],
      },
    ],
    AbortSignal.timeout(20_000),
  )
  expect(report.valid).toBe(false)
  expect(report.checks.map((check) => check.passed)).toEqual([false, false])
  expect(report.checks[0]?.actual).toBe(
    '1: Saved Ada; 2: Saved Ada; 3: Ada; 4: ready; 5: 1; 6: true',
  )
  expect(report.issues.filter((issue) => issue.startsWith('incorrect first expectation'))).toEqual([
    'incorrect first expectation assertion 1 (text, #status): expected "Deleted", got "Saved Ada".',
  ])
  expect(report.issues).toHaveLength(5)
  expect(report.issues[4]).toContain('assertion 4 (text, #missing)')
}, 25_000)

it('keeps boolean attributes literal and checks enabled state through selectors', async () => {
  const report = await validateArtifact(
    `<!doctype html><html><body>
<button id="empty" disabled>Empty</button>
<button id="true" disabled="true">True</button>
<button id="false" disabled="false">False</button>
<button id="enabled" aria-disabled="false">Enabled</button>
</body></html>`,
    [
      {
        name: 'literal attributes and boolean presence',
        actions: [{ kind: 'click', selector: '#enabled', value: null }],
        assertions: [
          { kind: 'attribute', selector: '#empty', attribute: 'disabled', expected: '' },
          { kind: 'attribute', selector: '#true', attribute: 'disabled', expected: 'true' },
          { kind: 'attribute', selector: '#false', attribute: 'disabled', expected: 'false' },
          {
            kind: 'attribute',
            selector: '#enabled',
            attribute: 'aria-disabled',
            expected: 'false',
          },
          { kind: 'count', selector: 'button:disabled', expected: '3' },
          { kind: 'count', selector: '#enabled:not([disabled])', expected: '1' },
        ],
      },
      {
        name: 'absent does not mean literal false',
        actions: [],
        assertions: [
          { kind: 'attribute', selector: '#enabled', attribute: 'disabled', expected: 'false' },
          { kind: 'count', selector: '#enabled:enabled', expected: '1' },
        ],
      },
    ],
    AbortSignal.timeout(20_000),
  )
  expect(report.valid).toBe(false)
  expect(report.checks.map((check) => check.passed)).toEqual([true, false])
  expect(report.issues).toEqual([
    'absent does not mean literal false assertion 1 (attribute, #enabled): expected "false", got null.',
  ])
}, 25_000)

it('validates a targeted repair of SVG keyboard activation', async () => {
  const candidate = `<!doctype html><html><body>
<svg><g id="marker" tabindex="0" role="button"><circle cx="30" cy="30" r="20"/></g></svg>
<output id="status">0</output>
<script>
const marker = document.querySelector('#marker');
const status = document.querySelector('#status');
function activate() { status.textContent = Number(status.textContent) + 1; }
marker.addEventListener('click', activate);
marker.addEventListener('keydown', event => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    marker.click();
  }
});
</script></body></html>`
  const repaired = applyFileEdits(candidate, [
    { find: 'marker.click();', replacement: 'activate();' },
  ])
  const report = await validateArtifact(
    repaired,
    ['Enter', 'Space'].map((key) => ({
      name: `marker activation with ${key}`,
      actions: [{ kind: 'press' as const, selector: '#marker', value: key as 'Enter' | 'Space' }],
      assertions: [{ kind: 'text' as const, selector: '#status', expected: '1' }],
    })),
    AbortSignal.timeout(20_000),
  )
  expect(report.issues).toEqual([])
  expect(report.valid).toBe(true)
}, 25_000)
