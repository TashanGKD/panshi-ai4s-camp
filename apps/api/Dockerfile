# syntax=docker/dockerfile:1

FROM node:24.14.0-alpine3.23 AS api-build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY packages/contracts ./packages/contracts
RUN npm ci --include-workspace-root --workspace @panshi/api --workspace @panshi/contracts
COPY apps/api ./apps/api
RUN npm run build -w @panshi/api \
  && npm exec -- tsc --project apps/api/tsconfig.json --noEmit false --outDir apps/api/dist --rootDir apps/api \
  && cp -R apps/api/drizzle apps/api/dist/drizzle \
  && mkdir -p apps/api/dist/src/data \
  && cp -R apps/api/src/data/. apps/api/dist/src/data/ \
  && npm prune --omit=dev --ignore-scripts

FROM node:24.14.0-alpine3.23 AS production
ENV NODE_ENV=production
WORKDIR /app
COPY --from=api-build /app/node_modules ./node_modules
COPY --from=api-build /app/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=api-build /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=api-build /app/apps/api/package.json ./apps/api/package.json
COPY --from=api-build /app/apps/api/dist ./apps/api/dist
RUN mkdir -p /data/uploads /backups && chown -R node:node /data /backups
USER node
EXPOSE 3001
CMD ["node", "apps/api/dist/src/server.js"]
