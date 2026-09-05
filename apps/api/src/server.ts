import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import { driverName, closeDb } from '@brolly/db'
import { env } from './env.ts'
import { HttpError, problem } from './http.ts'
import { registerGuards } from './guards.ts'
import authRoutes from './routes/auth.ts'
import meRoutes from './routes/me.ts'
import platformRoutes from './routes/platform.ts'
import schoolRoutes from './routes/school.ts'
import teacherRoutes from './routes/teacher.ts'
import studentRoutes from './routes/student.ts'

const app = Fastify({
  logger: { level: env.isProd ? 'info' : 'warn' },
  genReqId: () => Math.random().toString(36).slice(2, 12),
  trustProxy: true,
})

await app.register(cookie)
await app.register(cors, {
  // Allow-listed, never reflected, and credentials on so the refresh cookie works.
  origin: env.isProd ? [process.env.WEB_ORIGIN ?? 'https://app.brollyjuniors.com'] : true,
  credentials: true,
})

// Security headers. The web app is served separately in dev; in production the
// same set belongs on the static host too.
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
  const anyErr = err as any
  const status = anyErr.status ?? anyErr.statusCode ?? 500
  const code = anyErr.code && typeof anyErr.code === 'string' && status !== 500 ? anyErr.code : httpCode(status)

  if (status >= 500) {
    req.log.error({ err: anyErr, url: req.url, tenant: (req as any).access?.tenantId }, 'request failed')
  }
  const detail = status >= 500
    ? 'Something went wrong at our end. Try again in a moment.'
    : String(anyErr?.message ?? 'Unexpected error')
  reply.status(status).type('application/problem+json').send(problem(status, code, detail, String(req.id)))
})

app.setNotFoundHandler({ preHandler: undefined }, (req, reply) => {
  reply.status(404).type('application/problem+json')
    .send(problem(404, 'not_found', 'No such endpoint.', String(req.id)))
})


await app.register(authRoutes)
await app.register(meRoutes)
await app.register(platformRoutes)
await app.register(schoolRoutes)
await app.register(teacherRoutes)
await app.register(studentRoutes)

app.get('/health', { config: { public: true } }, async () => ({ ok: true, driver: driverName }))

function httpCode(status: number) {
  return ({ 400: 'bad_request', 401: 'unauthenticated', 403: 'forbidden', 404: 'not_found', 409: 'conflict', 423: 'locked', 429: 'rate_limited' } as Record<number, string>)[status] ?? 'internal_error'
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    await app.close()
    await closeDb()
    process.exit(0)
  })
}

await app.listen({ port: env.port, host: env.host })
console.log(`\n  Brolly API   http://${env.host}:${env.port}   (db driver: ${driverName})\n`)

export { app, HttpError }
