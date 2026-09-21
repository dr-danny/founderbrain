FROM node:22-bookworm-slim AS build
WORKDIR /app
# Trivy flags npm's bundled tar/pacote/sigstore in node:22; pull current npm first (#45).
RUN npm install -g npm@latest
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
ENV ESBUILD_BINARY_PATH=/app/node_modules/esbuild-wasm/bin/esbuild
RUN npm run fb:build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production TZ=UTC PORT=8080
RUN npm install -g npm@latest
COPY deploy/railway/package.json deploy/railway/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist/founderbrain-server ./
# The voice-samples list and the GHL push both read the vendored v3 values catalog at
# runtime from vendor/growth-engine/... relative to the server source. The image used to
# ship only dist/, so loadValueCatalog() hit ENOENT and every /api/voice-samples GET and
# the push route returned 503 on production while /api/brain stayed healthy.
COPY --from=build /app/vendor ./vendor
USER node
EXPOSE 8080
CMD ["node", "src/founderbrain/main.js"]
