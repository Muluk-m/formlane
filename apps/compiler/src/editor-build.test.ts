import { createHash } from 'node:crypto'
import { createProjectSource, legacyProjectSource } from '@atoms-demo/core/project'
import { SELECTION_SOURCE_ATTRIBUTE } from '@atoms-demo/core/selection'
import { type DefaultTreeAdapterTypes, parse } from 'parse5'
import { describe, expect, it } from 'vitest'
import { compileEditorProject, compileProject } from './project-build'

type Element = DefaultTreeAdapterTypes.Element
const signal = () => new AbortController().signal
const hash = (html: string) => createHash('sha256').update(html).digest('hex')

function elements(html: string): Element[] {
  const result: Element[] = []
  const visit = (node: DefaultTreeAdapterTypes.Node) => {
    if ('tagName' in node) result.push(node)
    if ('childNodes' in node) node.childNodes.forEach(visit)
    if ('content' in node) visit(node.content)
  }
  visit(parse(html))
  return result
}

function sourceId(element: Element | undefined): string | undefined {
  return element?.attrs.find((attribute) => attribute.name === SELECTION_SOURCE_ATTRIBUTE)?.value
}

describe('editor compiler source attribution', () => {
  it('maps static HTML to immutable original ranges without changing the canonical artifact', async () => {
    const source = legacyProjectSource(
      '<!doctype html>\n<html><head><title>Example</title></head>\n<body>\n<h1>Hello</h1>\n</body></html>',
    )
    const original = structuredClone(source)
    const canonical = await compileProject(source, signal())
    const editor = await compileEditorProject(source, signal())
    const headingId = sourceId(elements(editor.editorHtml).find((node) => node.tagName === 'h1'))
    expect(headingId).toBeTruthy()
    expect(editor.manifest.entries[headingId ?? '']).toEqual({
      path: 'index.html', startLine: 4, startColumn: 1, endLine: 4, endColumn: 15, tagName: 'h1',
    })
    expect(editor.html).toBe(canonical.html)
    expect(editor.sourceHash).toBe(canonical.sourceHash)
    expect(editor.manifest.sourceHash).toBe(canonical.sourceHash)
    expect(editor.manifest.canonicalArtifactHash).toBe(hash(canonical.html))
    expect(editor.manifest.editorArtifactHash).toBe(hash(editor.editorHtml))
    expect(editor.html).not.toContain(SELECTION_SOURCE_ATTRIBUTE)
    expect(source).toEqual(original)
  })

  it('maps SVG, template content, void tags and non-ASCII positions without inventing implicit nodes', async () => {
    const source = legacyProjectSource(
      '<!doctype html>\n<p>😀<img alt="x"></p>\n<svg><circle r="2"/></svg>\n<template><button>Clone</button></template>',
    )
    const editor = await compileEditorProject(source, signal())
    const nodes = elements(editor.editorHtml)
    expect(sourceId(nodes.find((node) => node.tagName === 'body'))).toBeUndefined()
    for (const tagName of ['p', 'img', 'svg', 'circle', 'template', 'button']) {
      const id = sourceId(nodes.find((node) => node.tagName === tagName))
      expect(editor.manifest.entries[id ?? '']?.tagName).toBe(tagName)
    }
    const image = sourceId(nodes.find((node) => node.tagName === 'img'))
    expect(editor.manifest.entries[image ?? '']).toMatchObject({
      path: 'index.html', startLine: 2, startColumn: 6, endLine: 2, endColumn: 19,
    })
  })

  it('reproduces editor identity for one source snapshot and rotates IDs when the source changes', async () => {
    const source = legacyProjectSource('<h1>Private path stays in the manifest</h1>')
    const first = await compileEditorProject(source, signal())
    const second = await compileEditorProject(source, signal())
    expect(first.sourceHash).toBe(second.sourceHash)
    expect(first.html).toBe(second.html)
    expect(first.manifest.canonicalArtifactHash).toBe(second.manifest.canonicalArtifactHash)
    expect(first.editorHtml).toBe(second.editorHtml)
    expect(first.manifest).toEqual(second.manifest)
    source.files['index.html'] += '<p>A new source snapshot</p>'
    const changed = await compileEditorProject(source, signal())
    expect(Object.keys(first.manifest.entries).some((id) => id in changed.manifest.entries)).toBe(false)
    expect(first.editorHtml).not.toContain('index.html')
  })

  it('maps intrinsic JSX definitions once and leaves component invocations and dynamic DOM unmapped', async () => {
    const source = createProjectSource('react-ts')
    source.files['src/App.tsx'] = `import { createElement } from 'react'
function Card() { return <button>Repeated</button> }
export default function App() {
  return <main><Card /><Card />{createElement('aside', null, 'Dynamic')}</main>
}
`
    const editor = await compileEditorProject(source, signal())
    const entries = Object.values(editor.manifest.entries)
      .filter((entry) => entry.path === 'src/App.tsx')
      .sort((left, right) => left.startLine - right.startLine)
    expect(entries).toEqual([
      { path: 'src/App.tsx', startLine: 2, startColumn: 26, endLine: 2, endColumn: 51, tagName: 'button' },
      { path: 'src/App.tsx', startLine: 4, startColumn: 10, endLine: 4, endColumn: 80, tagName: 'main' },
    ])
    expect(Object.values(editor.manifest.entries).some((entry) => entry.tagName === 'aside')).toBe(false)
    expect(editor.html).not.toContain(SELECTION_SOURCE_ATTRIBUTE)
  })

  it('retains original CRLF and multiline JSX ranges, including intrinsic elements inside expressions', async () => {
    const source = createProjectSource('react-ts')
    source.files['src/App.tsx'] = [
      'export default function App() {',
      '  return <main>',
      '    {[1, 2].map(n => <button',
      '      key={n}>Row {n}</button>)}',
      '  </main>',
      '}',
    ].join('\r\n')
    const editor = await compileEditorProject(source, signal())
    expect(Object.values(editor.manifest.entries).find((entry) => entry.tagName === 'button')).toEqual({
      path: 'src/App.tsx', startLine: 3, startColumn: 22, endLine: 4, endColumn: 31, tagName: 'button',
    })
  })

  it('preserves reserved HTML attributes and never treats their values as compiler authority', async () => {
    const source = legacyProjectSource('<div DATA-FORMLANE-SOURCE="spoofed"><h1>Safe</h1></div>')
    const editor = await compileEditorProject(source, signal())
    expect(sourceId(elements(editor.editorHtml).find((node) => node.tagName === 'div'))).toBe('spoofed')
    expect(editor.manifest.entries.spoofed).toBeUndefined()
    expect(editor.diagnostics).toContainEqual(expect.objectContaining({ code: 'reserved-marker', path: 'index.html' }))
  })

  it('preserves JSX attributes and spreads without overriding their application semantics', async () => {
    const source = createProjectSource('react-ts')
    source.files['src/App.tsx'] = `const props = { 'data-formlane-source': 'from-spread' }
export default function App() {
  return <main><button {...props}>Spread</button><button data-formlane-source="owned">Owned</button><span>Mapped</span></main>
}`
    const editor = await compileEditorProject(source, signal())
    const entries = Object.values(editor.manifest.entries)
    expect(entries.some((entry) => entry.tagName === 'button')).toBe(false)
    expect(entries.some((entry) => entry.tagName === 'span')).toBe(true)
    expect(editor.manifest.entries['from-spread']).toBeUndefined()
    expect(editor.manifest.entries.owned).toBeUndefined()
    expect(editor.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining(['jsx-spread', 'reserved-marker']))
  })

  it('does not transform raw imports or turn JavaScript-created markup into exact mappings', async () => {
    const source = createProjectSource('vanilla')
    source.files['src/main.js'] = `import markup from './content.jsx?raw'
document.getElementById('root').innerHTML = markup
const node = document.createElement('button'); node.textContent = 'Dynamic'; document.body.append(node)`
    source.files['src/content.jsx'] = '<section>Runtime text</section>'
    const editor = await compileEditorProject(source, signal())
    expect(Object.values(editor.manifest.entries).every((entry) => entry.path === 'index.html')).toBe(true)
  })

  it('does not execute configuration or application code on the compiler host', async () => {
    const source = createProjectSource('react-ts')
    source.files['vite.config.ts'] = 'throw new Error("configuration ran on compiler host")'
    source.files['src/App.tsx'] = 'throw new Error("application ran on compiler host"); export default () => <h1>Safe</h1>'
    const editor = await compileEditorProject(source, signal())
    expect(Object.values(editor.manifest.entries).some((entry) => entry.tagName === 'h1')).toBe(true)
    expect(Object.values(editor.manifest.entries).some((entry) => entry.path === 'vite.config.ts')).toBe(false)
  })

  it('falls back explicitly to canonical selection when annotation exceeds the manifest budget', async () => {
    const source = legacyProjectSource(`<main>${'<i></i>'.repeat(5000)}</main>`)
    const editor = await compileEditorProject(source, signal())
    expect(editor.editorHtml).toBe(editor.html)
    expect(editor.manifest.entries).toEqual({})
    expect(editor.diagnostics).toEqual([{ code: 'instrumentation-limit' }])
  })

  it('retains canonical selection when JSX attribution exceeds its budget inside the bundler', async () => {
    const source = createProjectSource('react-ts')
    source.files['src/App.tsx'] = `export default () => <main>${'<i />'.repeat(5000)}</main>`
    const editor = await compileEditorProject(source, signal())
    expect(editor.editorHtml).toBe(editor.html)
    expect(editor.manifest.entries).toEqual({})
    expect(editor.diagnostics).toEqual([{ code: 'instrumentation-limit' }])
  })

  it('honors cancellation and rejects invalid canonical sources before editor instrumentation', async () => {
    const controller = new AbortController()
    controller.abort(new Error('Cancelled editor build'))
    await expect(compileEditorProject(createProjectSource('react-ts'), controller.signal)).rejects.toThrow('Cancelled editor build')
    const source = createProjectSource('react-ts')
    source.files['src/App.tsx'] = 'export default () => <main>'
    await expect(compileEditorProject(source, signal())).rejects.toThrow()
  })
})
