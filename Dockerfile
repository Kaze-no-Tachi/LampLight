# syntax=docker/dockerfile:1

# Two runnable targets are built from this file:
#
#   runner    the application. Ships the Next.js standalone output only, runs
#             as a non-root user, and contains no build toolchain and no
#             migration tooling.
#
#   migrator  a short-lived image carrying tsx, the Drizzle CLI dependencies,
#             and drizzle/. Run as `docker compose run --rm migrate`.
#
# Keeping migrations out of the runner is the point, not an accident. If the
# app applied migrations on boot, two replicas starting together would race the
# migration table, and a rollback would mean a container downgrading a schema
# the other replica is still using. Migrations are a deliberate, separate,
# single-instance step.

ARG NODE_VERSION=22-alpine

# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS base
WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

# ---------------------------------------------------------------------------
# Full dependency tree, including dev, shared by the build and migrator stages.
FROM base AS deps
COPY package.json pnpm-lock.yaml .npmrc ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Next.js reads NODE_ENV at build time to decide on optimisations.
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# ---------------------------------------------------------------------------
# Migration and seed tooling. Never exposed to traffic, never long-lived.
FROM base AS migrator
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json drizzle.config.ts ./
COPY drizzle ./drizzle
COPY src ./src
COPY tsconfig.json ./
RUN addgroup -g 1001 -S nodejs && adduser -u 1001 -S migrator -G nodejs
USER migrator
# Invoked through the local tsx binary rather than `pnpm db:migrate`. Corepack
# ships as a shim, so calling pnpm here made the container download the package
# manager from npmjs on every run, which means a deploy-time network dependency
# on a step that only needs to reach Postgres. Migrations must not fail because
# a registry is slow.
CMD ["node_modules/.bin/tsx", "src/db/migrate.ts"]

# ---------------------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# wget is used by HEALTHCHECK. It is already in the alpine base, so this
# installs nothing, but the dependency is worth stating.
RUN addgroup -g 1001 -S nodejs && adduser -u 1001 -S nextjs -G nodejs

COPY --from=builder /app/public ./public
# The standalone server writes nothing to disk at runtime, so everything stays
# owned by root and readable by nextjs. Nothing in the image is writable by the
# user the process runs as.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

# The probe checks database reachability, not just that the port is open, so a
# container whose database has gone away is reported unhealthy rather than
# silently serving errors.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]
