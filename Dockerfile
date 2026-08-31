# syntax=docker/dockerfile:1
# Multi-stage: SPA build -> Go build with the SPA embedded -> distroless (#36).
# Build stages run on $BUILDPLATFORM and cross-compile — no QEMU emulation,
# and the SPA (arch-independent) builds once instead of once per arch.
FROM --platform=$BUILDPLATFORM node:22-alpine AS web
RUN corepack enable
WORKDIR /src/web
COPY web/package.json web/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY web/ ./
RUN pnpm build

FROM --platform=$BUILDPLATFORM golang:1.26-alpine AS server
WORKDIR /src/server
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/ ./
COPY --from=web /src/web/build ./webdist
ARG TARGETOS TARGETARCH
RUN --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -ldflags "-s -w" -o /wattroom .

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=server /wattroom /wattroom
# ARG lives here so a new SHA only rebuilds this free stage, not the Go compile.
ARG BUILD_SHA=dev
ARG BUILD_VERSION=dev
ENV WATTROOM_BUILD_SHA=$BUILD_SHA
ENV WATTROOM_VERSION=$BUILD_VERSION
ENV WATTROOM_ADDR=:8080
EXPOSE 8080
ENTRYPOINT ["/wattroom"]
