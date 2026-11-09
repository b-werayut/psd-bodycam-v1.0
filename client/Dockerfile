# syntax=docker/dockerfile:1
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Optional build-time overrides (VITE_API_BASE defaults to /api, i.e. same origin through the proxy below)
ARG VITE_API_BASE
RUN npm run build

# Stage name "runner" = the buildTarget used by the platform pipeline templates (as in psd-bwc-frontend).
FROM nginx:1.30.6-alpine3.24 AS runner
RUN apk upgrade --no-cache && rm -rf /usr/share/nginx/html/*
# Rendered by the image entrypoint (envsubst) into /etc/nginx/conf.d/default.conf at start
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY docker-entrypoint.d/15-require-backend-url.sh /docker-entrypoint.d/
COPY --from=build /app/dist /usr/share/nginx/html
# Unprivileged runtime: no capabilities needed (port 8080). conf.d must be writable by nginx
# because the entrypoint writes the rendered template there.
RUN chmod 0755 /docker-entrypoint.d/15-require-backend-url.sh \
 && touch /var/run/nginx.pid \
 && chown -R nginx:nginx /var/run/nginx.pid /var/cache/nginx /var/log/nginx /etc/nginx/conf.d
USER nginx
# Required at runtime: API base URL without path, e.g. http://<api-service>.team3.svc:3000
# (no default on purpose: the container refuses to start without it)
ENV BACKEND_URL=""
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
