import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))

export const env = {
  port: Number(process.env.PORT ?? 4100),
  host: process.env.HOST ?? '127.0.0.1',
  nodeEnv: process.env.NODE_ENV ?? 'development',
  keyDir: process.env.BROLLY_KEY_DIR ?? path.resolve(HERE, '../../../.data/keys'),
  /** Where signed media links would point. Swapped for a real CDN host in prod. */
  cdnBase: process.env.CDN_BASE ?? 'https://cdn.brollyjuniors.test',
  mediaSigningKey: process.env.MEDIA_SIGNING_KEY ?? 'dev-only-media-key-change-me',
  mediaUrlTtlSeconds: 900,
  accessTokenTtl: '10m',
  refreshTokenDays: 30,
  staffRefreshHours: 12,
  cookieName: 'brolly_b2c_rt',
  isProd: (process.env.NODE_ENV ?? 'development') === 'production',
}
