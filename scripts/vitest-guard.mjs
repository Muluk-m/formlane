#!/usr/bin/env node
// Every package's `test` script goes through here. On a developer machine a run must name
// its test files; the whole suite runs only where CI is set (GitHub Actions, rmake on macmini2).
// Reason: parallel full suites from several agents froze the laptop (load 72, swap exhausted).
import { spawn } from 'node:child_process'

const args = process.argv.slice(2)
const targets = args.filter((a) => !a.startsWith('-'))
const isCI = Boolean(process.env.CI)

if (args.includes('--print-help') || (!isCI && targets.length === 0)) {
  const msg = [
    'Name the relevant test files when running locally.',
    '  pnpm --filter @formlane/compiler test src/project-build.test.ts',
    '  pnpm --filter @atoms-demo/core test src/alex-stream.test.ts',
    'Run the full suite on the remote builder or CI:',
    "  rmake -c 'CI=true pnpm test'",
  ].join('\n')
  console.error(msg)
  process.exit(args.includes('--print-help') ? 0 : 2)
}

if (args.some((a) => a === '--watch' || a === '-w')) {
  console.error('Watch mode is disabled. Run once and exit.')
  process.exit(2)
}

const child = spawn(
  'vitest',
  ['run', '--maxWorkers=1', '--no-file-parallelism', '--passWithNoTests', ...args],
  { stdio: 'inherit' },
)
const forward = (signal) => child.kill(signal)
process.on('SIGINT', forward)
process.on('SIGTERM', forward)
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 1)))
