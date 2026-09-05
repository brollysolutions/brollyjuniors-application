/** RFC 9457 problem+json, so every failure looks the same to the client. */
export class HttpError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, detail: string) {
    super(detail)
    this.status = status
    this.code = code
  }
}

export const badRequest = (detail: string, code = 'bad_request') => new HttpError(400, code, detail)
export const unauthorized = (detail = 'Sign in to continue.') => new HttpError(401, 'unauthenticated', detail)

/**
 * Inside your own school, 403 is correct and more useful than 404.
 * Across schools use notFound() instead — a 403 would confirm the row exists.
 */
export const forbidden = (detail = 'You do not have access to this.') => new HttpError(403, 'forbidden', detail)
export const notFound = (detail = 'Not found.') => new HttpError(404, 'not_found', detail)
export const conflict = (detail: string, code = 'conflict') => new HttpError(409, code, detail)
export const locked = (detail: string, code = 'locked') => new HttpError(423, code, detail)
export const tooMany = (detail = 'Too many attempts. Wait a moment and try again.') =>
  new HttpError(429, 'rate_limited', detail)

export function problem(status: number, code: string, detail: string, requestId: string) {
  return {
    type: `https://brolly.dev/errors/${code}`,
    title: TITLES[status] ?? 'Error',
    status,
    code,
    detail,
    traceId: requestId,
  }
}

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
