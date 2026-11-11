import { expect, it } from 'vitest'
import { highlightSource, sourceLanguage } from './highlight'

it.each([
  [
    'src/App.tsx',
    'typescript',
    'export default function App() {\n  return <p title="a & b">Hello</p>\n}\n',
  ],
  ['src/main.js', 'javascript', '// app\nconst value = "<script>";\n'],
  ['src/styles.css', 'css', '/* theme */\nmain { color: #fff; }'],
  ['package.json', 'json', '{\n  "name": "project", "private": true\n}\n'],
  ['index.html', 'html', '<!-- test -->\n<main title="a & b">Hello</main>\n'],
  ['README.md', 'markdown', '# Heading\nUse `npm run dev`.'],
  ['notes.txt', 'text', 'a < b\n\nplain text\n'],
])('preserves all source text and line boundaries for %s', (path, language, code) => {
  expect(sourceLanguage(path)).toBe(language)
  const lines = highlightSource(code, path)
  expect(lines.map((line) => line.tokens.map((token) => token.text).join('')).join('\n')).toBe(code)
  expect(lines.map((line) => line.number)).toEqual(code.split('\n').map((_, index) => index + 1))
  if (language !== 'text')
    expect(lines.flatMap((line) => line.tokens).some((token) => token.className)).toBe(true)
})
