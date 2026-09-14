# Two stages so the runtime image carries no build toolchain and no dev
# dependencies. Pinned to node:22 because that is what the project is actually
# developed and tested on — node:sqlite has no native module to compile, which
# is the whole reason this image can be -slim.

FROM node:22-slim AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json ./apps/web/
RUN npm ci

COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
# tsc -b is incremental: a tsbuildinfo that slipped into the context would make
# it emit nothing at all, and the failure only shows up as a missing dist later.
# Vite writes the web build straight into apps/server/public, which is where
# config.ts expects to serve it from.
RUN find . -name '*.tsbuildinfo' -delete && npm run build


FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json ./apps/web/
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/apps/server/dist ./apps/server/dist
COPY --from=builder /app/apps/server/public ./apps/server/public

ENV PORT=3000
ENV DATABASE_PATH=/data/voku.db

# uid 1000 in the official node images, which is also the deploy user on the
# host. Without this the SQLite file lands on the bind mount owned by root and
# the backup script cannot open it.
USER node

EXPOSE 3000
CMD ["node", "apps/server/dist/index.js"]
