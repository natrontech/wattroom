# WattRoom Architecture

The one-page mental model. The founding decisions live in [WATTROOM.md](../WATTROOM.md); the research behind them in [RESEARCH.md](RESEARCH.md); changes since in [decisions/](decisions/).

```
+---------------------+       WebSocket        +---------------------------+
|  Client (SvelteKit) | <--------------------> |  wattroom-server (Go)     |
|                     |  /ws/channels/{id}     |                           |
|  - Web Bluetooth    |  metrics up,           |  - REST /api/*            |
|    trainer drivers  |  1 Hz ticks down       |  - hub: goroutine/channel |
|  - Workout engine   |                        |  - serves embedded SPA    |
|  - YT IFrame player |       WebRTC (SFU)     |  - /metrics (Prometheus)  |
|  - LiveKit SDK      | <--------------------> |                           |
+---------------------+   voice/video/screen   |  PostgreSQL     LiveKit   |
                                                +---------------------------+
```

## The three load-bearing seams

**1. The client owns the trainer.** ERG targets are computed and written to the trainer locally — a network hiccup never drops your watts mid-interval. Two drivers behind one `Trainer` interface: `FtmsTrainer` (standard, Kickr Core etc.) and `SimulatedTrainer` (dev/CI, no hardware); `WcpsTrainer` for the pre-FTMS Kickr v2 is backlog (#4, [ADR-0007](decisions/0007-alpha-hardware-is-all-ftms.md)), so a CPS-only unit gets an empty chooser today. Trainer control-point writes are strictly serialized behind their response indications — both protocols reject concurrent writes.

**2. The server owns shared truth, in memory.** One goroutine per voice channel holds who is in it, the jukebox queue+position, and the running session — its synchronized interval timer and game-mode state, at most one per voice channel ([ADR-0058](decisions/0058-the-room-dissolves-into-the-crew.md)). Riders send ~1 Hz samples; the hub coalesces **all riders into one tick message per voice channel per second** (n in, 1 out — never n²), bursting to 4 Hz during sprint moments. Live state never touches the database; if the process restarts, live channels re-form from reconnecting clients (which hold the ride data — see seam 3).

**3. Postgres owns durable data only.** Users, crews and their channels, workouts, and completed rides (summary columns + the raw 1 Hz stream as one compressed blob per ride, ~50 KB/h). Rides survive anything: samples stream to the server _and_ buffer in IndexedDB with sequence numbers; either side can reconstruct after a crash — though a session ride the server loses comes back from the browser as a `.fit`, not as a saved ride ([ADR-0052](decisions/0052-a-room-ride-the-server-loses-comes-back-from-the-browser.md)): the hub writes nothing about a session until the session closes. Stats (power curve, execution score, medals, XP) are computed server-side on ride completion, in one transaction.

**The crew** is the only object with an identity ([ADR-0058](decisions/0058-the-room-dissolves-into-the-crew.md), which took the room apart and superseded most of [ADR-0038](decisions/0038-the-crew-is-the-layer-above-rooms.md)): `crews` (name, icon, picture, owner, a six-character join code), `crew_roles` (member / admin / banned — membership is a row, the owner holds none), and below it `channels`, text or voice — a name, an order and a gate, `private`, with `channel_members` naming whom a private channel admits. A channel belongs to one crew for good and has no owner. The crew itself carries nothing live: the hub holds voice channels, a session is live state inside one, and so the hub never sees a crew. **May this rider enter that channel** is answered in exactly one place, `mayEnter` in [`channels/access.go`](../server/internal/channels/access.go) — the crew's owner and admins enter every channel, a member enters an open one or a private one they are named into, a banned rider and a stranger enter none — and every door asks it: the page, the socket, the AV token, presence. SQL asks the same question through the `visible_channels` view, which is `mayEnter` word for word, and every person-visibility join reads the view rather than spelling `role != 'banned'` by hand, which is how #1109 and #1114 happened: who may see, hear and find whom follows the channels two riders may both enter. **Who may change a gate** is the second question, and the only one a crew role answers: the crew's owner and admins (`administers`) create, rename, order, gate and delete channels. Nothing makes a hand-written join fail to compile: what catches one is [`crew_invariants_test.go`](../server/internal/store/crew_invariants_test.go)'s table, which runs every visibility query over one fixture and asserts both directions across the crew boundary, a private channel and a ban. A crew has **one door**, its six-character code and the `/c/{code}` link a member hands out. A **listed** crew ([ADR-0039](decisions/0039-the-public-room-directory.md), as amended) puts that link in the public directory — a name, a mark and the door, nothing past it. An old `/r/{slug}` address opens nothing: it is looked up once to find what the room became (#2458), and entering that still asks `mayEnter`.

## The WS protocol

Defined once as Go structs in [`server/internal/protocol/`](../server/internal/protocol/); `make protocol` generates `web/src/lib/protocol.ts` via tygo. JSON on the wire (readable in devtools). Never edit the TS file by hand.

## Game modes

A mode = a rule module plugged into a session in the hub: the workout engine keeps producing targets; the mode adds per-tick rule evaluation (eliminations, lives, scores), UI states, and an end condition. Everything is %FTP-relative. Elimination modes give a 30 s reconnect grace window.

## What deliberately doesn't exist (yet)

- **No Redis/NATS** — one instance handles hundreds of voice channels; revisit when it measurably can't.
- **No job queue** — ride-completion stats are <100 ms of math in the request path.
- **No ORM, no framework** — sqlc + pgx + net/http.
- **No iOS path** — Web Bluetooth is Chromium-only and Safari refuses; locked decision.

## Deployment

Single Go binary with the SPA embedded (`make build`). Production is deliberately boring ([ADR-0002](decisions/0002-single-vm-compose-deploy.md)): **one VM, one docker compose stack** — wattroom-server, Postgres, LiveKit (host network — WebRTC UDP is trivial on a VM, awkward on k8s), Caddy for TLS. Deploy is a tagged release the VM converges on by itself ([ADR-0019](decisions/0019-tagged-releases-and-a-self-converging-vm.md)): a five-minute timer reads the tag pinned in the homelab repo, refuses to interrupt a ride in progress, `pg_dump`s, rolls forward, and retags to the previous image if the new one does not report itself healthy. Rollback is an image tag, never a database restore — which holds only because migrations are expand/contract. Prod looks like the dev compose file on purpose. Local dev: `make infra` + two hot-reload processes.
