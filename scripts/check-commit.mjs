import { readFileSync } from 'node:fs'

const message = readFileSync(process.argv[2], 'utf8').split('\n')[0]
if (
  !/^(feat|fix|refactor|chore|docs|test|build|ci|perf|style)(\([a-z0-9-]+\))?!?: [\x20-\x7e]+$/.test(
    message,
  ) ||
  message.length > 72
) {
  console.error('Use a short English Conventional Commit subject (maximum 72 characters).')
  process.exit(1)
}
