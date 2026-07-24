FROM node:22-alpine AS base

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && corepack prepare pnpm@latest --activate
RUN pnpm install --frozen-lockfile

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN corepack enable && corepack prepare pnpm@latest --activate
RUN pnpm exec prisma generate
RUN pnpm build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
# Prisma CLI (+engines) as a self-contained tree so `migrate deploy` runs on boot.
# Installed via `npm --prefix` rather than copied from the pnpm builder, whose
# node_modules are symlinks into .pnpm/ that don't survive a COPY into the
# standalone image. Keep this version in sync with `prisma` in package.json.
RUN npm install prisma@6.19.3 --no-save --prefix /opt/prisma-cli
EXPOSE 3000
# Next.js standalone binds to $HOSTNAME (the container IP), not localhost. This
# gives the container a real health status so a rolling deploy waits for the new
# container to serve before the old one is removed — a bad build fails the deploy
# instead of taking prod down.
HEALTHCHECK --interval=15s --timeout=5s --start-period=45s --retries=3 \
  CMD ["node", "-e", "fetch('http://'+process.env.HOSTNAME+':'+(process.env.PORT||3000)+'/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
# Apply pending migrations before serving. Fails fast (and the deploy fails)
# if a migration errors, rather than serving against a stale schema.
CMD ["sh", "-c", "node /opt/prisma-cli/node_modules/prisma/build/index.js migrate deploy && node server.js"]
