import { execFileSync } from 'node:child_process'

// Reserve evidence directories even when files are force-added through .gitignore.
const evidenceDirectory =
  /(?:^|\/)(?:evidence|screenshots?|traces?|run-logs|playwright-report|test-results|blob-report|\.playwright-cli|\.playwright-mcp|(?:acceptance|browser|smoke|test)-evidence(?:[-_][^/]*)?)\//i
const fixtureDirectory = /(?:^|\/)(?:fixtures|__fixtures__|__snapshots__)\//
const captureName = /(?:^|[ ._-])(?:screenshots?|screen[ _-]?shots?)(?:[ ._-]|$)/i
const recordingName = /(?:^|[ ._-])(?:videos?|recordings?|screencasts?)(?:[ ._-]|$)/i
const traceName = /(?:^|[ ._-])trace(?:[ ._-]|$)/i

function isEvidence(path) {
  if (evidenceDirectory.test(path)) return true
  // Deterministic fixtures are source inputs; captured run output belongs outside Git.
  if (fixtureDirectory.test(path)) return false
  const name = path.split('/').at(-1)
  return (
    /\.(?:log|trace|har)$/i.test(name) ||
    (captureName.test(name) && /\.(?:png|jpe?g|webp|gif|avif)$/i.test(name)) ||
    (recordingName.test(name) && /\.(?:mp4|webm|mov)$/i.test(name)) ||
    (traceName.test(name) && /\.(?:zip|json|jsonl)$/i.test(name))
  )
}

export function checkEvidence({ tracked = false } = {}) {
  // The index excludes staged deletions; CI scans the complete committed tree.
  const args = tracked
    ? ['ls-tree', '-r', '--name-only', '-z', 'HEAD']
    : ['ls-files', '--cached', '-z']
  const paths = execFileSync('git', args, { encoding: 'utf8' }).split('\0').filter(Boolean)
  const rejected = paths.filter(isEvidence)
  if (rejected.length === 0) return
  console.error(
    'Keep acceptance screenshots, videos, traces and run logs outside the checkout. ' +
      'Record archive location, build/run IDs, SHA-256 and results in documentation.',
  )
  for (const path of rejected) console.error(`  ${JSON.stringify(path)}`)
  process.exit(1)
}

if (import.meta.main) checkEvidence({ tracked: process.argv.includes('--tracked') })
