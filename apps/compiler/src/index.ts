import { Buffer } from 'node:buffer'
import { type ProjectSource, validateProjectSource } from '@atoms-demo/core/project'
import { compileEditorProject, compileProject } from './project-build'

// One invocation, one bounded JSON request, one JSON response. No project files
// are written to disk and no generated script, plugin or configuration is loaded.
const controller = new AbortController()
const forceExit = () => {
  controller.abort(new Error('Compilation cancelled or timed out.'))
  setTimeout(() => process.exit(124), 1000).unref()
}
const timeout = setTimeout(forceExit, 25_000)
process.once('SIGTERM', forceExit)
process.once('SIGINT', forceExit)

try {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of process.stdin) {
    controller.signal.throwIfAborted()
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += data.length
    if (bytes > 2 * 1024 * 1024) throw new Error('Compiler request exceeds 2 MiB.')
    chunks.push(data)
  }
  controller.signal.throwIfAborted()
  const request: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (!request || typeof request !== 'object' || Array.isArray(request))
    throw new Error('A source object is required.')
  // Bare source requests retain the original canonical wire format. Editor
  // compilation is explicit and returns its private artifact/manifest separately.
  const editor = 'mode' in request
  let input: unknown = request
  if (editor) {
    if (
      request.mode !== 'editor' ||
      !('source' in request) ||
      Object.keys(request).some((key) => key !== 'mode' && key !== 'source')
    )
      throw new Error('Editor compilation requires only mode="editor" and source.')
    input = request.source
  }
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('A source object is required.')
  const source = input as ProjectSource
  if (
    !source.files ||
    typeof source.files !== 'object' ||
    Array.isArray(source.files) ||
    !Object.values(source.files).every((value) => typeof value === 'string') ||
    Object.keys(source).some((key) => key !== 'template' && key !== 'files')
  )
    throw new Error('A source snapshot contains only template and string files.')
  validateProjectSource(source)
  const result = await (editor ? compileEditorProject : compileProject)(source, controller.signal)
  process.stdout.write(`${JSON.stringify(result)}\n`)
} catch (error) {
  const message = error instanceof Error ? error.message.slice(0, 4000) : 'Compilation failed.'
  process.stderr.write(`${message}\n`)
  process.stdout.write(`${JSON.stringify({ error: message })}\n`)
  process.exitCode = 1
} finally {
  clearTimeout(timeout)
  process.removeListener('SIGTERM', forceExit)
  process.removeListener('SIGINT', forceExit)
}
