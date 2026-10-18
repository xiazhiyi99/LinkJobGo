FROM node:22-bookworm-slim AS build
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
COPY apps/extension ./apps/extension
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_BASE_PATH=""
ARG NEXT_PUBLIC_SESSION_COOKIE_NAME=lingke_session
ARG NEXT_PUBLIC_CAPTCHA_PROVIDER
ARG NEXT_PUBLIC_ALIYUN_CAPTCHA_REGION
ARG NEXT_PUBLIC_ALIYUN_CAPTCHA_PREFIX
ARG NEXT_PUBLIC_ALIYUN_CAPTCHA_SCENE_ID
ARG EXTENSION_API_ORIGIN=https://linkaigo.com
ARG EXTENSION_API_PATH_PREFIX=/api
ARG EXTENSION_LOGIN_URL=https://linkaigo.com/login
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} NEXT_PUBLIC_BASE_PATH=${NEXT_PUBLIC_BASE_PATH} NEXT_PUBLIC_SESSION_COOKIE_NAME=${NEXT_PUBLIC_SESSION_COOKIE_NAME}
ENV NEXT_PUBLIC_CAPTCHA_PROVIDER=${NEXT_PUBLIC_CAPTCHA_PROVIDER} NEXT_PUBLIC_ALIYUN_CAPTCHA_REGION=${NEXT_PUBLIC_ALIYUN_CAPTCHA_REGION} NEXT_PUBLIC_ALIYUN_CAPTCHA_PREFIX=${NEXT_PUBLIC_ALIYUN_CAPTCHA_PREFIX} NEXT_PUBLIC_ALIYUN_CAPTCHA_SCENE_ID=${NEXT_PUBLIC_ALIYUN_CAPTCHA_SCENE_ID}
ENV EXTENSION_API_ORIGIN=${EXTENSION_API_ORIGIN} EXTENSION_API_PATH_PREFIX=${EXTENSION_API_PATH_PREFIX} EXTENSION_LOGIN_URL=${EXTENSION_LOGIN_URL}
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @job-assistant/web build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000 NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
