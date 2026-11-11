export type ProjectTemplateId = 'vanilla' | 'react-ts'

export interface ProjectSource {
  template: ProjectTemplateId
  files: Record<string, string>
}

export const MAX_PROJECT_FILES = 64
export const MAX_SOURCE_BYTES = 256 * 1024
export const MAX_FILE_CHARACTERS = 180000
export const MAX_PREVIEW_BYTES = 512 * 1024

const encoder = new TextEncoder()
const extensions = /\.(?:html|css|js|jsx|ts|tsx|json|svg|md|txt)$/i

export function isProjectPath(path: string): boolean {
  return (
    path.length > 0 &&
    path.length <= 180 &&
    extensions.test(path) &&
    path
      .split('/')
      .every(
        (part) =>
          /^[a-zA-Z0-9_-][a-zA-Z0-9._-]*$/.test(part) &&
          part !== '__proto__' &&
          part !== 'constructor' &&
          part !== 'prototype',
      )
  )
}

/** Project dependencies and scripts are template-owned, never executed from model output. */
export function projectPackageJson(template: ProjectTemplateId): string {
  return `${JSON.stringify(
    {
      name: 'generated-app',
      version: '1.0.0',
      private: true,
      type: 'module',
      scripts: {
        dev: 'vite --host 127.0.0.1',
        build: 'vite build',
        preview: 'vite preview --host 127.0.0.1',
        ...(template === 'react-ts' ? { typecheck: 'tsc --noEmit' } : {}),
      },
      ...(template === 'react-ts'
        ? { dependencies: { react: '19.3.1', 'react-dom': '19.3.1' } }
        : {}),
      devDependencies: {
        vite: '8.3.7',
        ...(template === 'react-ts'
          ? { typescript: '6.0.3', '@types/react': '19.3.0', '@types/react-dom': '19.3.0' }
          : {}),
      },
    },
    null,
    2,
  )}\n`
}

export function createProjectSource(template: ProjectTemplateId): ProjectSource {
  const react = template === 'react-ts'
  const source: ProjectSource = {
    template,
    files: {
      'package.json': projectPackageJson(template),
      'index.html': `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Application</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.${react ? 'tsx' : 'js'}"></script>
  </body>
</html>
`,
      'src/styles.css': `:root { font-family: system-ui, sans-serif; color: #171717; background: #fff; }
* { box-sizing: border-box; }
body { margin: 0; }
main { max-width: 64rem; margin: 0 auto; padding: 2rem; }
button, input, select, textarea { font: inherit; }
button { cursor: pointer; }
:focus-visible { outline: 2px solid #0284c7; outline-offset: 3px; }
`,
    },
  }
  if (react) {
    source.files['src/main.tsx'] = `import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('Application root is missing.')
createRoot(root).render(<App />)
`
    source.files['src/App.tsx'] = `export default function App() {
  return <main><h1>Application</h1></main>
}
`
    source.files['tsconfig.json'] = `${JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          lib: ['ES2022', 'DOM', 'DOM.Iterable'],
          module: 'ESNext',
          moduleResolution: 'Bundler',
          jsx: 'react-jsx',
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          resolveJsonModule: true,
          isolatedModules: true,
          types: ['vite/client'],
        },
        include: ['src'],
      },
      null,
      2,
    )}\n`
  } else {
    source.files['src/main.js'] = `import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('Application root is missing.')
const heading = document.createElement('h1')
heading.textContent = 'Application'
const main = document.createElement('main')
main.append(heading)
root.append(main)
`
  }
  return source
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b, 'en'))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

export function validateProjectSource(source: ProjectSource): void {
  if (source.template !== 'vanilla' && source.template !== 'react-ts')
    throw new Error('Unknown project template.')
  const entries = Object.entries(source.files)
  if (!entries.length || entries.length > MAX_PROJECT_FILES)
    throw new Error(`A project must contain 1–${MAX_PROJECT_FILES} files.`)
  let bytes = 0
  const paths = new Set<string>()
  for (const [path, content] of entries) {
    if (!isProjectPath(path)) throw new Error(`Unsupported project path: ${path}`)
    const key = path.toLowerCase()
    if (paths.has(key)) throw new Error(`Project paths differ only by case: ${path}`)
    paths.add(key)
    if (content.length > MAX_FILE_CHARACTERS) throw new Error(`File is too large: ${path}`)
    bytes += encoder.encode(content).byteLength
  }
  for (const path of paths) {
    let separator = path.indexOf('/')
    while (separator !== -1) {
      if (paths.has(path.slice(0, separator)))
        throw new Error(`Project path is both a file and a directory: ${path}`)
      separator = path.indexOf('/', separator + 1)
    }
  }
  if (bytes > MAX_SOURCE_BYTES) throw new Error('Project source exceeds the 256 KiB limit.')
  if (!source.files['index.html']?.trim()) throw new Error('Project index.html is required.')
  try {
    if (
      canonical(JSON.parse(source.files['package.json'] ?? '')) !==
      canonical(JSON.parse(projectPackageJson(source.template)))
    )
      throw new Error('Manifest differs from the template.')
  } catch {
    throw new Error('package.json dependencies and scripts are owned by the selected template.')
  }
}

export async function projectSourceHash(source: ProjectSource): Promise<string> {
  validateProjectSource(source)
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(canonical(source)))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Explicit migration/fixture helper. Saved HTML is retained byte-for-byte. */
export function legacyProjectSource(html: string): ProjectSource {
  return {
    template: 'vanilla',
    files: { 'package.json': projectPackageJson('vanilla'), 'index.html': html },
  }
}
