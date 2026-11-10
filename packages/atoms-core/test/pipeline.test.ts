import assert from 'node:assert/strict'
import { test } from 'vitest'
import { AlexOutput, parseAlexOutput } from '../src/alex-stream'
import { extractHtml } from '../src/html'
import { buildMockApp, mockAlexRaw, reviseMockHtml } from '../src/mock'
import { titleFromIdea } from '../src/text'

test('extracts a fenced HTML document and ignores the note', () => {
  const raw =
    'NOTE: Built the board.\n```html\n<!DOCTYPE html><html><body><h1>Hi</h1></body></html>\n```'
  const html = extractHtml(raw)
  assert.ok(html)
  assert.match(html, /^<!DOCTYPE html>/i)
  assert.doesNotMatch(html, /NOTE:/)
  assert.equal(parseAlexOutput(raw).note, 'Built the board.')
})

test('alex stream survives fences split across chunks', () => {
  const output = new AlexOutput()
  const chunks = [
    'NOTE: He',
    'llo\n```ht',
    'ml\n<!DOCTYPE html><html><body><p>Ok</p></body></html>\n```',
  ]
  let note = ''
  let code = ''
  for (const chunk of chunks) {
    const step = output.push(chunk)
    if (step.replaceNote != null) note = step.replaceNote
    else note += step.noteDelta
    if (step.replaceCode) code = step.parsed.code
    else code += step.codeDelta
  }
  assert.equal(note, 'Hello')
  assert.match(code, /<p>Ok<\/p>/)
  assert.ok(extractHtml(output.raw))
})

test('mock app is a sandboxed document that includes the idea', () => {
  const idea = 'A weekend farmers market map for a small coastal town. Shoppers filter stalls.'
  const html = buildMockApp(idea, null, titleFromIdea(idea))
  assert.match(html, /<!DOCTYPE html>/)
  assert.match(html, /farmers market map/)
  const revised = reviseMockHtml(html, 'Make the page dark and add a packing checklist')
  assert.match(revised, /packing checklist/)
  assert.match(revised, /data-build="2"/)
  assert.match(revised, /#141311/)
  assert.equal(
    extractHtml(mockAlexRaw({ idea, request: idea, previousHtml: null }, 'Market')) !== null,
    true,
  )
})

test('escapes idea text that looks like markup', () => {
  const html = buildMockApp('A board <script>alert("x")</script> for neighbors.', null, 'Board')
  assert.doesNotMatch(html, /<script>alert/)
  assert.match(html, /&lt;script&gt;/)
})
