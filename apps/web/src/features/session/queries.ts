import { orpc } from '../../lib/api'

export const healthQuery = orpc.health.queryOptions({ input: {} })
