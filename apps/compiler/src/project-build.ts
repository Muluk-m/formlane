import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { posix } from 'node:path'
import {
  isProjectPath,
  MAX_PREVIEW_BYTES,
  type ProjectSource,
  projectSourceHash,
  validateProjectSource,
} from '@atoms-demo/core/project'
import type { SelectionSourceManifest } from '@atoms-demo/core/selection'
import { context, type Loader, type Plugin } from 'esbuild'
import { type DefaultTreeAdapterTypes, parse, parseFragment, serialize } from 'parse5'
import {
  type EditorBuildDiagnostic,
  INSTRUMENTATION_VERSION,
  InstrumentationLimitError,
  SourceAttribution,
} from './source-attribution'

type Node = DefaultTreeAdapterTypes.Node
type Element = DefaultTreeAdapterTypes.Element
type VirtualFile = { content: string; loader: Loader }
const require = createRequire(import.meta.url)
const reactImports = new Set([
  'react',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  'react-dom',
  'react-dom/client',
])
const extensions = [
  '',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.json',
  '/index.ts',
  '/index.tsx',
  '/index.js',
  '/index.jsx',
]
const loaders: Record<string, Loader> = {
  '.js': 'js',
  '.jsx': 'jsx',
  '.ts': 'ts',
  '.tsx': 'tsx',
  '.css': 'css',
  '.json': 'json',
  '.svg': 'dataurl',
  '.txt': 'text',
  '.md': 'text',
}

function walk(node: Node, visit: (element: Element) => void): void {
  if ('tagName' in node) visit(node)
  if ('childNodes' in node) {
    for (const child of [...node.childNodes]) walk(child, visit)
  }
}

function attribute(node: Element, name: string): string | undefined {
  return node.attrs.find((item) => item.name === name)?.value
}

function remove(node: Element): void {
  if (node.parentNode)
    node.parentNode.childNodes = node.parentNode.childNodes.filter((child) => child !== node)
}

function text(node: Element): string {
  return node.childNodes.map((child) => ('value' in child ? child.value : '')).join('')
}

function appendHtml(parent: Element, html: string): void {
  const fragment = parseFragment(html)
  for (const child of fragment.childNodes) {
    child.parentNode = parent
    parent.childNodes.push(child)
  }
}

