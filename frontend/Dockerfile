# syntax=docker/dockerfile:1

# Brolly Juniors B2C — Next.js image.
#
# Three stages: deps installs, builder compiles, runtime carries only the
# standalone output. The runtime has no npm install and no source tree.

# --- deps ------------------------------------------------------------------
FROM node:24-alpine AS deps

WORKDIR /app
# Copied on their own so a source-only change reuses this layer's cache.
COPY package.json package-lock.json ./
RUN npm ci

# --- builder ---------------------------------------------------------------
FROM node:24-alpine AS builder

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# IMPORTANT: rewrites are resolved at BUILD time and written into
# .next/routes-manifest.json, so the API address is baked into the image here
# — setting API_ORIGIN only at runtime would silently keep the default.
# Rebuild the image to point it somewhere else.
ARG API_ORIGIN=http://api:8000
ENV API_ORIGIN=$API_ORIGIN

ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# --- runtime ---------------------------------------------------------------
FROM node:24-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup -g 10001 -S nodejs && adduser -S -u 10001 -G nodejs nextjs

# standalone carries its own minimal server.js and pruned node_modules.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
# Static assets are deliberately not in standalone; they are served from disk.
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
