import {
  createProjectSource,
  legacyProjectSource,
  projectSourceHash,
} from '@atoms-demo/core/project'
import { describe, expect, it } from 'vitest'
import { compileProject } from './project-build'

const signal = () => new AbortController().signal

describe('restricted virtual project compiler', () => {
  it.each(['vanilla', 'react-ts'] as const)(
    'compiles %s with a canonical source hash',
    async (template) => {
      const source = createProjectSource(template)
      const result = await compileProject(source, signal())
      expect(result.sourceHash).toBe(await projectSourceHash(source))
      expect(result.html).toMatch(/^<!DOCTYPE html>/i)
      expect(result.html).toContain('<script>')
      expect(result.html).not.toContain('src="/src/main.')
    },
  )

  it('bundles linked CSS, inline modules, SVG assets and text imports', async () => {
    const source = createProjectSource('vanilla')
    source.files['index.html'] =
      '<!doctype html><html><head><link rel="stylesheet" href="/src/styles.css"><style>button{color:red}</style></head><body><img src="/mark.svg"><script type="module">import text from "./message.txt?raw";document.body.append(text)</script></body></html>'
    source.files['mark.svg'] = '<svg xmlns="http://www.w3.org/2000/svg"/>'
    source.files['message.txt'] = 'literal message'
    const result = await compileProject(source, signal())
    expect(result.html).toContain('data:image/svg+xml;base64,')
    expect(result.html).toContain('literal message')
    expect(result.html).toContain('<style>')
    expect(result.html).not.toContain('rel="stylesheet"')
  })

  it.each([
    'node:fs',
    '/etc/private.js',
    '../../outside.js',
    'https://example.com/module.js',
    '//example.com/module.js',
    './main.js?unsafe',
    './%2e%2e/secret.js',
    'unlisted-library',
  ])('rejects imports outside the virtual source: %s', async (specifier) => {
    const source = createProjectSource('vanilla')
    source.files['src/main.js'] = `import ${JSON.stringify(specifier)}`
    await expect(compileProject(source, signal())).rejects.toThrow()
  })

  it('does not enable React dependencies in the Vanilla template', async () => {
    const source = createProjectSource('vanilla')
    source.files['src/main.js'] = "import React from 'react';console.log(React)"
    await expect(compileProject(source, signal())).rejects.toThrow('React imports require')
  })

  it.each([
    '<base href="https://example.com">',
    '<script src="/src/main.js"></script>',
    '<script type="module" src="https://example.com/evil.js"></script>',
  ])('rejects unsafe entry markup: %s', async (markup) => {
    const source = createProjectSource('vanilla')
    source.files['index.html'] = `<!doctype html><html><head>${markup}</head><body></body></html>`
    await expect(compileProject(source, signal())).rejects.toThrow()
  })

  it('ignores generated configuration and preserves legacy inline scripts', async () => {
    const source = legacyProjectSource(
      '<!doctype html><html><body><script>window.counter=1</script></body></html>',
    )
    source.files['vite.config.js'] = 'throw new Error("generated config executed")'
    source.files['tsconfig.json'] = '{"extends":"/etc/private.json"}'
    const result = await compileProject(source, signal())
    expect(result.html).toContain('window.counter=1')
  })

  it('does not run generated plugins, scripts or lifecycle hooks', async () => {
    const source = createProjectSource('vanilla')
    const manifest = JSON.parse(source.files['package.json'] ?? '{}')
    manifest.scripts.postinstall = 'node injected.js'
    source.files['package.json'] = JSON.stringify(manifest)
    await expect(compileProject(source, signal())).rejects.toThrow('owned by the selected template')
  })

  it('fails broken modules instead of returning partial output', async () => {
    const source = createProjectSource('vanilla')
    source.files['src/main.js'] = 'const invalid = ;'
    await expect(compileProject(source, signal())).rejects.toThrow()
  })

  it('honors cancellation before and during compilation', async () => {
    const cancelled = new AbortController()
    const reason = new Error('Cancelled by owner')
    cancelled.abort(reason)
    await expect(compileProject(createProjectSource('vanilla'), cancelled.signal)).rejects.toBe(
      reason,
    )
    const active = new AbortController()
    const pending = compileProject(createProjectSource('react-ts'), active.signal)
    active.abort(reason)
    await expect(pending).rejects.toBe(reason)
  })
})
