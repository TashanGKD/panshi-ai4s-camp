# syntax=docker/dockerfile:1

FROM node:24-alpine AS admin-deps
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/admin/package.json ./apps/admin/package.json
COPY packages/contracts ./packages/contracts
COPY packages/ui ./packages/ui
RUN npm ci --include-workspace-root --workspace @panshi/admin --workspace @panshi/contracts --workspace @panshi/ui

FROM admin-deps AS admin-build
COPY apps/admin ./apps/admin
ARG VITE_API_BASE_URL=
ARG VITE_PUBLIC_WEB_BASE_URL=
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_PUBLIC_WEB_BASE_URL=${VITE_PUBLIC_WEB_BASE_URL}
RUN npm run build -w @panshi/admin -- --base=/admin/

FROM scratch AS artifact
COPY --from=admin-build /app/apps/admin/dist /admin
