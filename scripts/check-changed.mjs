#!/usr/bin/env node
// The local pre-push gate: CI's fast checks scoped to what changed, one at a time.
//   pnpm check:changed            # against origin/main (falls back to HEAD)
//   pnpm check:changed <base-ref>
// Biome on changed files → typecheck of affected packages and their dependents →
// tests beside changed files → Ruff and named Python tests for backend changes.
// Never the whole suite (that is CI / rmake).
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
process.chdir(root)

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).split('\n').filter(Boolean)
const hasRef = (ref) => spawnSync('git', ['rev-parse', '--verify', '--quiet', ref]).status === 0

const base = process.argv[2] ?? (hasRef('origin/main') ? 'origin/main' : 'HEAD')
const changed = [
  ...new Set([
    ...(base === 'HEAD' ? [] : git('diff', '--name-only', `${base}...HEAD`)),
    ...git('diff', '--name-only', 'HEAD'),
    ...git('ls-files', '--others', '--exclude-standard'),
  ]),
].filter((f) => existsSync(f))

if (changed.length === 0) {
  console.info('No changes.')
  process.exit(0)
}

// Workspace graph from package.json files.
const pkgDirs = ['apps', 'packages'].flatMap((d) =>
  readdirSync(d, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(d, e.name, 'package.json')))
    .map((e) => join(d, e.name)),
)
const pkgs = pkgDirs.map((dir) => {
  const json = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  const deps = Object.keys({ ...json.dependencies, ...json.devDependencies })
  return { dir, name: json.name, deps, scripts: json.scripts ?? {} }
})
const owner = (file) => pkgs.find((p) => file.startsWith(`${p.dir}/`))

const direct = new Set(
  changed
    .map(owner)
    .filter(Boolean)
    .map((p) => p.name),
)
const affected = new Set(direct)
let grew = true
while (grew) {
  grew = false
  for (const p of pkgs) {
    if (!affected.has(p.name) && p.deps.some((d) => affected.has(d))) {
      affected.add(p.name)
      grew = true
    }
  }
}

function run(label, cmd, args) {
  console.info(`\n▶ ${label}`)
  const r = spawnSync(cmd, args, { stdio: 'inherit' })
  if (r.status !== 0) {
    console.error(`✗ ${label}`)
    process.exit(r.status ?? 1)
  }
}

const lintable = changed.filter((f) => /\.(m?[jt]sx?|json|jsonc|css|md)$/.test(f))
if (lintable.length > 0) {
  run(`biome (${lintable.length} files)`, 'pnpm', [
    'exec',
    'biome',
    'check',
    '--no-errors-on-unmatched',
    '--files-ignore-unknown=true',
    ...lintable,
  ])
}

for (const p of pkgs.filter((x) => affected.has(x.name) && x.scripts.typecheck)) {
  run(`typecheck ${p.name}`, 'pnpm', ['--filter', p.name, 'typecheck'])
}

const testFor = (file) => {
  if (/\.test\.tsx?$/.test(file)) return [file]
  const m = file.match(/^(.*)\.(tsx?)$/)
  if (!m) return []
  const stem = basename(m[1])
  const dir = dirname(file)
  return [
    `${m[1]}.test.ts`,
    `${m[1]}.test.tsx`,
    join(dir, '__tests__', `${stem}.test.ts`),
    join(dir, '__tests__', `${stem}.test.tsx`),
  ].filter((f) => existsSync(f))
}
for (const p of pkgs.filter((x) => direct.has(x.name))) {
  const tests = [...new Set(changed.filter((f) => owner(f) === p).flatMap(testFor))].map((f) =>
    relative(p.dir, f),
  )
  if (tests.length > 0)
    run(`test ${p.name} (${tests.length} files)`, 'pnpm', ['--filter', p.name, 'test', ...tests])
}

const backendDir = 'apps/backend'
const pythonFiles = changed
  .filter((file) => file.startsWith(`${backendDir}/`) && file.endsWith('.py'))
  .map((file) => relative(backendDir, file))
if (pythonFiles.length > 0) {
  run(`ruff (${pythonFiles.length} files)`, 'uv', [
    'run',
    '--directory',
    backendDir,
    'ruff',
    'check',
    ...pythonFiles,
  ])
  const pythonTests = [
    ...new Set(
      pythonFiles.flatMap((file) => {
        if (/^tests\/test_[^/]+\.py$/.test(file)) return [file]
        const module = file.match(/^src\/formlane\/([^/]+)\.py$/)
        if (!module) return []
        const testName = { app: 'api' }[module[1]] ?? module[1]
        const test = `tests/test_${testName}.py`
        return existsSync(join(backendDir, test)) ? [test] : []
      }),
    ),
  ]
  if (pythonTests.length > 0) {
    run(`pytest (${pythonTests.length} files)`, 'uv', [
      'run',
      '--directory',
      backendDir,
      'pytest',
      ...pythonTests,
    ])
  }
}

if (changed.includes(`${backendDir}/src/formlane/models.py`)) {
  console.info(
    '\nSchema changed: run pnpm db:generate --message <description>, review the migration, and commit it.',
  )
}
console.info('\ncheck:changed passed')
