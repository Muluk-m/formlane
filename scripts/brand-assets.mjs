import { writeFile } from 'node:fs/promises'
import { logoSvg } from '../packages/ui/src/brand/logo.ts'

await writeFile(new URL('../apps/web/public/favicon.svg', import.meta.url), `${logoSvg()}\n`)
console.info('Generated Formlane favicon from shared brand geometry.')
