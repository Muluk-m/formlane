import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import {
  SELECTION_SOURCE_ATTRIBUTE,
  type SelectionSourceLocation,
} from '@atoms-demo/core/selection'
import type { DefaultTreeAdapterTypes } from 'parse5'
import ts from 'typescript'

export const INSTRUMENTATION_VERSION = 'formlane-source-v1'
const MAX_MANIFEST_ENTRIES = 4096
const MAX_MANIFEST_BYTES = 1024 * 1024
const MAX_DIAGNOSTICS = 200

export interface EditorBuildDiagnostic {
  code: 'reserved-marker' | 'jsx-spread' | 'instrumentation-limit'
  path?: string
  startLine?: number
  startColumn?: number
}

/** Annotation must never prevent ordinary selection of a valid canonical build. */
export class InstrumentationLimitError extends Error {}

type HtmlNode = DefaultTreeAdapterTypes.Node

/** Only compiler-parsed nodes receive IDs. Nothing here loads or evaluates source modules. */
export class SourceAttribution {
  readonly entries: Record<string, SelectionSourceLocation> = {}
  readonly diagnostics: EditorBuildDiagnostic[] = []
  limitExceeded = false
  private readonly sourceIds = new Map<string, string>()
  private readonly transformed = new Map<string, string>()
  private manifestBytes = 4096

  constructor(private readonly signal: AbortSignal, private readonly sourceHash: string) {}

  private exceedLimit(): never {
    this.limitExceeded = true
    throw new InstrumentationLimitError()
  }

  private add(location: SelectionSourceLocation): string {
    const key = JSON.stringify(location)
    const existing = this.sourceIds.get(key)
    if (existing) return existing
    if (this.sourceIds.size >= MAX_MANIFEST_ENTRIES) this.exceedLimit()
    // Deterministic within one immutable source build, never a cross-version DOM
    // identity or credential. Recompilation can reproduce the private artifact.
    const id = createHash('sha256')
      .update(JSON.stringify([INSTRUMENTATION_VERSION, this.sourceHash, location]))
      .digest('hex')
      .slice(0, 32)
    this.manifestBytes += Buffer.byteLength(key) + id.length + 6
    if (this.manifestBytes > MAX_MANIFEST_BYTES) this.exceedLimit()
    this.sourceIds.set(key, id)
    this.entries[id] = location
    return id
  }

  private diagnose(code: 'reserved-marker' | 'jsx-spread', location: SelectionSourceLocation): void {
    if (this.diagnostics.length >= MAX_DIAGNOSTICS) this.exceedLimit()
    this.diagnostics.push({
      code,
      path: location.path,
      startLine: location.startLine,
      startColumn: location.startColumn,
    })
  }

  html(document: HtmlNode): void {
    const pending = [document]
    while (pending.length) {
      this.signal.throwIfAborted()
      const node = pending.pop()
      if (!node) continue
      if ('childNodes' in node) {
        for (let index = node.childNodes.length - 1; index >= 0; index--) {
          const child = node.childNodes[index]
          if (child) pending.push(child)
        }
      }
      if ('content' in node) pending.push(node.content)
      if (!('tagName' in node)) continue
      const range = node.sourceCodeLocation
      // Parser-created nodes have no exact source. Technical nodes are removed or
      // rewritten by the canonical bundler and do not identify rendered content.
      if (!range?.startTag || /^(?:head|script|style|link|meta|title)$/.test(node.tagName)) continue
      const location: SelectionSourceLocation = {
        path: 'index.html',
        startLine: range.startLine,
        startColumn: range.startCol,
        endLine: range.endLine,
        endColumn: range.endCol,
        tagName: node.tagName,
      }
      if (node.attrs.some((attribute) => attribute.name.toLowerCase() === SELECTION_SOURCE_ATTRIBUTE)) {
        this.diagnose('reserved-marker', location)
        continue
      }
      node.attrs.push({ name: SELECTION_SOURCE_ATTRIBUTE, value: this.add(location) })
    }
  }

  jsx(path: string, content: string): string {
    const cached = this.transformed.get(path)
    if (cached !== undefined) return cached
    const file = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const insertions: { offset: number; text: string }[] = []
    const pending: ts.Node[] = [file]
    while (pending.length) {
      this.signal.throwIfAborted()
      const node = pending.pop()
      if (!node) continue
      ts.forEachChild(node, (child) => {
        pending.push(child)
      })
      if (!ts.isJsxOpeningElement(node) && !ts.isJsxSelfClosingElement(node)) continue
      const name = node.tagName
      if (!ts.isJsxNamespacedName(name) && (!ts.isIdentifier(name) || !/^[a-z]|-/.test(name.text))) continue
      const tagName = name.getText(file)
      const element = ts.isJsxOpeningElement(node) && ts.isJsxElement(node.parent) ? node.parent : node
      const start = file.getLineAndCharacterOfPosition(element.getStart(file))
      const end = file.getLineAndCharacterOfPosition(element.end)
      const location: SelectionSourceLocation = {
        path,
        startLine: start.line + 1,
        startColumn: start.character + 1,
        endLine: end.line + 1,
        endColumn: end.character + 1,
        tagName,
      }
      const attributes = node.attributes.properties
      if (attributes.some((attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(file).toLowerCase() === SELECTION_SOURCE_ATTRIBUTE)) {
        this.diagnose('reserved-marker', location)
        continue
      }
      // An unknown spread can supply the reserved attribute. Neither overriding
      // it nor allowing it to replace a compiler ID preserves trustworthy mapping.
      if (attributes.some(ts.isJsxSpreadAttribute)) {
        this.diagnose('jsx-spread', location)
        continue
      }
      insertions.push({ offset: name.end, text: ` ${SELECTION_SOURCE_ATTRIBUTE}="${this.add(location)}"` })
    }
    insertions.sort((left, right) => left.offset - right.offset)
    const chunks: string[] = []
    let offset = 0
    for (const insertion of insertions) {
      chunks.push(content.slice(offset, insertion.offset), insertion.text)
      offset = insertion.offset
    }
    chunks.push(content.slice(offset))
    const result = chunks.join('')
    this.transformed.set(path, result)
    return result
  }
}
