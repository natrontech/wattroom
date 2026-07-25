# TODO

The living work list, ordered by milestone (definitions in [WATTROOM.md §5](WATTROOM.md)).
**Every work item below is mirrored as a GitHub issue** (milestones M0–M6) — issues are where work gets claimed; this file is the scratchpad for ordering and quick notes.

## Not code (owner: Jan)

- [ ] Register **wattroom.cc** + handles (GitHub org social preview, Strava, Instagram)
- [ ] OAuth apps when M2 nears: Google, GitHub, Strava (starts single-athlete; Standard Tier ≤10 users needs no review)
- [ ] YouTube Data API key (M3)

## Backlog (parked, `backlog` label)

- GitHub Sponsors + FUNDING.yml (#8)
- Install Renovate app (#9)
- Custom sound/reaction packs per room (fast-follow)

## M0 — Foundations (in progress)

- [x] Monorepo scaffold: Go server (hub stub, healthz, /metrics, embedded SPA), SvelteKit SPA (Svelte 5, Tailwind v4, adapter-static), compose, Makefile
- [x] WS protocol codegen pipeline (Go structs → tygo → protocol.ts)
- [x] Docs pack: README, CONTRIBUTING, ARCHITECTURE, CLAUDE.md, ADRs, RESEARCH
- [ ] CI green on GitHub Actions
- [ ] **SimulatedTrainer**: `Trainer` interface + simulated implementation (power lag, cadence, noise, dropout injection), dev-flag selectable
- [ ] Workout engine skeleton: step sequencer producing ERG targets from a workout JSON
- [ ] Real hardware session: Kickr Core over FTMS (pair, read power, hold ERG target, ride hardcoded intervals)
- [ ] Kickr v2 GATT enumeration — confirm WCPS protocol map (RESEARCH.md §9) against the real unit
- [ ] Seeded dev data pattern (once first schema exists)

## M1 — Solo workout player

- [ ] FtmsTrainer driver (serialized control-point write queue!)
- [ ] WcpsTrainer driver (Kickr v2: unlock, 0x42 ERG, 0x43/0x46 sim/grade)
- [ ] HR / cadence / power sensor pairing (BLE HRS, CPS, CSC)
- [ ] Workout JSON format + editor + curated library (~25 workouts)
- [ ] Interval graph UI, FTP scaling, player controls (bias ±%, skip/extend, spiral guard, auto-pause)
- [ ] Built-in ramp test; manual FTP in profile
- [ ] .fit export (muktihari/fit), local ride history
- [ ] Playwright smoke: simulated trainer → 2-min workout → .fit produced

## M2 — Accounts & rooms

- [ ] OAuth (Google/GitHub/Strava), profiles (name, FTP, weight, avatar)
- [ ] Postgres schema + sqlc + goose migrations
- [ ] Persistent rooms, join via link/code, roles
- [ ] Live dashboard: 1 Hz ticks, shared timer, countdown start, late join
- [ ] IndexedDB ride buffer + reconnect resend (seq dedup)
- [ ] Phone spectator view

## M3 — Presence & jukebox

- [ ] LiveKit: tokens from Go, voice/camera/screenshare in rooms
- [ ] Layouts (metrics-first / video-first / media-focus) + TV mode
- [ ] Synced YouTube jukebox (RMF-compliant player tile, tiered drift correction, videos.list resolve)
- [ ] Audio ducking on active speakers

## M4 — Stats & game layer

- [ ] Ride completion pipeline (curve, execution score, kJ/XP, level+category) in one transaction
- [ ] FTP auto-detect prompts
- [ ] Live execution meter; post-ride medals; room streaks & challenges
- [ ] Sprint moments (ERG→slope switch, 4 Hz burst, podium)

## M5 — Game modes

- [ ] Rule-module hook on the hub, then in order: Backyard Ramp → Sprint Roulette → Watt Golf → Floor is Lava → Points Race → Team Relay → Collective Ramp
- [ ] 30 s disconnect grace for elimination modes
- [ ] Base sound set + spectator cheers + rider quick-reactions

## M6 — Alpha polish

- [ ] Strava auto-upload; account export-all + delete
- [ ] Production compose stack on a single VM (ADR-0002): Dockerfile + GHCR publish, Caddy TLS, pg_dump backups, Grafana; wattroom.cc live
- [ ] Calibration guidance, sensor dropout handling, UX polish
- [ ] Alpha: weekly rides with the crew — success = they keep choosing it
