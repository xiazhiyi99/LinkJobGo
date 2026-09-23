FROM node:22-bookworm-slim

WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends poppler-utils unzip openssl \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g pnpm@11.19.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY apps/extension/package.json ./apps/extension/package.json
COPY apps/worker/package.json ./apps/worker/package.json
COPY packages ./packages
RUN pnpm install --frozen-lockfile

COPY apps/api/src ./apps/api/src
RUN pnpm --filter @job-assistant/api exec prisma generate --schema src/prisma/schema.prisma

WORKDIR /app/apps/api
ENV NODE_ENV=production
EXPOSE 3001
CMD ["node", "src/index.js"]
