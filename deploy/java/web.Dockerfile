FROM node:24.11.0-alpine AS build
WORKDIR /build
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
COPY apps/web-vue/package.json apps/web-vue/pnpm-lock.yaml apps/web-vue/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY apps/web-vue/ ./
RUN pnpm build
FROM nginx:1.28.0-alpine
COPY deploy/java/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /build/dist /usr/share/nginx/html
