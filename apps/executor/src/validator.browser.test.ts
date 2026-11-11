import { expect, it } from 'vitest'
import { applyArtifactEdits } from './agents'
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
  const repaired = applyArtifactEdits(candidate, [
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
