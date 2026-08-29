# Multi-stage: SPA build -> Go build with the SPA embedded -> distroless (#36).
FROM node:22-alpine AS web
RUN corepack enable
WORKDIR /src/web
COPY web/package.json web/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY web/ ./
RUN pnpm build

FROM golang:1.26-alpine AS server
WORKDIR /src/server
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/ ./
COPY --from=web /src/web/build ./webdist
ARG BUILD_SHA=dev
RUN CGO_ENABLED=0 go build -ldflags "-s -w" -o /wattroom .

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=server /wattroom /wattroom
ENV WATTROOM_ADDR=:8080
EXPOSE 8080
ENTRYPOINT ["/wattroom"]
