import { describe, expect, it } from 'vitest'
import {
  createProjectSource,
  isProjectPath,
  projectSourceHash,
  validateProjectSource,
} from './project'

describe('project source invariants', () => {
  it('hashes complete source independently of file insertion order', async () => {
    const source = createProjectSource('react-ts')
    const reordered = {
      ...source,
      files: Object.fromEntries(Object.entries(source.files).reverse()),
    }
    expect(await projectSourceHash(reordered)).toBe(await projectSourceHash(source))
    reordered.files['src/App.tsx'] = 'export default function App() { return <h1>Changed</h1> }'
    expect(await projectSourceHash(reordered)).not.toBe(await projectSourceHash(source))
  })

  it.each([
    '../secret.ts',
    '/etc/passwd.txt',
    'src/../../secret.ts',
    'src\\outside.ts',
    '.env',
    'src/__proto__/a.js',
  ])('rejects unsafe source paths: %s', (path) => {
    const source = createProjectSource('vanilla')
    source.files[path] = 'private'
    expect(isProjectPath(path)).toBe(false)
    expect(() => validateProjectSource(source)).toThrow()
  })

  it('rejects source snapshots that alias files on case-insensitive filesystems', () => {
    const source = createProjectSource('react-ts')
    source.files['src/app.tsx'] = 'export default () => null'
    expect(() => validateProjectSource(source)).toThrow()
  })

  it('rejects snapshots that cannot be extracted as a filesystem tree', () => {
    const source = createProjectSource('vanilla')
    source.files['asset.svg'] = '<svg />'
    source.files['asset.svg/child.svg'] = '<svg />'
    expect(() => validateProjectSource(source)).toThrow()
  })

  it('applies the source budget to UTF-8 bytes rather than JavaScript character count', () => {
    const source = createProjectSource('vanilla')
    source.files['src/main.js'] = `// ${'中'.repeat(90_000)}`
    expect(() => validateProjectSource(source)).toThrow()
  })

  it('rejects lifecycle scripts and dependencies that are not owned by the template', () => {
    const source = createProjectSource('vanilla')
    const manifest = JSON.parse(source.files['package.json'] ?? '{}')
    manifest.scripts.postinstall = 'node payload.js'
    source.files['package.json'] = JSON.stringify(manifest)
    expect(() => validateProjectSource(source)).toThrow()
  })
})
