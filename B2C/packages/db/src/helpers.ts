import type { Row } from './client.ts'

export class NotFound extends Error {
  status = 404
  code = 'not_found'
  constructor(what = 'Not found') { super(what); this.name = 'NotFound' }
}

/**
 * Fetch exactly one row, or 404.
 *
 * 404 rather than 403 is deliberate. When RLS filters away a course the student
 * has not bought, the query simply returns nothing — and "not found" refuses to
 * confirm that the id is real, which a 403 would.
 */
export function one<T = Row>(rows: T[], what = 'Not found'): T {
  if (rows.length === 0) throw new NotFound(what)
  return rows[0]
}

export const maybeOne = <T = Row>(rows: T[]): T | null => (rows.length ? rows[0] : null)
