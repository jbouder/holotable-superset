# Build context: poc/ (the npm workspace root).
FROM node:22.22-alpine
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY spec/package.json spec/
COPY api/package.json api/
RUN npm ci --workspace @poc/api --include-workspace-root=false --omit=dev --no-audit --no-fund
COPY spec spec
COPY api api
WORKDIR /app/api
USER node
EXPOSE 8000
CMD ["npx", "tsx", "src/server.ts"]
