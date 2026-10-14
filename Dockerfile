# syntax=docker/dockerfile:1.7
# Workspace OS: one image serving the API and the built PWA.

# ---------- build ----------
FROM node:22-bookworm-slim AS build
ENV CI=true
RUN corepack enable
WORKDIR /repo

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile

COPY packages packages
COPY apps apps
ARG GIT_SHA=dev
ENV GIT_SHA=${GIT_SHA}
RUN pnpm --filter @wos/web build && pnpm --filter @wos/server build

# Minimal production manifest: only the server's third-party runtime dependencies.
RUN node -e "const p=require('./apps/server/package.json');const d={...p.dependencies};delete d['@wos/shared'];require('fs').writeFileSync('/runtime-package.json',JSON.stringify({name:'wos-runtime',version:p.version,private:true,type:'module',dependencies:d},null,2))"

# ---------- runtime deps (native modules come as prebuilt binaries) ----------
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY --from=build /runtime-package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund --ignore-scripts=false \
 && npm cache clean --force

# ---------- runtime ----------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    APP_PORT=3000 \
    APP_HOST=0.0.0.0 \
    DATABASE_PATH=/data/workspace.sqlite \
    BACKUP_DIR=/backups \
    WEB_DIST_DIR=/app/web
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./package.json
COPY --from=build /repo/apps/server/dist ./dist
COPY --from=build /repo/apps/web/dist ./web
RUN mkdir -p /data /backups && chown -R node:node /data /backups /app
USER node
VOLUME ["/data", "/backups"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.APP_PORT||3000)+'/api/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
