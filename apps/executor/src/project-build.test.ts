import { createProjectSource, legacyProjectSource } from '@atoms-demo/core/project'
import { describe, expect, it } from 'vitest'
import { compileProject } from './project-build'
import { validateArtifact } from './validator'

const signal = () => new AbortController().signal

describe('project builds', () => {
  it('runs a React component imported from another TypeScript file', async () => {
    const source = createProjectSource('react-ts')
    source.files['src/App.tsx'] =
      "import Counter from './Counter'; export default function App() { return <main><Counter /></main> }"
    source.files['src/Counter.tsx'] = `import { useState } from 'react'
export default function Counter() {
  const [count, setCount] = useState(0)
  return <><output data-testid="count">{count}</output><button data-testid="increase" onClick={() => setCount(count + 1)}>Increase</button></>
}`
    const result = await compileProject(source, signal())
    const report = await validateArtifact(
      result.html,
      [
        {
          name: 'Initial state',
          actions: [],
          assertion: { selector: '[data-testid="count"]', kind: 'text', expected: '0' },
        },
        {
          name: 'State update',
          actions: [{ kind: 'click', selector: '[data-testid="increase"]', value: null }],
          assertion: { selector: '[data-testid="count"]', kind: 'text', expected: '1' },
        },
      ],
      signal(),
    )
    expect(report.issues).toEqual([])
    expect(report.valid).toBe(true)
  }, 60_000)

  it('runs Vanilla modules with linked CSS and a local SVG asset', async () => {
    const source = createProjectSource('vanilla')
    source.files['index.html'] =
      '<!doctype html><html><head><link rel="stylesheet" href="/src/styles.css"></head><body><div id="root"></div><img src="/assets/mark.svg" alt="Mark"><script type="module" src="/src/main.js"></script></body></html>'
    source.files['src/counter.js'] = 'export const next = (value) => value + 1'
    source.files['src/main.js'] = `import { next } from './counter.js'
const root = document.getElementById('root')
root.innerHTML = '<output data-testid="count">0</output><button data-testid="increase">Increase</button>'
const count = document.querySelector('[data-testid="count"]')
document.querySelector('button').addEventListener('click', () => { count.textContent = String(next(Number(count.textContent))) })`
    source.files['assets/mark.svg'] =
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>'
    const result = await compileProject(source, signal())
    const report = await validateArtifact(
      result.html,
      [
        {
          name: 'Initial state',
          actions: [],
          assertion: { selector: '[data-testid="count"]', kind: 'text', expected: '0' },
        },
        {
          name: 'Module behavior',
          actions: [{ kind: 'click', selector: '[data-testid="increase"]', value: null }],
          assertion: { selector: '[data-testid="count"]', kind: 'text', expected: '1' },
        },
      ],
      signal(),
    )
    expect(report.issues).toEqual([])
    expect(report.valid).toBe(true)
    expect(result.html).toContain('data:image/svg+xml;base64,')
  }, 60_000)

  it.each(['node:fs', '/etc/private.js', '../../outside.js', 'https://example.com/module.js'])(
    'rejects imports outside the virtual project and template dependencies: %s',
    async (path) => {
      const source = createProjectSource('vanilla')
      source.files['src/main.js'] = `import ${JSON.stringify(path)}`
      await expect(compileProject(source, signal())).rejects.toThrow()
    },
  )

  it('returns a build failure for broken modules rather than a stale preview', async () => {
    const source = createProjectSource('vanilla')
    source.files['src/main.js'] = 'const missing = ;'
    await expect(compileProject(source, signal())).rejects.toThrow()
  })

  it('honors cancellation before any compilation', async () => {
    const controller = new AbortController()
    const reason = new Error('Cancelled by owner')
    controller.abort(reason)
    await expect(compileProject(createProjectSource('vanilla'), controller.signal)).rejects.toBe(
      reason,
    )
  })

  it('keeps migrated inline HTML executable when rebuilding its source snapshot', async () => {
    const source = legacyProjectSource(
      '<!doctype html><html><body><output>0</output><button>Increase</button><script>document.querySelector("button").onclick=()=>document.querySelector("output").textContent="1"</script></body></html>',
    )
    const { html } = await compileProject(source, signal())
    const report = await validateArtifact(
      html,
      [
        {
          name: 'Initial state',
          actions: [],
          assertion: { selector: 'output', kind: 'text', expected: '0' },
        },
        {
          name: 'Preserved interaction',
          actions: [{ kind: 'click', selector: 'button', value: null }],
          assertion: { selector: 'output', kind: 'text', expected: '1' },
        },
      ],
      signal(),
    )
    expect(report.issues).toEqual([])
    expect(report.valid).toBe(true)
  }, 60_000)
})
