import { describe, expect, it } from 'vitest'
import { followupSchema, selectionSubmissionSchema } from '../index'

const selection = {
  versionId: '00000000-0000-4000-8000-000000000001',
  sourceHash: 'a'.repeat(64),
  canonicalArtifactHash: 'b'.repeat(64),
  editorArtifactHash: 'c'.repeat(64),
  instrumentationVersion: 'formlane-source-v1',
  sessionId: 'frame',
  documentId: 'document',
  evidence: {
    kind: 'element',
    element: {
      nodeId: 'node',
      sourceId: null,
      tagName: 'button',
      role: 'button',
      text: 'Save',
      attributes: { 'aria-label': 'Save' },
      styles: { color: 'red' },
      selector: 'button',
      ancestors: [],
      rects: [{ x: 1, y: 2, width: 40, height: 20 }],
      viewport: { width: 800, height: 600 },
      scroll: { x: 0, y: 0 },
      instance: { label: 'Save', context: 'First card' },
    },
  },
}

describe('selection follow-up contract', () => {
  it('requires an explicit baseline and preserves the exact contextual attachment', () => {
    expect(followupSchema.safeParse({ content: 'Make it blue', selection }).success).toBe(false)
    expect(
      followupSchema.parse({
        content: 'Make it blue',
        expectedVersionId: selection.versionId,
        selection,
      }).selection,
    ).toEqual(selection)
  })
  it('rejects privileged metadata, forged source paths and unbounded context', () => {
    expect(selectionSubmissionSchema.safeParse({ ...selection, ownerId: 'secret' }).success).toBe(
      false,
    )
    for (const element of [
      { ...selection.evidence.element, path: '/etc/passwd' },
      { ...selection.evidence.element, text: 'x'.repeat(2001) },
      { ...selection.evidence.element, attributes: { value: 'secret' } },
      { ...selection.evidence.element, styles: { 'background-image': 'url(secret)' } },
      { ...selection.evidence.element, rects: [{ x: Number.NaN, y: 0, width: 1, height: 1 }] },
    ]) {
      expect(
        selectionSubmissionSchema.safeParse({
          ...selection,
          evidence: { kind: 'element', element },
        }).success,
      ).toBe(false)
    }
  })
  it('does not let browser uploads claim server observation provenance', () => {
    const image = {
      provenance: 'server-reconstructed',
      mimeType: 'image/png',
      width: 1,
      height: 1,
      base64: 'eA==',
    }
    expect(selectionSubmissionSchema.safeParse({ ...selection, image }).success).toBe(false)
  })
})
