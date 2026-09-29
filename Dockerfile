# syntax=docker/dockerfile:1
# Multi-stage: SPA build -> Go build with the SPA embedded -> distroless (#36).
# Build stages run on $BUILDPLATFORM and cross-compile — no QEMU emulation,
# and the SPA (arch-independent) builds once instead of once per arch.
#
# Every FROM is pinned by its multi-arch index digest (#2866, ADR-0054
# amended): the node and golang stages produce the SPA and the binary that
# ship, so a tag moved upstream would reach production with nothing in this
# repository changing. Dependabot moves the digests monthly. A new node or
# golang tag stays a human's edit — the Node major tracks ci.yml's `web` job
# and the Go version tracks go.mod.
FROM --platform=$BUILDPLATFORM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS web
RUN corepack enable
WORKDIR /src/web
# pnpm-workspace.yaml is part of the install's input, not a convenience:
# pnpm 12 stopped reading package.json's `pnpm` field, so `overrides` — the
# security floors from #131 — live here now. Without it the image installs
# without them while the lockfile records them, and --frozen-lockfile refuses
# (ERR_PNPM_LOCKFILE_CONFIG_MISMATCH). It also carries onlyBuiltDependencies,
# which pnpm 12 makes fatal rather than a warning (#2402).
COPY web/package.json web/pnpm-lock.yaml web/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY web/ ./
# Served at /changelog.md so the app can show what this build changed (#345).
COPY CHANGELOG.md ./static/changelog.md
RUN pnpm build

FROM --platform=$BUILDPLATFORM golang:1.26-alpine@sha256:8ac98ca534ac3f51e1f420a1dd2c15e74c75cfa0f23f3ad27eb5d7236c349a0c AS server
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

FROM gcr.io/distroless/static-debian12:nonroot@sha256:afa5c872c891853ca7fcf1f12c3edb23f7eeef36189728842dd51042ff57f7ab
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
