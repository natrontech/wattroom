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
# Served at /changelog.md so the app can show what this build changed (#345).
COPY CHANGELOG.md ./static/changelog.md
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
# The mount points for the two things the server writes (#1730). A named
# volume takes its ownership from the image path it covers, and distroless
# has no /data — so without these the volume is created root:root, the
# non-root server cannot write a byte into it, and nothing says so: the
# container is healthy and the writes fail one at a time inside the handler
# that tried them. Made here because the final stage has no shell to mkdir with.
RUN mkdir -p /mountpoints/data/tracks /mountpoints/data/feedback

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=server /wattroom /wattroom
# 65532 is distroless's `nonroot`, the uid this image runs as.
COPY --from=server --chown=65532:65532 /mountpoints/data /data
# ARG lives here so a new SHA only rebuilds this free stage, not the Go compile.
ARG BUILD_SHA=dev
ARG BUILD_VERSION=dev
ENV WATTROOM_BUILD_SHA=$BUILD_SHA
ENV WATTROOM_VERSION=$BUILD_VERSION
ENV WATTROOM_ADDR=:8080
EXPOSE 8080
ENTRYPOINT ["/wattroom"]
