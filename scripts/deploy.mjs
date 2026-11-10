import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const config = JSON.parse(readFileSync(join(root, 'deploy/environments.json'), 'utf8'))
const target = process.argv[2]
if (target !== 'test' && target !== 'production')
  throw new Error('Usage: pnpm deploy <test|production> [--apply]')
const settings = config[target]
if (!config.cloudflare.accountId || !settings.databaseId) {
  throw new Error(
    'Deployment blocked: verify the designated Cloudflare account and provision its D1 database before setting IDs in deploy/environments.json.',
  )
}
function run(args, capture = false) {
  const result = spawnSync('pnpm', args, {
    cwd: root,
    env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: config.cloudflare.accountId },
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  })
  if (result.status !== 0) throw new Error(`Command failed: pnpm ${args.join(' ')}`)
  return result.stdout
}
const identity = JSON.parse(
  run(['--filter', '@atoms-demo/server', 'exec', 'wrangler', 'whoami', '--json'], true),
)
const account = identity.accounts.find((item) => item.id === config.cloudflare.accountId)
if (!account || account.name !== config.cloudflare.accountName)
  throw new Error('Authenticated Cloudflare account does not match the designated account.')
console.info(
  `Verified ${account.name}: ${target}, Worker ${settings.worker}, Pages ${settings.pagesProject}`,
)
if (!process.argv.includes('--apply')) process.exit(0)
const directory = mkdtempSync(join(tmpdir(), 'atoms-deploy-'))
try {
  const server = JSON.parse(readFileSync(join(root, 'apps/server/wrangler.jsonc'), 'utf8'))
  server.account_id = account.id
  server.name = settings.worker
  server.workers_dev = false
  server.preview_urls = false
  server.main = resolve(root, 'apps/server/src/index.ts')
  if (server.workflows)
    server.workflows = server.workflows.map((workflow) => ({
      ...workflow,
      name: `${settings.worker}-generation`,
    }))
  server.d1_databases = [
    {
      binding: 'DB',
      database_name: settings.databaseName,
      database_id: settings.databaseId,
      migrations_dir: resolve(root, 'apps/server/migrations'),
    },
  ]
  const serverPath = join(directory, 'server.json')
  writeFileSync(serverPath, JSON.stringify(server))
  const webPath = join(directory, 'wrangler.jsonc')
  cpSync(join(root, 'apps/web/functions'), join(directory, 'functions'), { recursive: true })
  const functionsConfig = JSON.parse(
    readFileSync(join(directory, 'functions/tsconfig.json'), 'utf8'),
  )
  functionsConfig.extends = resolve(root, 'tsconfig.base.json')
  writeFileSync(join(directory, 'functions/tsconfig.json'), JSON.stringify(functionsConfig))
  writeFileSync(
    webPath,
    JSON.stringify({
      name: settings.pagesProject,
      compatibility_date: server.compatibility_date,
      pages_build_output_dir: resolve(root, 'apps/web/dist'),
      services: [{ binding: 'API', service: settings.worker }],
    }),
  )
  run(['--filter', '@atoms-demo/web', 'build'])
  run([
    '--filter',
    '@atoms-demo/server',
    'exec',
    'wrangler',
    'd1',
    'migrations',
    'apply',
    settings.databaseName,
    '--remote',
    '--config',
    serverPath,
  ])
  run(['--filter', '@atoms-demo/server', 'exec', 'wrangler', 'deploy', '--config', serverPath])
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
