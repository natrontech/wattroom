<div align="center">

# WattRoom

**Train together, not alone.**

Discord for indoor cycling — structured workouts your whole crew rides at once,
with voice, camera, game modes and a shared jukebox.
No virtual world: **your watts are the game.**

[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-8b2bff)](LICENSE)
[![Go](https://img.shields.io/badge/Go-stdlib--first-00ADD8?logo=go&logoColor=white)](server/)
[![Svelte 5](https://img.shields.io/badge/Svelte-5_runes-ff3d8b?logo=svelte&logoColor=white)](web/)
[![LiveKit](https://img.shields.io/badge/AV-LiveKit-8b2bff)](docs/ARCHITECTURE.md)

[Architecture](docs/ARCHITECTURE.md) · [Spec](docs/SPEC.md) ·
[Founding doc](WATTROOM.md) · [Contributing](CONTRIBUTING.md) ·
built by [Natron](https://natron.io)

⭐ **Like the idea? [Star the repo](https://github.com/natrontech/wattroom/stargazers)** — it helps other pain-cave dwellers find it.

<img src="docs/assets/room-live.png" alt="A live WattRoom session: six riders' watts and heart rate on one dashboard, ERG target, interval timeline and execution scores" width="100%" />

</div>

## Why

Indoor training is boring alone. Zwift fixes that with a game world; WattRoom
fixes it with **presence** — you hop into a room with your training buddies,
everyone rides the same workout scaled to their own FTP, you talk, you see each
other, you share music. A group ride for pain caves.

## What's inside

|                                                                                        |                                                                                 |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 🚴 **Rooms** — live watts, HR and cadence on one dashboard, voice & camera always there | 📈 **Structured workouts** — library + editor, precise ERG control over BLE FTMS |
| 🎮 **Seven game modes** — sprint klaxons, eliminations, Watt Golf, Backyard Ramp, …     | 🎵 **Shared jukebox** — one synced YouTube soundtrack per room                   |
| 🔒 **Private by default** — metrics stay in the room, AV never recorded                 | 🆓 **Free & open source** — AGPL, self-hostable as a single binary               |

## Screens

| The landing                                                     | On your phone                                                             |
| :-------------------------------------------------------------: | :-----------------------------------------------------------------------: |
| <img src="docs/assets/landing.png" alt="WattRoom landing page" /> | <img src="docs/assets/landing-mobile.png" alt="WattRoom on mobile" width="280" /> |

## Quick start (dev)

Requirements: Go 1.26+, Node 22+, pnpm, Docker.

```sh
make infra        # Postgres + LiveKit (dev mode) in containers
make dev-server   # terminal 1: Go server with hot reload on :8080
make dev-web      # terminal 2: Vite dev server on :5173 (proxies /api + /ws)
```

No smart trainer needed — the simulated trainer covers development, and
`/dev/room` is a full mock room. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Hardware & browsers

A smart trainer speaking **BLE FTMS** (plus Wahoo legacy), talked to directly
from the browser via Web Bluetooth — which is Chromium-only: **Chrome/Edge on
desktop and Android**. No iOS path (Safari won't implement Web Bluetooth — a
[researched decision](docs/decisions/0004-chrome-first-with-native-escape-hatch.md),
not an oversight); the read-only spectator view works in any browser.

## Stack

Go server (in-memory room hub, one goroutine per room) · SvelteKit SPA ·
PostgreSQL · self-hosted LiveKit · single binary with embedded frontend,
deployed as one compose stack on a single VM. Every product and architecture
decision is recorded in [WATTROOM.md](WATTROOM.md) and
[docs/decisions/](docs/decisions/); the research behind them in
[docs/RESEARCH.md](docs/RESEARCH.md).

## License

[AGPL-3.0](LICENSE) — © [Natron](https://natron.io)
