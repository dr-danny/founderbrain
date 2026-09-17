FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
ENV ESBUILD_BINARY_PATH=/app/node_modules/esbuild-wasm/bin/esbuild
RUN npm run fb:build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production TZ=UTC PORT=8080
COPY deploy/railway/package.json deploy/railway/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist/founderbrain-server ./
USER node
EXPOSE 8080
CMD ["node", "src/founderbrain/main.js"]
