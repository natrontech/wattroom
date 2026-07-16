# WattRoom

> Train together, not alone.

WattRoom is a collaborative indoor cycling app — "Discord for indoor cycling". No virtual world, no avatars: structured workouts with precise smart-trainer control (BLE FTMS + Wahoo legacy), shared **rooms** where everyone's live watts and heart rate are on one dashboard, always-on voice and camera (LiveKit), a synced YouTube jukebox, and a game layer (Backyard Ramp, Watt Golf, Sprint Roulette, …) that makes suffering together fun.

**Status: pre-alpha.** The [north star](WATTROOM.md) is written and researched; the code is being built milestone by milestone.

## Why

Indoor training is boring alone. Zwift fixes that with a game world; WattRoom fixes it with **presence** — you hop into a room with your training buddies, everyone rides the same relative workout at their own FTP, you talk, you see each other, you share music. Like a group ride in a pain cave.

## Stack

Go server (in-memory room hub, one goroutine per room) · SvelteKit SPA (Web Bluetooth for FTMS/HR/power) · PostgreSQL · LiveKit (self-hosted WebRTC) · single binary with embedded frontend · Kubernetes-native deploy.

Every architecture and product decision is recorded in [WATTROOM.md](WATTROOM.md) (the founding document) and [docs/decisions/](docs/decisions/) (everything since). The research behind them: [docs/RESEARCH.md](docs/RESEARCH.md).

## Quick start (dev)

Requirements: Go 1.26+, Node 22+, pnpm, Docker.

```sh
make infra        # Postgres + LiveKit (dev mode) in containers
make dev-server   # terminal 1: Go server with hot reload on :8080
make dev-web      # terminal 2: Vite dev server on :5173 (proxies /api + /ws)
```

No smart trainer needed — the simulated trainer (M0) covers development. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Browser support

Web Bluetooth is Chromium-only: **Chrome/Edge on desktop and Android**. There is no iOS path (Safari has stated it will not implement Web Bluetooth) — that's a deliberate, researched decision, not an oversight. The read-only room spectator view works in any mobile browser.

## License

[AGPL-3.0](LICENSE)
