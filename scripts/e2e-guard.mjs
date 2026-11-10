#!/usr/bin/env node
// Playwright E2E: locally only the named spec files, one worker. The full suite runs in CI/macmini2.
import { spawn } from 'node:child_process'

const args = process.argv.slice(2)
const targets = args.filter((a) => !a.startsWith('-'))
if (!process.env.CI && targets.length === 0) {
  console.error('Name a local E2E spec: pnpm --filter @atoms-demo/web e2e e2e/<spec>.spec.ts')
  console.error("Full E2E suite: rmake -c 'pnpm --filter @atoms-demo/web e2e'")
  process.exit(2)
}
const child = spawn('playwright', ['test', '--workers=1', ...args], { stdio: 'inherit' })
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 1)))
