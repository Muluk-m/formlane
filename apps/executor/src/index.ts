import { loadConfiguration } from './config'
import { runExecutor } from './runner'

const shutdown = new AbortController()
process.once('SIGTERM', () => shutdown.abort(new Error('Executor is stopping.')))
process.once('SIGINT', () => shutdown.abort(new Error('Executor is stopping.')))

try {
  await runExecutor(loadConfiguration(), shutdown.signal)
} catch {
  console.error(JSON.stringify({ event: 'executor_startup_failed' }))
  process.exitCode = 1
}
