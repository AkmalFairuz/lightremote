# syntax=docker/dockerfile:1

FROM --platform=$BUILDPLATFORM node:22-alpine3.24 AS frontend
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY frontend/ ./
ENV VITE_DESKTOP=false
RUN npm run build

FROM --platform=$BUILDPLATFORM golang:1.26-alpine3.24 AS backend
WORKDIR /src
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY cmd/ ./cmd/
COPY internal/ ./internal/
ARG TARGETOS
ARG TARGETARCH
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build -trimpath -buildvcs=false -ldflags="-s -w" -o /out/lightremote ./cmd/lightremote

FROM alpine:3.24 AS runtime
RUN apk add --no-cache ca-certificates \
    && addgroup -S -g 10001 lightremote \
    && adduser -S -D -H -u 10001 -G lightremote lightremote \
    && mkdir -p /app/frontend /data \
    && chown 10001:10001 /data
WORKDIR /app
COPY --from=backend /out/lightremote /usr/local/bin/lightremote
COPY --from=frontend /src/frontend/dist/ /app/frontend/
ENV LISTEN_ADDR=:8080 \
    LOCAL_MODE=false \
    DATABASE_DRIVER=sqlite \
    SQLITE_PATH=/data/lightremote.db \
    FRONTEND_DIR=/app/frontend
USER 10001:10001
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD wget -q -T 4 -O /dev/null http://127.0.0.1:8080/healthz || exit 1
ENTRYPOINT ["/usr/local/bin/lightremote"]
