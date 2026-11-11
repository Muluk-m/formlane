import { expect, it } from 'vitest'
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
