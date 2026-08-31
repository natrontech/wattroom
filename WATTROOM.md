# WattRoom

> Train together, not alone. WattRoom is a collaborative indoor cycling app: structured workouts, smart trainer control (FTMS), and shared rooms with live metrics, always-on voice and camera, plus a synced jukebox for music and YouTube.

This document is the north star for the project. Every major platform, UX, feature, stack and architecture decision below was made deliberately — treat changes to this file as decisions, not edits.

---

## 1. Vision

WattRoom is "Discord for indoor cycling" — the only app open on ride night (ADR-0010: room-first, ride-night-scoped). A Zwift alternative that deliberately drops the virtual world (no roads, no avatars, no 3D) and focuses on what matters for structured training: executing workouts precisely, and doing it **together**.

The core insight: indoor training is boring alone. Zwift solves this with a game world. WattRoom solves it with **presence** — you hop into a room with your training buddies, everyone's live watts and heart rate are visible, you talk over voice, see each other on camera, and share music or videos through a synced jukebox.

### What WattRoom is

- A structured workout player with precise smart trainer control (ERG mode)
- Persistent rooms where people train together in real time, with live metrics for every rider
- Always-on voice and camera between room members (LiveKit, built in from day one)
- A synced jukebox: shared YouTube queue playing in sync for everyone
- A hosted service at **wattroom.ch**, open source under **AGPL-3.0**

### What WattRoom is NOT

- No virtual world, roads, maps or avatars
- No racing simulation, drafting physics or game mechanics
- No content treadmill (routes, worlds, events)
- Not a training plan generator (integrate with existing tools later)

---

## 2. Decisions (locked 2026-07-16)

