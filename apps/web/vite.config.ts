import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { type Connect, defineConfig, loadEnv, type Plugin } from 'vite'
import { apiOrigin } from '../../scripts/api-origin.mjs'
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

/** Preserve old API requests and published links without an edge function. */
function backendRedirects(origin: string, publicOrigin: string): Plugin {
  const redirect: Connect.NextHandleFunction = (request, response, next) => {
    const path = request.url ?? '/'
    const api = path.startsWith('/api/')
    if (!api && !path.startsWith('/p/')) return next()
    response.writeHead(api ? 307 : 302, {
      Location: `${api ? origin : publicOrigin}${path}`,
    })
    response.end()
  }
  return {
    name: 'formlane-backend-redirects',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: '_redirects',
        source: `/api/* ${origin}/api/:splat 307\n/p/* ${publicOrigin}/p/:splat 302\n`,
      })
    },
    configureServer(server) {
      server.middlewares.use(redirect)
    },
    configurePreviewServer(server) {
      server.middlewares.use(redirect)
    },
  }
}

export default defineConfig(({ command, mode, isPreview }) => {
  const env = loadEnv(mode, fileURLToPath(new URL('./', import.meta.url)), 'VITE_')
  const development = command === 'serve' && !isPreview
  const origin = apiOrigin(
    env.VITE_API_ORIGIN ?? (development ? 'http://localhost:8090' : undefined),
    'VITE_API_ORIGIN',
  )
  const publicOrigin = apiOrigin(env.VITE_API_PUBLIC_ORIGIN ?? origin, 'VITE_API_PUBLIC_ORIGIN')
  return {
    plugins: [react(), tailwindcss(), versionFile(), backendRedirects(origin, publicOrigin)],
    define: {
      'import.meta.env.VITE_API_ORIGIN': JSON.stringify(origin),
      'import.meta.env.VITE_API_PUBLIC_ORIGIN': JSON.stringify(publicOrigin),
    },
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    build: { outDir: 'dist', emptyOutDir: true, sourcemap: false },
    server: { port: 5173 },
  }
})
