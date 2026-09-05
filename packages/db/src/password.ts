import { scrypt, randomBytes, timingSafeEqual, createHash } from 'node:crypto'
import { promisify } from 'node:util'

const scryptAsync = promisify(scrypt) as (
  pw: string | Buffer, salt: Buffer, keylen: number, opts: Record<string, number>,
) => Promise<Buffer>

// scrypt is memory-hard and ships with Node, so the app installs and runs
// anywhere with no native build step. Argon2id is the production upgrade; the
// stored format is versioned so a rehash-on-login migration is a small change.
const N = 16384, R = 8, P = 1, KEYLEN = 32

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await scryptAsync(plain.normalize('NFKC'), salt, KEYLEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 })
  return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$')
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  try {
    const [scheme, n, r, p, saltB64, keyB64] = stored.split('$')
    if (scheme !== 'scrypt') return false
    const salt = Buffer.from(saltB64, 'base64')
    const expected = Buffer.from(keyB64, 'base64')
    const actual = await scryptAsync(plain.normalize('NFKC'), salt, expected.length, {
      N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024,
    })
    return actual.length === expected.length && timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/** Readable one-time password for a printed credential slip. No 0/O/1/l. */
export function tempPassword(len = 6): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'
  const bytes = randomBytes(len)
  let out = ''
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length]
  return out
}
