# WattRoom — Technical Research Report

Deep-research validation of the decisions in [WATTROOM.md](../WATTROOM.md), run 2026-07-16.
Three research passes: domain tech (107 agents, 25 claims adversarially verified 3–0), dev tooling & CI (105 agents, 24 claims verified 3–0), and a gap-fill pass (in flight — see §8).
Confidence tiers: **verified** = survived 3-vote adversarial verification against primary sources; **extracted** = sourced claim from the research pass, not adversarially verified.

---

## 1. Web Bluetooth + FTMS — decision holds

**Verified:**
- Web Bluetooth ships on Chromium only: Chrome 70+/Edge 79+ on Windows (10 1703+), macOS, Android 6+. Safari/WebKit: "not supported and no plan to support it." No native iOS path exists. ([implementation-status](https://github.com/WebBluetoothCG/web-bluetooth/blob/main/implementation-status.md), [caniuse](https://caniuse.com/web-bluetooth) ~76% global, Chromium-only)
- FTMS v1.0 (still current) has exactly our two control procedures: **Set Target Power (0x05)**, SINT16 watts, 1 W resolution; **Set Indoor Bike Simulation (0x11)**, 6-byte payload — wind SINT16 @0.001 m/s, grade SINT16 @0.01 % (signed percentage), Crr UINT8 @0.0001, Cw UINT8 @0.01 kg/m. ([FTMS v1.0 spec](https://www.onelap.cn/pdf/FTMS_v1.0.pdf), corroborated by Auuki/pycycling/SmartSpin2k)
- **Live ERG↔slope switching is spec-legal**: one Request Control (0x00) grant covers all procedures until disconnect; contradicting ops are last-write-wins. **But**: every procedure completes via indicated Response Code (0x80), and a write during an in-progress procedure errors un-queued → the FTMS layer must serialize control-point writes behind each indication.
- Auuki is AGPL-3.0, actively maintained (pushed 2026-03). Its BLE layout is the reference pattern: `src/ble/` with one folder per GATT service (ftms/, wcps/ Wahoo, fec/ Tacx FE-C, hrs/, cps/, cscs/, bas/) over shared connection primitives. **It implements proprietary fallbacks because FTMS alone leaves real trainers uncontrollable** — pre-2020 Wahoo lack FTMS, Tacx NEO exposes only FE-C.

**Consequences applied to the doc:** control-point write queue is mandatory; WCPS fallback is the named escape hatch (Kickr v2 test unit may need it — gap-fill pass verifying); Auuki is read-reference only.

## 2. LiveKit self-hosted on k8s — decision holds

**Verified:**
- Licensing clean: server Apache-2.0 (Go/Pion), Go server SDK `github.com/livekit/server-sdk-go/v2` Apache-2.0, **v2.18.1 published 2026-07-15**, active cadence. Token minting lives in `github.com/livekit/protocol/auth`: `NewAccessToken → SetVideoGrant (AddGrant deprecated) → ToJWT`.
- Deployment: Redis **not** required single-node (recommended for prod, required multi-node — split-brain otherwise). TURN is embedded (TURN/TLS 5349, TURN/UDP 443) — no coturn. Ports: 7880 WS signaling, 7881 WebRTC/TCP, UDP 50000–60000 media. **k8s requires `hostNetwork: true` (one pod per node) and direct firewall exposure; private/NAT-ed clusters unsupported.** ([deployment docs](https://docs.livekit.io/transport/self-hosting/deployment/), [k8s docs](https://docs.livekit.io/transport/self-hosting/kubernetes/))
- Capacity: LiveKit's benchmark sustains 150 pub × 150 sub (720p simulcast) at 85 % CPU on a 16-core c2-standard-16. A 12-rider room ≈ 132 forwarded streams — a small fraction of one node even at half the vendor numbers. One room must fit on one node (irrelevant at our size); scale = spread rooms across nodes.
- LiveKit server current: **v1.13.3 (2026-07-03)**, ~monthly release cadence.

**Consequences:** Natron-cluster deploy must budget hostNetwork + UDP exposure on node IPs — this is the ops constraint to check against the shared-cluster decision before alpha widens.

## 3. YouTube jukebox — decision adjusted

**Verified against [RMF](https://developers.google.com/youtube/terms/required-minimum-functionality) (updated 2026-04-28) + [Developer Policies](https://developers.google.com/youtube/terms/developer-policies):**
- No overlays/frames/visual elements in front of any part of the embedded player, including controls.
- Player viewport ≥ 200×200 px, cannot be shrunk or hidden.
- No programmatic playback until >50 % of the player is visible on screen.
- Policies III.I.7/III.I.9: no separating audio from video, no background players → **audio-only jukebox mode is prohibited**.

**Applied to the doc:** jukebox = dedicated always-visible ≥200×200 tile, nothing overlaid, auto-advance only while visible, no audio-only mode. Whether multi-client *synchronized* playback itself is compliant was not settled — gap-fill pass researching how Watch2Gether-class apps survive.

## 4. Strava + .fit ecosystem — holds with constraints (extracted tier)

- Nov 2024 API agreement: third-party apps may only display a user's Strava data **to that user**; bans Strava data in AI/ML models. Upload-only usage (our case) appears unaffected; never display Strava-pulled data to other room members. ([Strava press](https://press.strava.com/articles/updates-to-stravas-api-agreement), [DC Rainmaker](https://www.dcrainmaker.com/2024/11/stravas-changes-to-kill-off-apps.html)) — gap-fill pass verifying upload mechanics, rate limits, VirtualRide conventions.
- .fit encoding in Go: **muktihari/fit** — actively maintained (v0.28.1, 2026-05-20, 93 releases); tormoder/fit unmaintained since Sept 2024, its README points to muktihari/fit.

## 5. Go realtime stack — holds (extracted tier)

- WebSocket: **coder/websocket** — gorilla/websocket is archived; coder/websocket is maintained, context-aware, safe concurrent writes. ([websocket.org guide](https://websocket.org/guides/languages/go/))
- goose **v3.27.2** (2026-06-30): `validate` command = CI migration lint; hybrid workflow (timestamped in dev, `goose fix` → sequential in CI); supports go:embed self-migrating binary.
- sqlc + pgx v5 remain the standard pairing (sqlc docs first-class pgx support).

## 6. Versions to pin at M0 (verified 3–0 unless noted)

| Thing | Pin | Note |
|---|---|---|
| Go | **1.26.x** (1.26.5, 2026-07-07) | Air requires ≥1.25 |
| SvelteKit | **≥2.68** | config now passable via Vite plugin; scaffold with `sv create` (sv@0.16) |
| Vitest | **4.x** (4.1.10) | browser mode stable; `vitest-browser-svelte` is first-party for Svelte 5 |
| Playwright | **~1.61** | official CI image v1.61.0-noble; checkout@v5/setup-node@v6; **don't cache browser binaries** (restore ≈ download time) |
| golangci-lint | **v2.12.x** | v2 YAML config; `golangci-lint migrate` exists for v1 configs |
| goose | **v3.27.x** | extracted tier |
| LiveKit server | **v1.13.3** | monthly cadence — Renovate it |
| livekit server-sdk-go | **v2.18.x** + livekit/protocol for auth | |
| CloudNativePG | **1.30.x** (2026-06-29) | PG major version support: check CNPG docs at scaffold (releases page doesn't state it) |
| PostgreSQL | 18 (via CNPG) | inference: PG18 GA since 2025-09; verify against CNPG 1.30 support matrix |
| Node / pnpm / Tailwind / TS | Node 24 LTS, pnpm 10, Tailwind v4, TS current | knowledge-cutoff tier — confirm at scaffold |

## 7. Dev loop, testing, CI (verified + extracted)

**Local loop:**
- Go hot reload: **Air** (v1.65.3, 2026-05-21; ~24k stars, dominant over wgo).
- Topology: Vite dev server in front, proxying to Go — `server.proxy` with `ws: true` handles the room WebSocket; one `/api` prefix key routes REST.
- Containers: Postgres + LiveKit in compose; run Go (air) and Vite natively for sub-second iteration. Compose Watch only helps for locally-built services (sync for Vite, rebuild for Go) — native + proxy is simpler. Tilt/Skaffold: overkill at 2 services.

**Testing:**
- Goroutine-heavy hub code: **`testing/synctest`** (Go 1.24+, experimental) — fake clock advances when all goroutines block; interval-timer and tick-coalescing tests run instantly and deterministically. Made for exactly our room hub.
- DB integration: **testcontainers-go Postgres module** — `WithInitScripts` for goose migrations/seed, snapshot/restore for fast per-test resets (don't name the container DB `postgres`), set an explicit wait strategy (log + port) or CI flakes.
- Race detector on in CI; golden-file tests for .fit output.
- Svelte 5 components: Vitest browser mode + vitest-browser-svelte (first-party).

**CI/CD:**
- Actions: checkout@v5, setup-node@v6, upload-artifact@v5 (per Playwright's current docs); setup-go built-in caching; pnpm needs explicit store caching keyed on pnpm-lock.yaml.
- **Renovate over Dependabot**: 90+ ecosystems incl. Docker Compose, k8s manifests, Helm; built-in automerge; regex managers for versions embedded in Dockerfiles/CI — all present in this repo.
- Load testing: **k6** `k6/websockets` module (living-standard API; older k6/experimental/websockets deprecated); VU = long-lived socket with event loop — fits a riders×rooms telemetry simulation; assert on HTTP 101.
- Deploy proportionality (extracted, opinion-tier): Kustomize > Helm for own services; ArgoCD threshold ≈ >3 environments — plain apply from CI is proportionate for alpha. Staging = a namespace; PR preview deploys not worth it at this scale.

## 8. Gap-fill findings (inline research tier — sourced, not adversarially verified)

The workflow pass for these areas was killed three times by transient API overload; researched inline instead.

**Kickr FTMS reality:**
- FTMS arrived via firmware in **2021**: Kickr Core fw 1.1.1 (2021-06-01), Kickr v5 fw 4.2.1/4.2.3 (2021). ([Core release notes](https://support.wahoofitness.com/hc/en-us/articles/360000217839-KICKR-CORE-Firmware-Release-Notes), [v5 notes](https://support.wahoofitness.com/hc/en-us/articles/360016826680-KICKR-v5-2020-Firmware-Release-Notes))
- **Kickr v2 (2016)** has its own firmware line with no FTMS mention ([v2 notes](https://support.wahoofitness.com/hc/en-us/articles/115001515604-KICKR-v2-2016-Firmware-Release-Notes)) — presume **WCPS-only**. Definitive answer is one GATT service enumeration away: M0's first hardware session must enumerate services on the v2; if no FTMS, the WCPS module moves from "later" to M1.
- **Smoking gun for sprint switching**: Kickr Core fw **1.4.8 (2024-03-05) fixed a "2000 watt power spike when switching between ERG/SIM"** — the exact transition sprint moments perform. Consequence: require/recommend current trainer firmware, and ramp the slope-mode entry gently rather than assuming a clean switch.

**Testing without hardware:**
- Chromium has a CDP **BluetoothEmulation** domain (FakeBluetooth backend) used by Web Platform Tests ([Chromium bluetooth test docs](https://chromium.googlesource.com/chromium/src/+/HEAD/device/bluetooth/test/README.md)), but **Playwright does not expose it** as a supported API in 2026.
- Practical answer (as planned): **dependency-injected BLE layer** — the app's trainer interface has a `SimulatedTrainer` implementation (models: first-order power lag toward target, cadence, gaussian noise, optional dropout injection) selectable via dev flag. Playwright drives the app with the simulator; no real Bluetooth in CI. Hardware-side emulators (ESP32 `ftms_emu`) exist for bench testing real Web Bluetooth paths, optional.

**WS schema codegen — winner: Go-first with tygo.**
- The Go structs (which the server already needs) are the single source of truth; [tygo](https://github.com/gzuidhof/tygo) emits TypeScript interfaces from them in CI. One tool, no schema files, satisfies the "defined once, both sides generated" decision with the least machinery.
- Alternative if runtime validation from schema becomes needed: JSON Schema files → [json-schema-to-typescript](https://www.npmjs.com/package/json-schema-to-typescript) + go-jsonschema; Google shipped an official [jsonschema-go](https://opensource.googleblog.com/2026/01/a-json-schema-package-for-go.html) package (Jan 2026) for validation.

**Watch-together sync mechanics:**
- Standard architecture matches ours: server/host is the **clock authority** issuing authoritative PlaybackState snapshots; clients chase. State-of-practice drift correction is **tiered**: small drift → nudge `playbackRate` (soft-sync, imperceptible), large drift (~>2 s) → hard `seekTo`. ~200 ms cross-client alignment is achievable. ([soft-sync architecture](https://www.researchgate.net/publication/403258602_An_Authoritative_Client-Server_Architecture_for_Real-Time_Media_Synchronization_Utilizing_Dynamic_Playback_Rate_Modulation), [SyncTube](https://sync-tube.de/), [ViewSync](https://viewsync.net/))
- No TOS findings against coordinated play/pause/seek itself beyond the RMF rules already in the doc; Watch2Gether/SyncTube-class apps operate openly on the IFrame API. Their pain point is **embed-disabled music content** (labels/Vevo) — mitigate by resolving queue entries via Data API and surfacing "not embeddable" before playback. Quota note (knowledge tier): `search.list` costs 100 units of the 10k/day default — prefer paste-a-URL + `videos.list` (1 unit) over in-app search for MVP.

**Strava upload path:**
- Upload = `POST /uploads` with `activity:write` scope, .fit is the native format (FIT_FILE_TYPE=4), async processing with status polling. ([uploads docs](https://developers.strava.com/docs/uploads/))
- **New apps start in "Single Player Mode" (athlete capacity 1)**; the **Standard Tier covers up to 10 users without application review**; Extended Access (review required) for more. Default rate limits 200 req/15 min, 2 000/day. ([rate limits](https://developers.strava.com/docs/rate-limits/), [API FAQ](https://communityhub.strava.com/developers-knowledge-base-14/strava-api-faq-12906))
- **This maps perfectly onto the alpha plan**: your own circle fits the ≤10 Standard Tier with no review; Extended Access review only becomes necessary when widening. Upload-only usage doesn't touch the Nov-2024 display restrictions.

---

## 9. Dual-trainer support: Kickr Core (FTMS) + Kickr v2 (WCPS)

The actual alpha hardware: one Kickr Core (FTMS since fw 1.1.1) and friends on Kickr v2 (2016). The v2 predates FTMS and never received it — it's controlled via **Wahoo's proprietary BLE protocol (WCPS)**: an unlisted characteristic **`A026E005-0A7D-4AB3-97FA-F1500F9FEB8B`** hanging off the standard **Cycling Power Service (0x1818)**. Undocumented by Wahoo; protocol facts recovered from open implementations (Auuki `src/ble/wcps`, GoldenCheetah [PR #3472](https://github.com/GoldenCheetah/GoldenCheetah/pull/3472), [sensors-swift-trainers](https://github.com/codeinversion/sensors-swift-trainers)). Zwift/TrainerRoad controlled the v2 this way for years — it's proprietary but battle-tested.

**WCPS protocol (facts, from reference implementations — write our own code):**

| Command | Op | Payload (little-endian) |
|---|---|---|
| Unlock (required first) | 0x20 | `[0x20, 0xEE, 0xFC]` |
| Set ERG power | 0x42 | uint16 watts, 1 W resolution |
| SIM mode params | 0x43 | weight ×0.01 kg, Crr ×0.0001, wind resistance ×0.001 kg/m |
| Grade | 0x46 | `(grade/100 + 1) × 32768`, −100…+100 % |
| Wind speed | 0x47 | `(v + 32.768) × 1000` m/s |
| Load level / intensity | 0x41 / 0x40 | level 0–9 / `(1 − x) × 16383` |
| Wheel circumference | 0x48 | ×0.1 mm |

Responses arrive as notifications: `[status (0x01 ok), request op, type, …]` — so WCPS writes get the same serialized-behind-response queue as FTMS.

**Driver architecture (client):**

```
Trainer interface: setTargetPower(w) · setSim(grade) · streams(power, cadence, speed)
  ├─ FtmsTrainer   (0x1826: Set Target Power 0x05 / Indoor Bike Sim 0x11, Indoor Bike Data)
  ├─ WcpsTrainer   (0x1818 + A026E005: unlock → 0x42 ERG / 0x43+0x46 sim-grade, data from CPS 0x2A63)
  └─ SimulatedTrainer (dev/CI)
```

- **Detection**: `requestDevice` filters on services `[0x1826, 0x1818]` with both in `optionalServices` (Web Bluetooth only exposes pre-declared services). After connect: FTMS present → FtmsTrainer; else CPS + Wahoo characteristic → WcpsTrainer. The Kickr Core exposes both — prefer FTMS.
- **Sprint moments work on both**: FTMS flips 0x05↔0x11; WCPS flips 0x42↔0x46 (with 0x43 sim params set once at session start). Same rider UX, two encodings.
- **Data**: Core streams power+cadence via FTMS Indoor Bike Data; v2 streams power via standard Cycling Power Measurement (0x2A63). **The 2016 v2 does not reliably provide cadence** — v2 riders pair a BLE cadence sensor (CSC profile, already in scope). The spiral-of-death guard must degrade gracefully when cadence is absent (fall back to power-collapse detection).
- **Spindown/calibration**: proprietary on the v2 — defer to the Wahoo app for both trainers in MVP (standard practice among third-party apps).
- **Licensing**: protocol constants (UUIDs, op codes, scaling) are facts and fine to use; the WCPS driver is written fresh, no Auuki code copied.
- **Zwift Cog / virtual shifting**: irrelevant in ERG (trainer holds watts regardless of gear — the Cog works fine, as with TrainerRoad/MyWhoosh). In **slope mode** a Cog'd trainer is one fixed gear: virtual shifting is Zwift-proprietary (Click/Play pair only with the Zwift app; patented — US11986700/US12465816), no third-party API shipped yet despite announcements. Consequence: sprint moments get a per-rider sprint-grade setting instead of shifting (#31); don't implement app-side virtual shifting unless the official API lands. ([DC Rainmaker](https://www.dcrainmaker.com/2024/02/wahoo-kickr-review.html), [Makinolo protocol analysis](https://www.makinolo.com/blog/2023/11/06/virtual-gear-shifting-in-indoor-training/), [Zwift Cog third-party guide](https://www.gatebreakendurance.com/cycling/zwift-cog-with-other-cycling-apps/))

## 10. Implementation depth: media & realtime (verified 3–0 unless noted; run of 2026-08-25)

**YouTube IFrame API for the jukebox:**
- `setPlaybackRate` **rounds unsupported rates toward 1** — a 1.03× nudge may silently become 1.0×. Gate on `getAvailablePlaybackRates()`; only `onPlaybackRateChange` confirms. → SPEC revised to a seek-first design.
- `seekTo` needs `allowSeekAhead=true` for unbuffered regions and may land on an earlier keyframe — always **re-measure drift after a seek**.
- Blocked entries surface at play time via `onError`: **100** removed/private, **101/150** embed-disallowed (150 also fires for some region/age cases), **153** missing referrer (new July 2025 — serve the embed with a proper referrer policy).
- Reference implementation: [OpenTogetherTube](https://github.com/dyc3/opentogethertube) ships single-tier hard-seek at >1 s drift with 250 ms local dead-reckoning and **no clock-offset estimation at all** — the field gets away with much simpler than our spec assumed.

**LiveKit JS SDK (v2.22.0, Aug 2026 — stable 2.x line, no migration risk):**
- Ducking: `RoomEvent.ActiveSpeakersChanged` (loudest-first, includes local participant) drives it; `RemoteParticipant.setVolume(v, source)` ducks specific sources; `RoomOptions.webAudioMix` (default **false**) routes all LiveKit audio through a caller-supplied AudioContext for one unified mixing graph with jukebox + SFX.
- **`adaptiveStream` and `dynacast` are both OFF by default** — must be explicitly enabled; they're the core scaling levers for 12-rider rooms.
- `publishDefaults` are a sound baseline (simulcast on, VP8+backup, music audio preset with DTX+RED, screenshare 1080p15).
- Reconnect UX: distinct `Reconnecting` (media interrupted → persistent dashboard status) vs `SignalReconnecting` (transparent) events; `ConnectionQualityChanged` covers per-rider badges.
- Tokens: the server proactively refreshes tokens for *connected* clients — Go only mints short-TTL join tokens (page reload still needs a fresh mint).

**Web platform for the feel layer:**
- One user gesture (the "join room" click) resumes a suspended AudioContext for **all** future SFX — hang the unlock there. The YouTube iframe additionally needs `allow="autoplay"` delegation + prior domain interaction for unmuted starts.
- Screen Wake Lock is **Baseline since March 2025** — rely on it, but handle rejection (battery saver) and re-acquire on `visibilitychange`.

**Still open (no surviving claims — settle by doing):** exact muktihari/fit message sequence Strava accepts for a synthetic VirtualRide (→ hands-on encode-and-upload spike in #5); Go-side clock-sync/tick-layout patterns (→ decide in M2 implementation; note OTT ships fine with zero clock sync); empirical fine-grained playbackRate support on current embeds.

## Ranked risks to the plan

1. ~~Kickr v2 lacks FTMS~~ **Resolved → planned work** — confirmed the v2 is WCPS-only; full protocol mapped (§9) and the WcpsTrainer driver is now M1 scope. Residual risk (low): protocol facts come from reverse-engineered implementations, not Wahoo docs — verify against the real v2 early in M1.
2. **YouTube jukebox TOS** (high, confirmed) — RMF constraints reshape the room UI (always-visible ≥200×200 player, no overlays, no audio-only). Coordinated sync itself appears tolerated in practice (Watch2Gether-class apps); embed-disabled music content is the practical annoyance.
3. **ERG↔SIM switching is firmware-sensitive** (medium, evidenced) — Wahoo fixed a 2 kW power spike on exactly this transition in 2024. Sprint-moment code should ramp into slope mode and treat the transition defensively.
4. **LiveKit on shared Natron cluster** (medium, confirmed constraint) — hostNetwork + public UDP on node IPs on a company cluster; revisit before widening.
5. **Strava API terms drift** (medium) — upload-only within the ≤10-athlete Standard Tier is clean today; Strava has shown willingness to break third parties on short notice (Nov 2024). Extended Access review is a gate before any public widening.
6. **Web Bluetooth = Chromium forever** (low, accepted) — Safari's explicit refusal caps the platform; already a locked decision.
