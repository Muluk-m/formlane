import { type DrizzleD1Database, drizzle } from 'drizzle-orm/d1'
import * as schema from './schema'

export function openDb(binding: D1Database) {
  return drizzle(binding, { schema })
}
export type Db = DrizzleD1Database<typeof schema>
