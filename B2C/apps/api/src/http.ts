/** RFC 9457 problem+json, so every failure looks the same to the client. */
export class HttpError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, detail: string) {
    super(detail); this.status = status; this.code = code
  }
}

export const badRequest = (d: string, code = 'bad_request') => new HttpError(400, code, d)
export const unauthorized = (d = 'Sign in to continue.') => new HttpError(401, 'unauthenticated', d)
export const forbidden = (d = 'You do not have access to this.') => new HttpError(403, 'forbidden', d)

/**
 * Use notFound() when the caller should not learn the thing exists — an
 * unbought course, another student's submission. Use forbidden() only when they
 * already know it exists and simply may not act.
 */
export const notFound = (d = 'Not found.') => new HttpError(404, 'not_found', d)
export const conflict = (d: string, code = 'conflict') => new HttpError(409, code, d)
export const locked = (d: string, code = 'locked') => new HttpError(423, code, d)
export const tooMany = (d = 'Too many attempts. Wait a moment and try again.') =>
  new HttpError(429, 'rate_limited', d)

const TITLES: Record<number, string> = {
  400: 'That request could not be read',
  401: 'Sign in to continue',
  403: 'Not allowed',
  404: 'Not found',
  409: 'That conflicts with something already here',
  423: 'Locked',
  429: 'Too many attempts',
  500: 'Something went wrong at our end',
}

export const problem = (status: number, code: string, detail: string, traceId: string) => ({
  type: `https://brollyjuniors.com/errors/${code}`,
  title: TITLES[status] ?? 'Error',
  status, code, detail, traceId,
})
