# syntax=docker/dockerfile:1
FROM node:24.11.1-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src

FROM dependencies AS development
COPY test ./test
RUN groupadd --gid 10001 ordivant && useradd --uid 10001 --gid 10001 --create-home ordivant \
    && mkdir -p /data /app/dist && chown -R ordivant:ordivant /app /data
USER 10001:10001
ENV ORDIVANT_DATA_DIR=/data ORDIVANT_RUNTIME_HOST=0.0.0.0
EXPOSE 8090
CMD ["sh", "-c", "npm run build && (./node_modules/.bin/tsc --watch --preserveWatchOutput &) && node --watch dist/server.js --dispatcher"]

FROM dependencies AS build
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

FROM node:24.11.1-bookworm-slim AS production
WORKDIR /app
RUN groupadd --gid 10001 ordivant && useradd --uid 10001 --gid 10001 --create-home ordivant \
    && mkdir /data && chown ordivant:ordivant /app /data
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
USER 10001:10001
ENV NODE_ENV=production ORDIVANT_DATA_DIR=/data ORDIVANT_RUNTIME_HOST=0.0.0.0
EXPOSE 8090
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=5 CMD node -e "fetch('http://127.0.0.1:8090/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js", "--dispatcher"]
