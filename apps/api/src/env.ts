import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))

export const env = {
  port: Number(process.env.PORT ?? 4000),
  host: process.env.HOST ?? '127.0.0.1',
  nodeEnv: process.env.NODE_ENV ?? 'development',
  /** Where the RS256 signing keypair is kept between restarts. */
  keyDir: process.env.BROLLY_KEY_DIR ?? path.resolve(HERE, '../../../.data/keys'),
  accessTokenTtl: '10m',
  refreshTokenDays: 30,
  staffRefreshTokenHours: 12,
  cookieName: 'brolly_rt',
  isProd: (process.env.NODE_ENV ?? 'development') === 'production',
}
