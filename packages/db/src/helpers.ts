import type { Row } from './client.ts'

export class NotFound extends Error {
  status = 404
  constructor(what = 'Not found') { super(what); this.name = 'NotFound' }
}

/**
 * Fetch exactly one row, or 404.
 *
 * Note the deliberate choice of 404 rather than 403: when RLS filters away
 * another school's row the query simply returns nothing, and answering "not
 * found" refuses to confirm that the id exists somewhere else on the platform.
 */
export function one<T = Row>(rows: T[], what = 'Not found'): T {
  if (rows.length === 0) throw new NotFound(what)
  return rows[0]
}

export function maybeOne<T = Row>(rows: T[]): T | null {
  return rows.length ? rows[0] : null
}

/** Build "$3,$4,$5" for an IN list starting at a given placeholder offset. */
export function sqlIn(values: unknown[], startAt: number) {
  return values.map((_, i) => `$${startAt + i}`).join(',')
}