| Area | Decision |
|---|---|
| Distribution | **Hosted service first** (wattroom.ch). Self-hosting possible (it's AGPL + a compose stack, [ADR-0002](docs/decisions/0002-single-vm-compose-deploy.md)) but not the optimization target. |
| License | **AGPL-3.0** — protects the hosted model. Auuki (also AGPL) is **architectural reference only, never copy code**: copying is license-compatible but would add an external copyright holder and forfeit any future relicensing flexibility. Write the FTMS layer from the Bluetooth SIG spec. |
| Stack | **Go** server (API + WebSocket + embedded frontend) + **SvelteKit** SPA + **PostgreSQL** + **LiveKit** (self-hosted). |
| Repo | Monorepo at **github.com/natrontech/wattroom**: `/web` + `/server`. Protected main, PRs with CI green, squash merge, conventional commits. |
| Deploy | ~~Kubernetes-native~~ **Superseded by [ADR-0002](docs/decisions/0002-single-vm-compose-deploy.md)**: single VM, docker compose stack (app + Postgres + LiveKit host-network + Caddy TLS). The k8s/LiveKit networking research stays valid in RESEARCH.md §2 for whenever scale demands it. |
| Auth | **Social OAuth only**: Google, GitHub, Strava. No passwords, ever. Strava OAuth doubles as the fitness integration. |
| AV | **LiveKit from day one** — voice, camera, screenshare are the product's identity, not a later add-on. |
| Jukebox | **In MVP.** Synced YouTube queue (IFrame Player API per client, server holds queue + position). **Hard TOS constraints (YouTube RMF, verified 2026-04 version)**: player tile ≥200×200 px, always visible while media plays, **nothing overlaid on it** (no HUD over video), no auto-advance while the player is offscreen, and **no audio-only/background mode** — the "music" use case is a visible player tile, period. Spotify: **Jam link-out only, never API playback** ([ADR-0003](docs/decisions/0003-spotify-via-jam-link-not-api.md) — ducking violates Spotify's no-overlap policy). Amended by [ADR-0015](docs/decisions/0015-self-hosted-music-pool.md): self-hosted MP3 pool joins the same queue; RMF rules apply only while a YouTube entry plays. |
| Rooms | **Persistent** — a room lives forever, has members and roles (owner, coach, member). Sessions happen *in* rooms. |
| Room UX | **User-switchable layouts**: metrics-first, video-first, media-focus. Plus a **TV mode** (huge numbers, readable at 3 m). |
| Devices | Laptop next to trainer (primary), TV mode, **phone spectator view** (read-only room dashboard, works on iOS Safari). Android tablet not a design target. |
| UI kit | **Tailwind, custom components.** No component library — the app is mostly bespoke visualization (interval graphs, power bars, video tiles). Dark-first "pain cave" theme. |
| Workouts | **Built-in editor** + **curated library** (~25 workouts: sweet spot, VO2, threshold, recovery). Own JSON format. `.zwo`/`.erg` import is a fast-follow, not MVP. |
| Integrations | **.fit download** (via **muktihari/fit**) + **Strava auto-upload** in MVP (`POST /uploads`, `activity:write`, async status polling). intervals.icu later. **Strava's Nov-2024 API terms**: a user's Strava-sourced data may only be shown to that user — WattRoom only *uploads* its own recorded rides (unaffected) and must never display Strava-pulled data to other room members. New Strava apps start single-athlete; the **Standard Tier covers ≤10 users without review** — exactly the alpha; Extended Access review is a gate before widening. |
| Realtime arch | **Single Go instance, in-memory room state.** A room is a goroutine + channels. Postgres stores only durable data. Redis/NATS only when one instance measurably can't. |
| Go style | **Stdlib-first**: net/http routing (thin chi at most), raw SQL via **sqlc** + **pgx**, migrations via **goose**, WebSocket via **coder/websocket** (gorilla is archived). No framework, no ORM, no magic. Version pins + full tooling research: [docs/RESEARCH.md](docs/RESEARCH.md). |
| WS protocol | **JSON, Go-first codegen**: the Go message structs are the single source of truth; **tygo** emits the TypeScript types in CI. One tool, no schema files, types never drift. (If runtime schema validation is ever needed: JSON Schema pipeline is the documented alternative — see docs/RESEARCH.md §8.) |
| Observability | **slog** structured JSON logs (request/room IDs on every line) + **Prometheus /metrics** with Grafana dashboards (rooms active, riders connected, fan-out latency). No error-tracking SaaS, no product analytics. |
| Testing | **Unit + one e2e smoke.** Go table tests (room hub, workout engine, FTMS parsing), Vitest for frontend logic, one Playwright flow: simulator trainer → ride 2-min workout → .fit produced. Runs on every PR. |
| Privacy | Live metrics visible **only inside the room, only while riding**. AV is transit-only — **never recorded**. Rides **private by default**, shared per-ride opt-in. Export-all + delete-account (full purge) in MVP. HR is health data; act like it — live in-room, never in a shared artifact, never scored ([ADR-0008](docs/decisions/0008-heart-rate-retention.md)). |
| Money | **Donations/sponsorware only.** No paid tiers, no pricing page. GitHub Sponsors covers hosting; if LiveKit bandwidth costs bite, revisit — but the default is free. |
| Competition | **Room-scoped only.** Leaderboards, rankings, duels live *inside* a room — your crew's ladder, not the internet's. No public leaderboards; the privacy promise holds. |
| Rank currencies | **Power-curve PRs (w/kg)** (5s/1min/5min/20min), **execution score** (how precisely you rode the prescribed workout), **consistency/streaks**. Never raw watts — a 90 kg rider doesn't outrank a 55 kg climber by existing. |
| Leveling | **Dual track.** LEVEL = XP from work done (kJ) + streak/execution bonuses — climbs forever, rewards showing up. CATEGORY = fitness tier from w/kg power curve (D→C→B→A), moves both directions. "Level 38, Cat C" is a legible identity. |
| Ride game | Live **execution meter** on the group dashboard, **post-ride medals** (Diesel, Metronome, Hammer, Lanterne Rouge), **room streaks & collective challenges** ("5 MJ together in November"), **sprint moments** (coach/workout arms a 15 s all-out w/kg battle with mini-podium). |
| Game modes | **Full system in MVP**, 7 modes: Backyard Ramp, Floor is Lava, Watt Golf (blind), Sprint Roulette, Points Race, Team Relay, Collective Ramp. A mode = a **rule module** over the same workout engine (per-tick rule evaluation + UI states + end condition). All targets %FTP-relative, so mixed groups stay fair. |
| Stream storage | **Plain Postgres, no extension** (researched: TimescaleDB's compression/aggregates are TSL-licensed and being deprecated on PG17+ by some platforms; our samples are only ever read per-ride). `rides` row = summary columns/JSONB + raw 1 Hz samples as one compressed bytea (~50 KB/h). Revisit only if cross-ride sample-level analytics becomes a feature. |
| Stats compute | **Server, on ride completion, in-process.** Power curve, execution score, medals, streaks, level/category — computed transactionally from the stream the server already holds (<100 ms of math). No job queue until scoring outgrows the request path. |
| Crash safety | **Stream + local buffer.** Samples flow to the server over the room WS *and* buffer in IndexedDB. Browser crash at minute 55 → recover from either side; abandoned rides close as ridden. Nobody ever loses a ride. |
| Fan-out | **Server tick @1 Hz**: all riders coalesced into one message per room per second (n in, 1 out — never n²). Sprint moments burst to 4 Hz for 15 s. Latency budget: pedal → everyone's screen < 500 ms. |
| Validation | **Own training circle is the alpha.** Success signal: the group keeps *choosing* WattRoom over Zwift+Discord for weekly sessions, unprompted. Widen only after that. |
| Visual identity | **Neon glow / synthwave.** Near-black surfaces, one hot accent (electric watt-yellow), glowing interval graphs like a night ride, subtle bloom on live numbers. Restraint rule: glow belongs to *data* (graphs, live watts, sprint moments) — chrome UI (buttons, forms, settings) stays flat and quiet, or it tips into kitsch. |
| Join flow | **Share link is the golden path** (`wattroom.ch/r/velvet-hammer`) + **6-char room code** for cross-device joins, both MVP. **In-app invites** and an **opt-in public room directory** are fast-follows. Rooms are private/unlisted by default; a directory listing is a per-room owner choice, and metrics stay visible only to people who actually join. |
| iOS | **Web-only, forever.** Chrome/Edge on desktop + Android is the product; no native app, no bridge app planned. iOS users bring a laptop (the spectator view works in iOS Safari). Honest positioning over platform sprawl. |
| Replay | **Out.** The ride summary (curve, score, medals, graphs) is the record; AV is never recorded regardless. Question closed. |
| FTP | **All three sources.** Manual entry (the fallback, MVP), **built-in ramp test** (special workout on the existing engine, FTP = 75% of best 1-min), **auto-detect** (server *prompts* when the 90-day curve outgrows the setting — never silently changes it, FTP moves every workout's difficulty). |
| Sprint physics | **Auto-switch to slope mode.** ERG pins you at target watts, so when a sprint arms the client flips the trainer FTMS ERG→slope (fixed gradient) for the window, then back. Real sprint feel; mode-switch robustness is shared with reconnect handling. |
| Hosting | ~~Existing Natron k8s infra~~ **Superseded by [ADR-0002](docs/decisions/0002-single-vm-compose-deploy.md)**: any single VM (Natron-provided or a cheap cloud VM; pick at deploy time — a Swiss provider stays open for the data-residency story). |
| Feel layer | **Session sound design** (countdown beeps, sprint klaxon, elimination sting, medal fanfare — synthwave-coherent, mixed under voice), **spectator emoji cheers** that pop on rider dashboards, **rider quick-reactions** (🔥 💀 🤮 — for when you're too gassed to talk). Sounds and reaction sets are **swappable/extensible per room** (insider memes, custom packs) — base set MVP, custom packs fast-follow. |

---

## 3. Architecture

```
+---------------------+       WebSocket        +---------------------------+
|  Client (SvelteKit) | <--------------------> |  wattroom-server (Go)     |
|                     |  room state, metrics,  |                           |
|  - Web Bluetooth    |  timer, jukebox sync   |  - REST API (auth, CRUD)  |
|    FTMS/HR/Pwr/CSC  |                        |  - Room hub: goroutine    |
|  - Workout player   |                        |    per room, in-memory    |
|  - YT IFrame player |       WebRTC (SFU)     |  - Serves embedded SPA    |
|  - LiveKit SDK      | <--------------------> |                           |
+---------------------+   voice/video/screen   |  PostgreSQL   LiveKit     |
                                                +---------------------------+
```

### Responsibility split (the load-bearing rule)

- **Client owns the BLE connection and workout execution.** ERG targets are computed and pushed to the trainer locally — a network hiccup never drops your target watts mid-interval.
- **Server owns shared truth**: room membership, the synchronized interval timer, jukebox queue + playback position, and fan-out of live metrics.
- **Postgres owns durable data only**: users, rooms, memberships, workouts, ride history. Live room state never touches the database.
- Metrics are tiny (~watts/hr/cadence at 1 Hz per rider); one instance handles hundreds of concurrent rooms.

### Trainer & sensor layer

- **BLE FTMS** via Web Bluetooth (Chrome/Edge desktop + Android; iOS is a known, accepted gap). Test hardware: Wahoo **Kickr Core** and **Kickr Core v2** — both FTMS ([ADR-0007](docs/decisions/0007-alpha-hardware-is-all-ftms.md)). Write the model out in full: "v2" alone is ambiguous and has already caused one wrong scoping decision.
- ERG mode via FTMS Control Point (Set Target Power, op 0x05); slope via Set Indoor Bike Simulation (op 0x11, grade as signed % at 0.01 resolution) — plus **live ERG↔slope switching** for sprint moments (spec-legal under one Request Control grant; verified against FTMS v1.0).
- **Control-point writes must be strictly serialized**: every procedure completes via an indicated Response Code (0x80), and a write while one is in progress errors out un-queued. The FTMS layer needs a write queue that waits for each indication — no fire-and-forget.
- **One trainer driver in MVP** behind the `Trainer` interface (setTargetPower / setSim / data streams): **FtmsTrainer** (Kickr Core, fw ≥1.4.8 — fixes a 2 kW spike on exactly the ERG↔SIM switch sprint moments use). **WcpsTrainer** — for the **Kickr v2 (2016)**, which never received FTMS and speaks Wahoo's proprietary characteristic (`A026E005-…` on the Cycling Power Service): unlock `[0x20 0xEE 0xFC]`, ERG op 0x42, sim/grade ops 0x43/0x46 — is **backlog, not M1** ([ADR-0007](docs/decisions/0007-alpha-hardware-is-all-ftms.md) supersedes the original scoping): the alpha fleet is one Kickr Core plus several **Kickr Core v2**, all FTMS, so no trainer on this team needs it. Full protocol map stays in [docs/RESEARCH.md §9](docs/RESEARCH.md) for whoever eventually brings a pre-FTMS unit.
- Detection: request both services (FTMS 0x1826 + CPS 0x1818) in `optionalServices`; FTMS wins when present. Sprint moments work on both drivers (0x05↔0x11 vs 0x42↔0x46).
- **Some trainers report no reliable cadence** — those riders pair a BLE cadence sensor (CSC, already in scope); the spiral-of-death guard falls back to power-collapse detection when cadence is absent. That fallback is built and tested and stays regardless of which trainers are in the fleet — it is broader than any one model. Spindown/calibration defers to the Wahoo app for MVP (standard third-party practice).
- Standard BLE profiles for HR straps, power meters, cadence/speed sensors.
- **Trainer reconnect mid-interval is MVP scope, not polish** — a dropped ERG target at minute 18 of 20 kills trust permanently.
- **Player controls (MVP)**: intensity bias ±% mid-ride, skip/extend interval, spiral-of-death guard (cadence collapse in ERG → temporarily release target), auto-pause (stop pedaling → pause after a few seconds, resume → countdown and continue). In group rides the **coach owns the shared timeline**; skip/extend/pause apply to solo riders only — a group member who stops just falls behind on their own targets while the room timer runs.
- **Trainer simulator**: the BLE layer is dependency-injected behind a trainer interface; a `SimulatedTrainer` implementation (first-order power lag toward target, cadence, noise, optional dropout injection) is selectable via dev flag — contributors and Playwright CI never touch real Bluetooth (Playwright has no supported BLE emulation). Build it in M0, before the real hardware path.
- ANT+ out of scope, BLE only.

### Jukebox sync (the fiddly one)

- Server state: queue + `{videoId, positionSeconds, playing, updatedAt}`. Clients render their own YouTube IFrame player and chase server position with **tiered drift correction**: small drift → nudge `playbackRate` (imperceptible soft-sync), drift > ~2 s → hard `seekTo`. ~200 ms cross-client alignment is the state of practice.
- Resolve queue entries via Data API `videos.list` (1 quota unit) and surface "not embeddable" (label/Vevo content) before playback; avoid in-app `search.list` (100 units of the 10k/day quota) for MVP — paste-a-URL is the golden path.
- Play/pause/seek/queue ops go through the server; late joiners get current state on join.
- **YouTube RMF compliance shapes the UI**: the player is a dedicated ≥200×200 tile, always visible while media plays, never overlaid by metrics/HUD, and the queue only auto-advances while it's on screen. Audio-only/background music mode is prohibited by YouTube's developer policies — not a WattRoom choice.
- **Audio ducking** client-side: music volume dips when LiveKit reports active speakers.
- DRM content (Netflix etc.) not supported; Spotify sync blocked by API terms — YouTube covers music + video for MVP.

---

## 4. Stats, ranking & the game layer

The competitive layer is **fairness-first**: every metric is either weight-normalized (w/kg), relative to your own targets (execution), or pure behavior (streaks). A beginner nailing their sweet-spot session stands next to a strong rider on equal footing. Raw watts appear on the dashboard, never on a ladder.

### The two axes

- **Level** (never goes down): XP = kJ of work done, with bonuses for streaks and high execution scores. The odometer that makes winters feel earned.
- **Category** (moves both ways): D→C→B→A from your rolling 90-day w/kg power curve, same spirit as racing cats. Detraining drops you; that's the point — it means something.

### Execution score (the WattRoom-native metric)

Per ride: % of time within tolerance band of target power, weighted by interval difficulty. It's the score that makes *structured* training competitive — the contest is who rides their own workout cleanest, which works across any fitness gap. Live on the group dashboard during sessions (the execution meter), aggregated per-ride afterward.

### Medals (auto-awarded per group session)

- **Diesel** — steadiest power (lowest variability in steady intervals)
- **Metronome** — best execution score
- **Hammer** — biggest 5 s w/kg
- **Lanterne Rouge** — finished last on the sprint but finished. Survived.

Screenshot-shareable cards; the room's medal history lives on the room page.

### Sprint moments

The coach (or a marker in the workout file) arms a 15 s all-out segment. The room bursts to 4 Hz ticks, a live w/kg battle renders, mini-podium after. The one sanctioned outlet for raw racing instinct inside a structured session.

### Room streaks & challenges

Crew-level: "8 weeks straight, nobody missed", monthly collective targets ("5 MJ together"). Cooperative pressure — you show up so the *room* doesn't lose the streak.

### Game modes

A game mode is a **rule module** plugged into the room hub: the workout engine still produces ERG targets; the mode adds per-tick rule evaluation (eliminations, lives, scores), its own UI states, and an end condition + podium. Everything is %FTP-relative, so a beginner and a Cat A play the same game at their own watts.

**Elimination**

- **Backyard Ramp** — last one pedalling. Rounds of ~3 min; every round the target climbs +5 %FTP. Below your target band for >10 s → eliminated. Eliminated riders spin easy, stay in the room, and heckle on camera (this is a feature).
- **Floor is Lava** — the mode calls a zone; drift out (above *or* below) and you burn a life. Three lives. Punishes surging as much as fading — pacing discipline disguised as Mario Kart.

**Sprint & precision**

- **Sprint Roulette** — random 10–15 s sprints fire without warning (3-2-1 klaxon → all-out w/kg battle → mini-podium). Configurable frequency; off by default in serious workouts.
- **Points Race** — scored moments sprinkled through a session (sprints, best-execution intervals, time-in-zone) accumulate an omnium-style points ladder. Losing one sprint never ends your race.
- **Watt Golf** — *blind precision*: your power meter is **hidden**. "Hit 230 W for 10 s — starting in 20 s." Closest average to target wins the hole; total deviation = strokes, lowest over 9/18 holes wins. Fitness means nothing here, feel means everything.

**Co-op**

- **Team Relay** — one rider "on the front" holding high power while the rest recover; rotate on a timer or by call-out. The room accumulates virtual distance against a target. Through-and-off rhythm, brutal and hilarious on voice.
- **Collective Ramp** — Backyard Ramp, but the *room's average* %FTP must stay above the rising line. Strong riders can carry fading ones by going harder: sacrifice plays. Score = rounds survived; beat your crew's record.

**Mode-critical edge case**: a disconnect during an elimination mode gets a 30 s reconnect grace window (the IndexedDB buffer proves they kept pedalling) before the rule kills them. Nobody loses a Backyard final to Wi-Fi.

### Data flow (rock-solid path)

```
trainer → client (1 Hz samples)
  ├→ IndexedDB ring buffer            (crash recovery, offline solo rides)
  └→ room WS → server
       ├→ room tick @1 Hz (4 Hz sprint) → all members   (live dashboard)
       └→ in-memory ride accumulator
            └→ on completion: compress samples → bytea,
               compute curve/score/kJ/medals/XP/category → one transaction
```

Reconnect semantics: client resends buffered samples with sequence numbers on WS reconnect; server dedupes idempotently. A network blip costs nothing; a browser crash costs nothing; a server restart mid-ride recovers from the client buffer.

---

## 5. MVP scope & milestones

The MVP is deliberately maximalist — trainer control, rooms, AV and jukebox together *are* the product. Estimated solo effort: this is a couple of months of focused evenings/weekends, not 4–8 weekends. The contributor groundwork in M0 exists to shorten that by letting others in early.

**M0 — Foundations & proof of concept**
- Monorepo scaffold: `/server` (Go), `/web` (SvelteKit + Tailwind), docker-compose dev env (Postgres + LiveKit + server + Vite) with seeded data
- CI from commit one: lint, test, build for Go and web on every PR
- Trainer simulator (fake FTMS device)
- Real hardware: connect the Kickr Core via Web Bluetooth (FTMS), read power, set ERG target, ride a hardcoded interval workout; enumerate GATT services on the team's trainers (done — [ADR-0007](docs/decisions/0007-alpha-hardware-is-all-ftms.md))

**M1 — Solo workout player** ✅ *(closed 2026-08-29 — every item ridden on real hardware; guard thresholds promoted to docs/SPEC.md)*
- ✅ Workout JSON format, built-in editor (warmup/steady/intervals/repeats/ramps/cooldown, %FTP or watts)
- ✅ Curated library (26 workouts)
- ✅ Interval graph UI, FTP scaling, HR/power/cadence pairing, reconnect handling
- ✅ Player controls: intensity bias ±%, skip/extend interval, spiral-of-death guard, auto-pause
- ✅ Built-in ramp test (FTP = 75% of best 1-min power); manual FTP entry in profile
- ✅ .fit export (verified against Strava), ride history (private by default)

**M2 — Accounts & rooms** ✅ *(closed 2026-08-29 — plus the Postgres schema, IndexedDB crash safety, and the ADR-0008 HR-sharing control; OAuth provider apps still need registering to go beyond dev login)*
- ✅ OAuth (Google, GitHub, Strava), profiles (name, FTP, weight, avatar)
- ✅ Persistent rooms: create, join via code/link, roles (owner/coach/member)
- ✅ Shared dashboard: live watts/HR/cadence/%FTP per rider, synchronized interval timer, countdown start, late join
- ✅ Phone spectator view (read-only, any mobile browser)

**M3 — Presence & jukebox** ✅ *(closed 2026-08-29 — two-browser AV and audible jukebox sync await the first crew ride; both fixed compose bugs: LiveKit could never carry media on macOS)*
- ✅ LiveKit: voice + camera + screenshare in rooms
- ✅ Switchable layouts (metrics-first / video-first / media-focus) + TV mode
- ✅ Synced YouTube jukebox with shared queue and audio ducking

**M4 — Stats & game layer** ✅ *(closed 2026-08-29 — pipeline, live meter, medals, streaks, FTP prompts and sprint moments all verified against live multi-rider sessions; #41's single-cog answer is a profile setting)*
- ✅ Ride completion pipeline: power curve, execution score, kJ/XP, level + category, all in one transaction
- ✅ FTP auto-detect prompts from the 90-day curve
- ✅ Live execution meter on the group dashboard
- ✅ Post-ride medals + room medal history
- ✅ Sprint moments (coach/workout-armed, ERG→slope switch, 4 Hz burst, mini-podium)
- ✅ Room streaks & collective challenges

**M5 — Game modes** ✅ *(closed 2026-08-29 — all seven rule modules table-tested per SPEC parameters; Backyard verified live with an elimination; a crew evening is the real playtest)*
- ✅ Rule-module hook on the room hub (per-tick evaluation, mode UI states, end condition/podium)
- ✅ Ship in this order — each mode proves a new primitive, the rest reuse them:
  1. **Backyard Ramp** (elimination + eliminated-spectator state)
  2. **Sprint Roulette** (surprise events + 4 Hz burst reuse)
  3. **Watt Golf** (hidden-meter UI + precision scoring)
  4. **Floor is Lava** (lives system)
  5. **Points Race** (composite scoring over 2+3)
  6. **Team Relay** (turn rotation)
  7. **Collective Ramp** (room-aggregate rules over 1)
- ✅ Disconnect grace window (30 s) for elimination modes
- ✅ Base sound set (countdowns, klaxon, elimination sting, medal fanfare), spectator cheers, rider quick-reactions

**M6 — Alpha polish** *(2026-08-30 review: core is code-complete; a pre-launch polish sprint remains — #96 Spotify Jam card, #109 login gate + designed sign-in, #110 server-side solo rides, #111 public landing page. Launch order: polish first, then deploy. #36 (VM + DNS on wattroom.ch — domain registered, Cloudflare NS live) and #34 (Strava app) stay user-action gates.)*
- ⏳ Strava auto-upload
- ✅ Account export-all + delete (full purge)
- ⏳ Production compose stack on a single VM ([ADR-0002](docs/decisions/0002-single-vm-compose-deploy.md)), wattroom.ch deployment, Grafana dashboards
- ✅ Calibration/spindown, sensor dropout handling, UX polish
- ✅ Alpha: own training circle rides weekly. Widen only when they keep choosing it unprompted.

**Fast-follows (explicitly not MVP):** .zwo/.erg import, intervals.icu sync, scheduling + RSVP + iCal, text chat, in-app invites, opt-in public room directory, custom sound/reaction packs per room (base set is MVP; upload-your-own comes after).

---

## 6. Contributor groundwork

Ships with M0, because retrofitting it is how projects stay solo forever:

- **Docs pack**: `CONTRIBUTING.md`, `ARCHITECTURE.md` (room hub + BLE layer explained), `CLAUDE.md`, and this file in-repo.
- **One-command dev env**: clone → `docker compose up` → open localhost. Seeded users, rooms and workouts. No smart trainer required (simulator).
- **CI from commit one**: GitHub Actions — Go lint/test/build, web lint/check/build, Playwright smoke (simulator → 2-min ride → .fit), on every PR.
- **Flow**: protected `main`, PR + review + green CI, squash merge, conventional commits.

---

## 7. Naming & branding

- **Name: WattRoom.** You enter a room and push watts together. Vocabulary: rooms, "open a room", room codes, coach role.
- Domain: **wattroom.ch** — grab domain + handles (GitHub, Strava, Instagram) early; check trademark landscape (Wattbike exists).
- **Visual direction: full synthwave pain cave** ([ADR-0005](docs/decisions/0005-synthwave-visual-identity.md) supersedes the original near-black/watt-yellow palette). Violet-black surfaces (#0a0118 / #1a0736); **two accent hues with distinct jobs** — `--color-neon` (violet #8b2bff) is structural chrome and never glows, `--color-watt` (magenta #ff3d8b) is live data and is the only thing that does. Interval graphs glow like a night ride, live numbers get subtle bloom; sprint moments are the one place the UI is allowed to go loud. Chrome (buttons, forms, editor, settings) stays flat and quiet — the glow means "this is live wattage", never decoration. Medal cards are dark, screenshot-first, built to look good in a group chat.
- **Mark: the equalizer W** — five bars whose heights trace the letter, so the logo is an interval graph. It animates while a session runs. Wordmark flat white. Type: Chakra Petch (display + all numerals) over Barlow (running text).

## 8. Repo metadata

- **Description**: `Train together, not alone. Collaborative indoor cycling: structured workouts, FTMS trainer control, shared rooms with live metrics, voice, camera and a synced jukebox.`
- **Topics**: `cycling`, `indoor-training`, `ftms`, `bluetooth`, `web-bluetooth`, `smart-trainer`, `webrtc`, `livekit`, `sveltekit`, `golang`, `jukebox`

## 9. Open questions (the ones that remain)

- Room scaling ceiling (2–8 riders typical; LiveKit video grids past ~12 need layout thought)
- If donation income doesn't cover LiveKit bandwidth at scale: room-size caps vs revisiting paid tiers
