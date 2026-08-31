# TODO

The living work list, ordered by milestone (definitions in [WATTROOM.md §5](WATTROOM.md)).
**Every work item below is mirrored as a GitHub issue** (milestones M0–M6) — issues are where work gets claimed; this file is the scratchpad for ordering and quick notes.

## Not code (owner: Jan)

- [x] Register **wattroom.ch** (bought 2026-08-29); handles still open (GitHub org social preview, Strava, Instagram)
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
- [x] CI green on GitHub Actions
- [x] **SimulatedTrainer** (#1): `Trainer` interface + simulated implementation (power lag, cadence, noise, dropout injection), dev-flag selectable
- [x] Workout engine skeleton (#2): step sequencer producing ERG targets from a workout JSON
- [x] Real hardware session: Kickr Core over FTMS (#10) — validated, driver in #42
- [ ] Seeded dev data pattern (once first schema exists)

## Design (done — #38, merged in #39)

- [x] Visual identity locked ([ADR-0005](docs/decisions/0005-synthwave-visual-identity.md)): equalizer mark, Outrun palette, Chakra Petch over Barlow
- [x] 15 screens mocked under `/dev`, fed by SimulatedTrainer — every M1–M5 feature has a mock to build against
- [x] Design port pass (#100–#108): every mock screen rebuilt 1:1 in the real app — room shell, rooms list, ramp, profile, summary + medal, game-mode heroes, editor library column, room settings (sound pack + delete room), home shell
- Parked with reason: 30 s disconnect grace (M5), Strava upload status (M6)

## M1 — Solo workout player

- [x] FtmsTrainer driver (#3) — serialized control-point queue, parsing confirmed on hardware
- Parked per ADR-0007 (alpha fleet is all-FTMS): Kickr v2 GATT enumeration, WcpsTrainer (#4)
- [x] HR / cadence / power sensor pairing (BLE HRS, CPS, CSC) — Polar H10 verified on hardware
- [x] Workout JSON format + editor + curated library (#12) — 26 workouts; custom workouts live on the account since #121
- [x] Interval graph UI, FTP scaling, player controls (#13) — spiral-guard thresholds still need proving (#46)
- [x] Built-in ramp test; manual FTP in profile — FTP pushes to the account (#119)
- [x] .fit export (#5) — verified against Strava, classified as Virtual Ride
- [x] Ride history — server-side on the account since #110; device store is the offline fallback
- [x] Playwright smoke (#6) — runs on every PR as its own CI job

## M2 — Accounts & rooms (closed 2026-08-29)

All shipped: OAuth + profiles, schema/sqlc/goose, persistent rooms with
roles, the 1 Hz dashboard, IndexedDB crash buffer + reconnect resend, the
phone spectator. Since then: full login gating (ADR-0009) and the phone
share link landing on the spectator view (#124).

## M3 — Presence & jukebox (closed 2026-08-29)

All shipped: LiveKit tokens/voice/camera, the three layouts + TV mode
(idle TV is a lounge screen since #125), the synced RMF-compliant jukebox
with ducking. (The Jam link-out card #96/ADR-0003 shipped and was
removed again by ADR-0018 — one room, one music surface.)
Still unverified by human ears: two-browser voice/camera and audible
jukebox sync — see the pre-launch list in docs/LAUNCH.md.

## M4 — Stats & game layer (closed 2026-08-29)

All shipped: the one-transaction completion pipeline, FTP auto-detect
prompts, live execution meter, medals, room streaks/challenges, sprint
moments. Solo rides feed the same pipeline since #110.

## M5 — Game modes (closed 2026-08-29)

All seven modes shipped with their designed heroes (#105), the base sound
set (room-level pack setting since #107), cheers and quick-reactions.
Parked with reason: 30 s disconnect grace for elimination modes.

## M6 — Alpha polish

- [ ] Strava auto-upload; account export-all + delete
- [ ] Production compose stack on a single VM (ADR-0002): Dockerfile + GHCR publish, Caddy TLS, pg_dump backups, Grafana; wattroom.ch live
- [ ] Calibration guidance, sensor dropout handling, UX polish
- [ ] Alpha: weekly rides with the crew — success = they keep choosing it
