'use client'

import { Capacitor } from '@capacitor/core'

/**
 * Which shell the bundle is running in, and what that means for HTTP.
 *
 * On the web the page and the API share an origin, because Next rewrites
 * /api/* onwards (next.config.ts). Relative URLs work, and the HttpOnly
 * refresh cookie is a first-party cookie the browser attaches by itself.
 *
 * In the Capacitor app the bundle is served off the device — capacitor://localhost
 * on iOS, https://localhost on Android — and there is no proxy behind it. Every
 * request is therefore cross-origin to the API host and has to say so: an
 * absolute base URL, and credentials: 'include' so the refresh cookie is still
 * sent. The API has to answer with CORS that names those origins and a cookie
 * marked SameSite=None; Secure, which is why the native app needs an HTTPS API
 * and cannot be pointed at a plain-http dev server. See backend/app/config.py.
 */

/** True inside the iOS/Android shell, false in any browser. */
export const isNative = (): boolean => Capacitor.isNativePlatform()

/** 'ios' | 'android' | 'web'. */
export const platform = (): string => Capacitor.getPlatform()

const CONFIGURED_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? '').replace(/\/+$/, '')

/**
 * Prefix for every API call: empty on the web so requests stay relative and
 * same-origin, absolute in the app.
 */
export function apiBase(): string {
  if (!isNative()) return ''
  if (!CONFIGURED_BASE) {
    // Relative URLs would resolve against the on-device bundle and 404, which
    // reads as "the server is broken" rather than "this build was misconfigured".
    throw new Error(
      'NEXT_PUBLIC_API_BASE_URL was not set for this mobile build. ' +
      'Set it to the public HTTPS origin of the API and rebuild.',
    )
  }
  return CONFIGURED_BASE
}

/** Cross-origin in the app, so the refresh cookie needs an explicit opt-in. */
export const credentialsMode = (): RequestCredentials =>
  isNative() ? 'include' : 'same-origin'
