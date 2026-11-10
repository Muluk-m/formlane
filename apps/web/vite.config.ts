import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { buildCommit, buildVersion } from '../../scripts/build-version.mjs'

const build = { service: 'atoms-demo-web', version: buildVersion(), commit: buildCommit() }

/** Exposes artifact identity without requiring a runtime backend request. */
function versionFile(): Plugin {
  return {
    name: 'atoms-demo-version-file',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: `${JSON.stringify(build)}\n`,
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), versionFile()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false },
  server: {
    port: 5173,
    proxy: { '/api/': 'http://localhost:8787', '/p/': 'http://localhost:8787' },
  },
})
