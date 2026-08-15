# syntax=docker/dockerfile:1

FROM node:24-alpine AS frontend-deps
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/web/package.json ./apps/web/package.json
COPY apps/admin/package.json ./apps/admin/package.json
COPY packages/contracts ./packages/contracts
COPY packages/ui ./packages/ui
RUN npm ci --workspace @panshi/web --workspace @panshi/admin --workspace @panshi/contracts --workspace @panshi/ui

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

FROM nginx:1.27-alpine AS production
COPY deploy/nginx.conf /etc/nginx/nginx.conf
COPY --from=web-build /app/apps/web/dist /usr/share/nginx/html
COPY --from=admin-build /app/apps/admin/dist /usr/share/nginx/html/admin
EXPOSE 8080
