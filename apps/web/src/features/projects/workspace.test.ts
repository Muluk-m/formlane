import type { RunEvent } from '@atoms-demo/contracts'
import { createProjectSource } from '@atoms-demo/core/project'
import { describe, expect, it } from 'vitest'
import { projectWorkspace, reduceProjectEvent } from './workspace'

function event(type: string, data: RunEvent['data']): RunEvent {
  return { runId: '00000000-0000-4000-8000-000000000001', sequence: 1, createdAt: 1, type, data }
}

describe('project source observation', () => {
  it('keeps streamed replacements separate from saved source until canonical reconciliation', () => {
    const saved = createProjectSource('react-ts')
    const original = saved.files['src/App.tsx']
    let state = projectWorkspace(saved)
    state = reduceProjectEvent(state, event('file_start', { path: 'src/App.tsx' }))
    state = reduceProjectEvent(
      state,
      event('file_delta', { path: 'src/App.tsx', text: 'export default ' }),
    )
    state = reduceProjectEvent(
      state,
      event('file_delta', { path: 'src/App.tsx', text: 'function App() {}' }),
    )
    expect(state.drafts['src/App.tsx']).toBe('export default function App() {}')
    expect(state.source?.files['src/App.tsx']).toBe(original)
    expect(state.activePath).toBe('src/App.tsx')
    const canonical = 'export default function App() { return <main>Saved</main> }'
    state = reduceProjectEvent(
      state,
      event('file_saved', { path: 'src/App.tsx', content: canonical }),
    )
    expect(state.source?.files['src/App.tsx']).toBe(canonical)
    expect(state.source?.files['src/styles.css']).toBe(saved.files['src/styles.css'])
    expect(state.drafts).toEqual({})
    expect(state.activePath).toBeNull()
    expect(saved.files['src/App.tsx']).toBe(original)
    expect(state.dirty).toBe(true)
  })

  it('replaces incomplete attempts on reset and retains the template file tree', () => {
    const source = createProjectSource('vanilla')
    let state = reduceProjectEvent(
      projectWorkspace(null),
      event('project_initialized', { source, reason: 'Small static app' }),
    )
    state = reduceProjectEvent(state, event('file_start', { path: 'src/main.js' }))
    state = reduceProjectEvent(state, event('file_delta', { path: 'src/main.js', text: 'partial' }))
    state = reduceProjectEvent(state, event('project_reset', { source }))
    expect(state.source).toEqual(source)
    expect(state.drafts).toEqual({})
    expect(state.activePath).toBeNull()
    expect(reduceProjectEvent(state, event('project_reset', { source: null }))).toEqual(
      projectWorkspace(null),
    )
  })

  it('records build errors without changing the saved source and invalidates stale success on mutation', () => {
    const saved = createProjectSource('react-ts')
    let state = reduceProjectEvent(
      projectWorkspace(saved),
      event('build_result', { ok: true, issues: [], sourceHash: 'built-source' }),
    )
    expect(state.build?.ok).toBe(true)
    state = reduceProjectEvent(
      state,
      event('file_saved', { path: 'src/App.tsx', content: 'export default <' }),
    )
    expect(state.build).toBeNull()
    state = reduceProjectEvent(
      state,
      event('build_result', { ok: false, issues: ['Unexpected end of file'] }),
    )
    expect(state.build).toEqual({ ok: false, issues: ['Unexpected end of file'] })
    expect(saved.files['src/App.tsx']).not.toBe('export default <')
    for (const status of ['failed', 'cancelled']) {
      expect(reduceProjectEvent(state, event('run_state', { status }))).toBe(state)
    }
  })

  it('removes deleted files and their partial drafts without mutating the saved snapshot', () => {
    const saved = createProjectSource('vanilla')
    let state = reduceProjectEvent(
      projectWorkspace(saved),
      event('file_saved', { path: 'src/extra.js', content: 'export const value = 1' }),
    )
    state = reduceProjectEvent(state, event('file_start', { path: 'src/extra.js' }))
    state = reduceProjectEvent(state, event('file_deleted', { path: 'src/extra.js' }))
    expect(state.source?.files).not.toHaveProperty('src/extra.js')
    expect(state.drafts).toEqual({})
    expect(state.activePath).toBeNull()
    expect(saved).toEqual(createProjectSource('vanilla'))
  })

  it('ignores malformed source, unsafe paths and orphan deltas', () => {
    const state = projectWorkspace(createProjectSource('vanilla'))
    expect(
      reduceProjectEvent(
        state,
        event('project_reset', { source: { template: 'react-ts', files: {} } }),
      ),
    ).toBe(state)
    expect(reduceProjectEvent(state, event('file_start', { path: '../private.txt' }))).toBe(state)
    expect(
      reduceProjectEvent(state, event('file_delta', { path: 'src/main.js', text: 'orphan' })),
    ).toBe(state)
    expect(
      reduceProjectEvent(
        projectWorkspace(null),
        event('file_saved', { path: 'index.html', content: '<html>' }),
      ).source,
    ).toBeNull()
  })
})
