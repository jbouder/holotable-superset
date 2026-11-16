# Build context: poc/ (the npm workspace root).
FROM node:22.22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY spec/package.json spec/
COPY ui/package.json ui/
RUN npm ci --workspace @poc/ui --no-audit --no-fund
COPY spec spec
COPY ui ui
RUN npm run build -w @poc/ui

FROM nginx:1.29-alpine
COPY ui/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/ui/dist /usr/share/nginx/html
EXPOSE 3000
