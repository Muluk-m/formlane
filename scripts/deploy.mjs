import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { apiOrigin } from './api-origin.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const config = JSON.parse(readFileSync(join(root, 'deploy/environments.json'), 'utf8'))
const [target, ...flags] = process.argv.slice(2)
if ((target !== 'test' && target !== 'production') || flags.some((flag) => flag !== '--apply')) {
  throw new Error('Usage: pnpm run deploy <test|production> [--apply]')
}
const settings = config[target]
if (
  !config.cloudflare.accountId ||
  !config.cloudflare.accountName ||
  !settings.pagesProject ||
  !settings.branch
) {
  throw new Error(
    'Deployment blocked: configure the verified Cloudflare account and Pages target in deploy/environments.json.',
  )
}
const origin = apiOrigin(settings.apiOrigin, `${target}.apiOrigin`, false)
const publicOrigin = apiOrigin(settings.apiPublicOrigin, `${target}.apiPublicOrigin`, false)
const frontendOrigin = apiOrigin(settings.frontendOrigin, `${target}.frontendOrigin`, false)
if (origin === frontendOrigin || publicOrigin === frontendOrigin) {
  throw new Error('The static frontend must use a separate Python API/public origin.')
}
if (flags.includes('--apply') && settings.backendReady !== true) {
  throw new Error(
    'Deployment blocked: the release owner must verify the live Python backend and migrated data, then set backendReady to true.',
  )
}
function run(args, capture = false) {
  const result = spawnSync('pnpm', args, {
    cwd: root,
    env: {
      ...process.env,
      CLOUDFLARE_ACCOUNT_ID: config.cloudflare.accountId,
      VITE_API_ORIGIN: origin,
      VITE_API_PUBLIC_ORIGIN: publicOrigin,
    },
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  })
  if (result.status !== 0) throw new Error(`Command failed: pnpm ${args.join(' ')}`)
  return result.stdout
}
const identity = JSON.parse(
  run(['--filter', '@atoms-demo/web', 'exec', 'wrangler', 'whoami', '--json'], true),
)
const account = identity.accounts.find((item) => item.id === config.cloudflare.accountId)
if (!account || account.name !== config.cloudflare.accountName) {
  throw new Error('Authenticated Cloudflare account does not match the designated account.')
}
console.info(
  `Verified ${account.name}: ${target}, static Pages ${settings.pagesProject}, API ${origin}, public ${publicOrigin}`,
)
if (!flags.includes('--apply')) process.exit(0)

const directory = mkdtempSync(join(tmpdir(), 'formlane-pages-'))
try {
  writeFileSync(
    join(directory, 'wrangler.jsonc'),
    JSON.stringify({
      name: settings.pagesProject,
      compatibility_date: '2026-11-12',
      pages_build_output_dir: resolve(root, 'apps/web/dist'),
    }),
  )
  run(['--filter', '@atoms-demo/web', 'build'])
  run([
    '--filter',
    '@atoms-demo/web',
    'exec',
    'wrangler',
    '--cwd',
    directory,
    'pages',
    'deploy',
    resolve(root, 'apps/web/dist'),
    '--project-name',
    settings.pagesProject,
    '--branch',
    settings.branch,
  ])
} finally {
  rmSync(directory, { recursive: true })
}
