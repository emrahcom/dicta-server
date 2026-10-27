# The server with the built dicta-js; see specs/architecture.md (Docker image).

FROM node:24-slim AS dicta-js
ARG DICTA_JS_VERSION
RUN test -n "$DICTA_JS_VERSION" || (echo "DICTA_JS_VERSION is required" && false)
WORKDIR /dicta-js
ADD https://github.com/emrahcom/dicta-js.git#${DICTA_JS_VERSION} .
RUN npm ci && npm run build

FROM node:24-slim
ARG DICTA_JS_VERSION
LABEL dicta-js.version=$DICTA_JS_VERSION
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src/ src/
COPY --from=dicta-js /dicta-js/dist/ js/
USER node
EXPOSE 8080
CMD ["node", "src/index.ts"]
