/**
 * Access tokens are RS256 and short (10 minutes) so a verifier never holds a
 * signing key and a stolen token expires on its own. Refresh tokens are opaque,
 * stored only as a hash, rotated on every use, and a replayed one kills the
 * whole session family.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { SignJWT, jwtVerify, importPKCS8, importSPKI, exportPKCS8, exportSPKI, generateKeyPair } from 'jose'
import type { KeyLike } from 'jose'
import { env } from './env.ts'

const ALG = 'RS256'
const ISS = 'brolly'
const AUD = 'brolly-api'

type KeyPair = { priv: KeyLike; pub: KeyLike }
let keys: KeyPair | null = null

async function loadKeys(): Promise<KeyPair> {
  if (keys) return keys
  const privPath = path.join(env.keyDir, 'access.key')
  const pubPath = path.join(env.keyDir, 'access.pub')
  let pair: KeyPair
  try {
    const [privPem, pubPem] = await Promise.all([fs.readFile(privPath, 'utf8'), fs.readFile(pubPath, 'utf8')])
    pair = { priv: await importPKCS8(privPem, ALG), pub: await importSPKI(pubPem, ALG) }
  } catch {
    // First boot: mint a keypair and keep it, so restarting the API does not
    // sign every user out.
    const kp = await generateKeyPair(ALG, { extractable: true })
    await fs.mkdir(env.keyDir, { recursive: true })
    await fs.writeFile(privPath, await exportPKCS8(kp.privateKey), { mode: 0o600 })
    await fs.writeFile(pubPath, await exportSPKI(kp.publicKey))
    pair = { priv: kp.privateKey, pub: kp.publicKey }
  }
  keys = pair
  return pair
}

export type AccessClaims = {
  sub: string
  tid: string
  scope: 'tenant' | 'platform'
  sid: string
  pv: number
  roles: string[]
}

export async function signAccessToken(c: AccessClaims): Promise<string> {
  const { priv } = await loadKeys()
  return new SignJWT({ tid: c.tid, scope: c.scope, sid: c.sid, pv: c.pv, roles: c.roles })
    .setProtectedHeader({ alg: ALG, kid: 'access-1' })
    .setSubject(c.sub)
    .setIssuer(ISS)
    .setAudience(AUD)
    .setIssuedAt()
    .setExpirationTime(env.accessTokenTtl)
    .sign(priv)
}

export async function verifyAccessToken(token: string): Promise<AccessClaims> {
  const { pub } = await loadKeys()
  const { payload } = await jwtVerify(token, pub, { issuer: ISS, audience: AUD, algorithms: [ALG] })
  return {
    sub: String(payload.sub),
    tid: String(payload.tid),
    scope: payload.scope as 'tenant' | 'platform',
    sid: String(payload.sid),
    pv: Number(payload.pv),
    roles: (payload.roles as string[]) ?? [],
  }
}

export const newRefreshToken = () => randomBytes(32).toString('base64url')
