FROM node:24-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS development
WORKDIR /app
COPY . .
ARG PRODUCT_MODE=suite
ENV PRODUCT_MODE=${PRODUCT_MODE} \
    VITE_API_TARGET=http://work-api:8000 \
    VITE_KNOWLEDGE_API_TARGET=http://knowledge-api:8010 \
    VITE_CODE_API_TARGET=http://code-api:8020 \
    VITE_IDENTITY_API_TARGET=http://identity-api:8030 \
    VITE_WATCH_USEPOLLING=true \
    VITE_WATCH_INTERVAL=1000 \
    ORDIVANT_DEV_PROXY_TOKEN_FILE=/run/secrets/dev_proxy_token
EXPOSE 5173
CMD ["sh", "-c", "npm run dev -- --host 0.0.0.0 --mode \"$PRODUCT_MODE\""]

FROM dependencies AS build
WORKDIR /app
COPY . .
ARG PRODUCT_MODE=suite
ARG STATIC_DIST=dist/${PRODUCT_MODE}
RUN mkdir -p .cache && case "$PRODUCT_MODE" in suite|work|knowledge|code) npm run "build:$PRODUCT_MODE" ;; *) echo "Unsupported PRODUCT_MODE: $PRODUCT_MODE" >&2; exit 2 ;; esac

FROM nginx:1.27-alpine AS production
ARG PRODUCT_MODE=suite
ARG STATIC_DIST=dist/${PRODUCT_MODE}
COPY --from=build /app/${STATIC_DIST}/ /usr/share/nginx/html/
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
ENV API_UPSTREAM=http://work-api:8000 \
    KNOWLEDGE_UPSTREAM=http://knowledge-api:8010 \
    CODE_UPSTREAM=http://code-api:8020 \
    IDENTITY_UPSTREAM=http://identity-api:8030 \
    NGINX_ENVSUBST_FILTER='API_UPSTREAM|KNOWLEDGE_UPSTREAM|CODE_UPSTREAM|IDENTITY_UPSTREAM'
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
