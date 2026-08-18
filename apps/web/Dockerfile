# syntax=docker/dockerfile:1

FROM node:24.14.0-alpine3.23 AS frontend-deps
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/web/package.json ./apps/web/package.json
COPY apps/admin/package.json ./apps/admin/package.json
COPY packages/camp-client ./packages/camp-client
COPY packages/contracts ./packages/contracts
COPY packages/ui ./packages/ui
RUN npm ci --include-workspace-root --workspace @panshi/web --workspace @panshi/admin --workspace @panshi/camp-client --workspace @panshi/contracts --workspace @panshi/ui
RUN npm run build -w @panshi/camp-client

FROM frontend-deps AS web-build
COPY apps/web ./apps/web
ARG VITE_API_BASE_URL=
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
RUN npm run build -w @panshi/web

FROM frontend-deps AS admin-build
COPY apps/admin ./apps/admin
ARG VITE_API_BASE_URL=
ARG VITE_PUBLIC_WEB_BASE_URL=
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_PUBLIC_WEB_BASE_URL=${VITE_PUBLIC_WEB_BASE_URL}
RUN npm run build -w @panshi/admin -- --base=/admin/

FROM nginxinc/nginx-unprivileged:1.29.4-alpine3.23 AS production
COPY deploy/nginx.conf /etc/nginx/nginx.conf
COPY --from=web-build /app/apps/web/dist /usr/share/nginx/html
COPY --from=admin-build /app/apps/admin/dist /usr/share/nginx/html/admin
EXPOSE 8080
