import { readFile } from 'node:fs/promises'
import { build } from 'esbuild'

const manifest = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'))
const external = Object.entries(manifest.dependencies)
  .filter(([, version]) => !version.startsWith('workspace:'))
  .map(([name]) => name)

// Workspace TypeScript must be bundled; Node cannot strip types inside node_modules.
await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  external,
  outfile: 'dist/index.js',
})
