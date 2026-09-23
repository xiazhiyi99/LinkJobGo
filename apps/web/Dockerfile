FROM node:22-bookworm-slim

WORKDIR /app
RUN npm install -g pnpm@11.19.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/package.json
COPY apps/api/package.json ./apps/api/package.json
COPY apps/extension/package.json ./apps/extension/package.json
COPY apps/worker/package.json ./apps/worker/package.json
COPY packages ./packages
RUN pnpm install --frozen-lockfile

COPY apps/web ./apps/web
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NODE_ENV=production
RUN pnpm --filter @job-assistant/web build

EXPOSE 3000
CMD ["pnpm", "--filter", "@job-assistant/web", "start"]
