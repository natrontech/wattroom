# WattRoom Architecture

The one-page mental model. The founding decisions live in [WATTROOM.md](../WATTROOM.md); the research behind them in [RESEARCH.md](RESEARCH.md); changes since in [decisions/](decisions/).

```
+---------------------+       WebSocket        +---------------------------+
|  Client (SvelteKit) | <--------------------> |  wattroom-server (Go)     |
|                     |  /ws/rooms/{code}      |                           |
|  - Web Bluetooth    |  metrics up,           |  - REST /api/*            |
|    trainer drivers  |  1 Hz ticks down       |  - hub: goroutine/room    |
|  - Workout engine   |                        |  - serves embedded SPA    |
|  - YT IFrame player |       WebRTC (SFU)     |  - /metrics (Prometheus)  |
|  - LiveKit SDK      | <--------------------> |                           |
+---------------------+   voice/video/screen   |  PostgreSQL     LiveKit   |
                                                +---------------------------+
```

## The three load-bearing seams

**1. The client owns the trainer.** ERG targets are computed and written to the trainer locally — a network hiccup never drops your watts mid-interval. Three drivers behind one `Trainer` interface: `FtmsTrainer` (standard, Kickr Core etc.), `WcpsTrainer` (Wahoo legacy — Kickr v2), `SimulatedTrainer` (dev/CI, no hardware). Trainer control-point writes are strictly serialized behind their response indications — both protocols reject concurrent writes.

**2. The server owns shared truth, in memory.** One goroutine per room holds membership, the synchronized interval timer, jukebox queue+position, and game-mode state. Riders send ~1 Hz samples; the hub coalesces **all riders into one tick message per room per second** (n in, 1 out — never n²), bursting to 4 Hz during sprint moments. Room state never touches the database; if the process restarts, live rooms re-form from reconnecting clients (which hold the ride data — see seam 3).

**3. Postgres owns durable data only.** Users, rooms, workouts, and completed rides (summary columns + the raw 1 Hz stream as one compressed blob per ride, ~50 KB/h). Rides survive anything: samples stream to the server *and* buffer in IndexedDB with sequence numbers; either side can reconstruct after a crash. Stats (power curve, execution score, medals, XP) are computed server-side on ride completion, in one transaction.

## The WS protocol

Defined once as Go structs in [`server/internal/protocol/`](../server/internal/protocol/); `make protocol` generates `web/src/lib/protocol.ts` via tygo. JSON on the wire (readable in devtools). Never edit the TS file by hand.

## Game modes

A mode = a rule module plugged into the room hub: the workout engine keeps producing targets; the mode adds per-tick rule evaluation (eliminations, lives, scores), UI states, and an end condition. Everything is %FTP-relative. Elimination modes give a 30 s reconnect grace window.

## What deliberately doesn't exist (yet)

- **No Redis/NATS** — one instance handles hundreds of rooms; revisit when it measurably can't.
- **No job queue** — ride-completion stats are <100 ms of math in the request path.
- **No ORM, no framework** — sqlc + pgx + net/http.
- **No iOS path** — Web Bluetooth is Chromium-only and Safari refuses; locked decision.

## Deployment

Single Go binary with the SPA embedded (`make build`). Production is deliberately boring ([ADR-0002](decisions/0002-single-vm-compose-deploy.md)): **one VM, one docker compose stack** — wattroom-server, Postgres, LiveKit (host network — WebRTC UDP is trivial on a VM, awkward on k8s), Caddy for TLS. Deploy = pull + `docker compose up -d`; backups = `pg_dump` cron. Prod looks like the dev compose file on purpose. Local dev: `make infra` + two hot-reload processes.
