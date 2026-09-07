/**
 * Protected media delivery.
 *
 * The rule from requirement 35: a recording or PDF must not be reachable just
 * because someone knows a URL. So:
 *
 *   1. Object keys are content-addressed (sha256), which makes them
 *      unguessable AND immutable — a URL never goes stale, so every asset can
 *      be cached for a year with no invalidation logic anywhere.
 *   2. No row anywhere stores a usable URL. What is stored is a storage key.
 *   3. A usable link is a SHORT-LIVED SIGNATURE minted per request, and only
 *      after the caller's entitlement has been checked.
 *
 * The signer below is HMAC over the same fields a CDN signature covers, so
 * swapping in CloudFront or Cloudflare is a change to this file alone. Nothing
 * that calls signMediaUrl() knows or cares which CDN is behind it.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'
import { env } from './env.ts'

export type SignedMedia = {
  url: string
  expiresAt: string
  kind: string
  mimeType: string
  bytes: number
  durationMs?: number | null
  fileName: string
}

export interface MediaSigner {
  sign(storageKey: string, forUserId: string, ttlSeconds: number): { url: string; expiresAt: Date }
  verify(storageKey: string, expires: number, signature: string, forUserId: string): boolean
}

/**
 * Development signer. Same shape as a CDN signature: key + expiry + audience,
 * so the swap is mechanical.
 *
 * Binding the signature to a user id is a deliberate step past what most CDN
 * signed URLs do — a leaked link is useless to anybody else. A real CloudFront
 * deployment gets the same effect with signed cookies plus a short TTL; the
 * limitation is noted in the docs rather than glossed over.
 */
class HmacSigner implements MediaSigner {
  sign(storageKey: string, forUserId: string, ttlSeconds: number) {
    const expires = Math.floor(Date.now() / 1000) + ttlSeconds
    const sig = this.mac(storageKey, expires, forUserId)
    const url = `${env.cdnBase}/${storageKey}?expires=${expires}&sig=${sig}`
    return { url, expiresAt: new Date(expires * 1000) }
  }

  verify(storageKey: string, expires: number, signature: string, forUserId: string) {
    if (expires * 1000 < Date.now()) return false
    const expected = Buffer.from(this.mac(storageKey, expires, forUserId))
    const given = Buffer.from(signature)
    return expected.length === given.length && timingSafeEqual(expected, given)
  }

  private mac(storageKey: string, expires: number, forUserId: string) {
    return createHmac('sha256', env.mediaSigningKey)
      .update(`${storageKey}\n${expires}\n${forUserId}`)
      .digest('base64url')
  }
}

export const mediaSigner: MediaSigner = new HmacSigner()

/** Turn a media_asset row into something the browser can actually fetch. */
export function signAsset(asset: {
  storage_key: string; kind: string; mime_type: string; bytes: number
  duration_ms?: number | null; file_name: string; visibility: string
}, forUserId: string): SignedMedia {
  // Public assets (a course hero image) need no signature and cache forever.
  if (asset.visibility === 'public') {
    return {
      url: `${env.cdnBase}/${asset.storage_key}`,
      expiresAt: new Date(Date.now() + 365 * 864e5).toISOString(),
      kind: asset.kind, mimeType: asset.mime_type, bytes: asset.bytes,
      durationMs: asset.duration_ms ?? null, fileName: asset.file_name,
    }
  }
  const { url, expiresAt } = mediaSigner.sign(asset.storage_key, forUserId, env.mediaUrlTtlSeconds)
  return {
    url, expiresAt: expiresAt.toISOString(),
    kind: asset.kind, mimeType: asset.mime_type, bytes: asset.bytes,
    durationMs: asset.duration_ms ?? null, fileName: asset.file_name,
  }
}

/** Content-addressed key: identical bytes are stored once, and never move. */
export function storageKeyFor(sha256: string, fileName: string) {
  const safe = fileName.toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-+|-+$/g, '')
  return `media/${sha256.slice(0, 2)}/${sha256}/${safe}`
}