function localPath(specifier: string, importer = 'index.html'): string {
  if (/^[a-z][a-z\d+.-]*:|^\/\//i.test(specifier) || /[\\\0%?#]/.test(specifier))
    throw new Error(`Only local project paths are supported: ${specifier}`)
  const path = specifier.startsWith('/')
    ? posix.normalize(specifier.slice(1))
    : posix.normalize(
        posix.join(importer.startsWith('formlane:') ? '' : posix.dirname(importer), specifier),
      )
  if (path === '..' || path.startsWith('../'))
    throw new Error(`Import leaves the project: ${specifier}`)
  return path
}

function resolveFile(source: ProjectSource, specifier: string, importer?: string): string {
  const path = localPath(specifier, importer)
  for (const extension of extensions) {
    const candidate = `${path}${extension}`
    if (isProjectPath(candidate) && Object.hasOwn(source.files, candidate)) return candidate
  }
  throw new Error(`Project file not found: ${specifier}${importer ? ` (from ${importer})` : ''}`)
}

export interface EditorProjectBuild {
  /** Canonical publication/download artifact, identical to compileProject. */
  html: string
  sourceHash: string
  /** Private editor preview; a runtime bridge is injected separately by the host. */
  editorHtml: string
  manifest: SelectionSourceManifest
  diagnostics: EditorBuildDiagnostic[]
}

/** Build-local attribution never changes the canonical artifact or original source. */
export async function compileEditorProject(
  source: ProjectSource,
  signal: AbortSignal,
): Promise<EditorProjectBuild> {
  const canonical = await compileProject(source, signal)
  const attribution = new SourceAttribution(signal, canonical.sourceHash)
  let editorHtml: string
  let entries: SelectionSourceManifest['entries']
  let diagnostics: EditorBuildDiagnostic[]
  try {
    editorHtml = (await compile(source, signal, attribution, canonical.sourceHash)).html
    entries = Object.fromEntries(
      Object.entries(attribution.entries).sort(([left], [right]) => left.localeCompare(right)),
    )
    diagnostics = attribution.diagnostics.sort((left, right) =>
      (left.path ?? '').localeCompare(right.path ?? '') ||
      (left.startLine ?? 0) - (right.startLine ?? 0) ||
      (left.startColumn ?? 0) - (right.startColumn ?? 0) ||
      left.code.localeCompare(right.code),
    )
  } catch (error) {
    signal.throwIfAborted()
    if (!(error instanceof InstrumentationLimitError) && !attribution.limitExceeded) throw error
    // Explicit reduced-confidence selection retains valid canonical behavior when
    // annotations cannot fit the bounded private preview/manifest contract.
    editorHtml = canonical.html
    entries = {}
    diagnostics = [{ code: 'instrumentation-limit' }]
  }
  return {
    ...canonical,
    editorHtml,
    manifest: {
      instrumentationVersion: INSTRUMENTATION_VERSION,
      sourceHash: canonical.sourceHash,
      canonicalArtifactHash: createHash('sha256').update(canonical.html).digest('hex'),
      editorArtifactHash: createHash('sha256').update(editorHtml).digest('hex'),
      entries,
    },
    diagnostics,
  }
}

/**
 * Compile a virtual source tree. Model files are parser inputs, never host modules,
 * build plugins, package scripts, or configuration executed by Node.
 */
export async function compileProject(
  source: ProjectSource,
  signal: AbortSignal,
): Promise<{ html: string; sourceHash: string }> {
  return compile(source, signal)
}

async function compile(
  source: ProjectSource,
  signal: AbortSignal,
  attribution?: SourceAttribution,
  canonicalSourceHash?: string,
): Promise<{ html: string; sourceHash: string }> {
  signal.throwIfAborted()
  validateProjectSource(source)
  const sourceHash = canonicalSourceHash ?? (await projectSourceHash(source))
  const document = parse(source.files['index.html'] ?? '', { sourceCodeLocationInfo: !!attribution })
  attribution?.html(document)
  const virtual = new Map<string, VirtualFile>()
  const imports: string[] = []
  let head: Element | undefined
  let body: Element | undefined
  let inline = 0
  const importFile = (path: string) => imports.push(`import ${JSON.stringify(path)};`)
  const inlineFile = (content: string, loader: Loader) => {
    const path = `formlane:inline-${inline++}.${loader}`
    virtual.set(path, { content, loader })
    importFile(path)
  }
  walk(document, (node) => {
    if (node.tagName === 'head') head = node
    if (node.tagName === 'body') body = node
    if (node.tagName === 'base') throw new Error('Project entry HTML cannot change its base URL.')
    if (node.tagName === 'script') {
      const src = attribute(node, 'src')
      const module = attribute(node, 'type')?.toLowerCase() === 'module'
      if (src && !module)
        throw new Error('Local script files must use type="module" and module imports.')
      if (module) {
        if (src) importFile(`/${resolveFile(source, src)}`)
        else inlineFile(text(node), 'js')
        remove(node)
      }
    }
    if (node.tagName === 'style') {
      inlineFile(text(node), 'css')
      remove(node)
    }
    if (node.tagName === 'link') {
      const rel = attribute(node, 'rel')?.toLowerCase()
      const href = attribute(node, 'href')
      if (rel === 'stylesheet' && href) {
        importFile(`/${resolveFile(source, href)}`)
        remove(node)
        return
      }
    }
    for (const name of node.tagName === 'img' ? ['src'] : node.tagName === 'link' ? ['href'] : []) {
      const item = node.attrs.find((entry) => entry.name === name)
      if (!item || item.value.startsWith('data:') || item.value.startsWith('#')) continue
      const path = resolveFile(source, item.value)
      if (!path.endsWith('.svg')) throw new Error(`Only SVG image assets are supported: ${path}`)
      item.value = `data:image/svg+xml;base64,${Buffer.from(source.files[path] ?? '').toString('base64')}`
    }
  })
  if (!head || !body) throw new Error('Project entry HTML is missing its document structure.')
  if (imports.length) {
    virtual.set('formlane:entry', { content: imports.join('\n'), loader: 'js' })
    const projectPlugin: Plugin = {
      name: 'project-files',
      setup(build) {
        build.onResolve({ filter: /^formlane:/ }, ({ path }) => {
          if (!virtual.has(path)) throw new Error(`Unknown virtual entry: ${path}`)
          return { path, namespace: 'project' }
        })
        build.onResolve({ filter: /.*/, namespace: 'project' }, (args) => {
          signal.throwIfAborted()
          if (reactImports.has(args.path)) {
            if (source.template !== 'react-ts')
              throw new Error('React imports require the React + TypeScript template.')
            return { path: require.resolve(args.path), namespace: 'file' }
          }
          if (!args.path.startsWith('.') && !args.path.startsWith('/'))
            throw new Error(`Dependency is not included in this template: ${args.path}`)
          const [specifier = '', query] = args.path.split('?')
          if (query !== undefined && query !== 'raw' && query !== 'url')
            throw new Error(`Unsupported module query: ${args.path}`)
          const path = resolveFile(source, specifier, args.importer)
          return { path, namespace: 'project', suffix: query ? `?${query}` : '' }
        })
        build.onLoad({ filter: /.*/, namespace: 'project' }, ({ path, suffix }) => {
          signal.throwIfAborted()
          const synthetic = virtual.get(path)
          if (synthetic) return { contents: synthetic.content, loader: synthetic.loader }
          const content = source.files[path]
          if (content === undefined) throw new Error(`Project file disappeared: ${path}`)
          const loader =
            suffix === '?raw'
              ? 'text'
              : suffix === '?url'
                ? 'dataurl'
                : loaders[posix.extname(path)]
          if (!loader) throw new Error(`Unsupported module type: ${path}`)
          const contents = attribution && (loader === 'jsx' || loader === 'tsx')
            ? attribution.jsx(path, content)
            : content
          return { contents, loader }
        })
      },
    }
    const build = await context({
      entryPoints: ['formlane:entry'],
      bundle: true,
      write: false,
      outfile: 'preview.js',
      platform: 'browser',
      format: 'iife',
      target: 'es2022',
      minify: true,
      jsx: 'automatic',
      tsconfigRaw: { compilerOptions: { jsx: 'react-jsx', useDefineForClassFields: true } },
      define: {
        'process.env.NODE_ENV': '"production"',
        'import.meta.env': JSON.stringify({
          MODE: 'production',
          PROD: true,
          DEV: false,
          BASE_URL: '/',
        }),
      },
      logLevel: 'silent',
      plugins: [projectPlugin],
    })
    const abort = () => {
      void build.cancel()
    }
    signal.addEventListener('abort', abort, { once: true })
    try {
      signal.throwIfAborted()
      const result = await build.rebuild()
      signal.throwIfAborted()
      for (const file of result.outputFiles) {
        if (file.path.endsWith('.css')) {
          appendHtml(head, `<style>${file.text.replace(/<\/style/gi, '<\\/style')}</style>`)
        } else if (file.path.endsWith('.js')) {
          appendHtml(body, `<script>${file.text.replace(/<\/script/gi, '<\\/script')}</script>`)
        } else {
          throw new Error('The preview build produced an unsupported external asset.')
        }
      }
    } finally {
      signal.removeEventListener('abort', abort)
      await build.dispose()
    }
  }
  signal.throwIfAborted()
  const html = serialize(document)
  if (Buffer.byteLength(html) > MAX_PREVIEW_BYTES) {
    if (attribution) throw new InstrumentationLimitError()
    throw new Error('The compiled preview exceeds the 512 KiB limit.')
  }
  return { html, sourceHash }
}
