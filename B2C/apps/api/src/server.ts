import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import { driverName, closeDb } from '@brolly/b2c-db'
import { env } from './env.ts'
import { problem } from './http.ts'
import { registerGuards } from './guards.ts'
import authRoutes from './routes/auth.ts'
import catalogRoutes from './routes/catalog.ts'
import studentRoutes from './routes/student.ts'
import teacherRoutes from './routes/teacher.ts'
import adminRoutes from './routes/admin.ts'

const app = Fastify({
  logger: { level: env.isProd ? 'info' : 'warn' },
  genReqId: () => Math.random().toString(36).slice(2, 12),
  trustProxy: true,
})

await app.register(cookie)
await app.register(cors, {
  origin: env.isProd ? [process.env.WEB_ORIGIN ?? 'https://brollyjuniors.com'] : true,
  credentials: true,
})

app.addHook('onSend', async (_req, reply, payload) => {
  reply.header('X-Content-Type-Options', 'nosniff')
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin')
  reply.header('X-Frame-Options', 'DENY')
  reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  if (env.isProd) reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  return payload
})

registerGuards(app)

// Installed BEFORE routes: `await app.register()` boots each plugin immediately,
// and a child context captures whatever error handler exists at that moment.
app.setErrorHandler((err, req, reply) => {
  const e = err as any
  const status = e.status ?? e.statusCode ?? 500
  const code = typeof e.code === 'string' && status !== 500 ? e.code : httpCode(status)
  if (status >= 500) req.log.error({ err: e, url: req.url, user: (req as any).access?.userId }, 'request failed')
  const detail = status >= 500
    ? 'Something went wrong at our end. Try again in a moment.'
    : String(e?.message ?? 'Unexpected error')
  reply.status(status).type('application/problem+json').send(problem(status, code, detail, String(req.id)))
})

app.setNotFoundHandler({ preHandler: undefined }, (req, reply) => {
  reply.status(404).type('application/problem+json')
    .send(problem(404, 'not_found', 'No such endpoint.', String(req.id)))
})

function httpCode(status: number) {
  return ({ 400: 'bad_request', 401: 'unauthenticated', 403: 'forbidden', 404: 'not_found',
    409: 'conflict', 423: 'locked', 429: 'rate_limited' } as Record<number, string>)[status] ?? 'internal_error'
}

await app.register(authRoutes)
await app.register(catalogRoutes)
await app.register(studentRoutes)
await app.register(teacherRoutes)
await app.register(adminRoutes)

app.get('/health', { config: { public: true } }, async () => ({ ok: true, driver: driverName }))

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => { await app.close(); await closeDb(); process.exit(0) })
}

await app.listen({ port: env.port, host: env.host })
console.log(`\n  Brolly Juniors B2C API   http://${env.host}:${env.port}   (db driver: ${driverName})\n`)

export { app }
