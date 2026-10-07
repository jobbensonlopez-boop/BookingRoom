# Production image: the API serves the built web app from the same origin.
# Every setting is an environment variable read at runtime (see docs/azure-deployment.md),
# so one image works for any environment.

# ---- Build: install all dependencies and build the web app ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY shared shared
COPY web web
RUN npm run build -w web

# ---- Runtime: server dependencies only ----
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev -w server && npm cache clean --force
COPY shared shared
COPY server/src server/src
COPY server/tsconfig.json server/
COPY db db
COPY --from=build /app/web/dist web/dist

ENV PORT=8080 \
    STATIC_DIR=/app/web/dist \
    RUN_MIGRATIONS=true
EXPOSE 8080
USER node
WORKDIR /app/server
CMD ["node", "--import", "tsx", "src/index.ts"]
