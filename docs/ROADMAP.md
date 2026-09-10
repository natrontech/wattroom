# Roadmap

**This is a current-state document** ([ADR-0050](decisions/0050-founding-record-and-current-state.md)): it describes what WattRoom is now and what is next, and it is edited freely, like code. It is not part of the founding record and carries no freeze.

It began as [WATTROOM.md](../WATTROOM.md) §5, which is frozen and could therefore only go stale — it ended at M6 while 446 M7 issues shipped past it (#656). The decision that shaped the scope stays there: the MVP is deliberately maximalist, because trainer control, rooms, AV and the jukebox together *are* the product.

Milestones map one-to-one onto GitHub milestones. Ticks below are what shipped, not what was planned.

## Shipped

**M0 — Foundations** · closed
Monorepo (`/server` Go, `/web` SvelteKit + Tailwind), docker-compose dev environment, CI from the first commit, the trainer simulator, and a Kickr Core driven over Web Bluetooth — power read, ERG target set, a hardcoded interval ridden ([ADR-0007](decisions/0007-alpha-hardware-is-all-ftms.md)).

**M1 — Solo workout player** · closed 2026-08-29
Workout JSON and the editor, a curated library, the interval graph, FTP scaling, HR/power/cadence pairing and reconnects, intensity bias, skip/extend, the spiral-of-death guard, auto-pause, the built-in ramp test, `.fit` export verified against Strava, and private-by-default ride history.

**M2 — Accounts & rooms** · closed 2026-08-29
OAuth and profiles, persistent rooms with roles, the shared dashboard with a synchronised timer and late join, the Postgres schema, IndexedDB crash safety, and the ADR-0008 HR-sharing control.

*A phone was specified here as a read-only spectator view. It is not one any more:* since #412 a phone loads the full room shell and `device.spectator` gates the affordances that would fail on it ([ADR-0020](decisions/0020-the-app-takes-discords-shape.md), amended).

**M3 — Presence & jukebox** · closed 2026-08-29
LiveKit voice, camera and screenshare; the synced YouTube jukebox with a shared queue and ducking; TV mode.

*The three switchable layouts specified here — metrics-first, video-first, media-focus — never survived:* [ADR-0020](decisions/0020-the-app-takes-discords-shape.md) retired them for one frame that always holds, and [ADR-0046](decisions/0046-one-riding-surface.md) made the room, the solo ride and the ramp test a single screen. The named layouts became *places* with URLs. TV mode is unaffected — it is a viewing distance, not a layout.

**M4 — Stats & game layer** · closed 2026-08-29
The ride completion pipeline in one transaction, FTP auto-detect from the 90-day curve, the live execution meter, post-ride medals and room medal history, sprint moments, room streaks and collective challenges.

**M5 — Game modes** · closed 2026-08-29
The rule-module hook on the room hub, and all seven modes in the order that each proved a new primitive: Backyard Ramp, Sprint Roulette, Watt Golf, Floor is Lava, Points Race, Team Relay, Collective Ramp. Plus the 30-second disconnect grace window and the base sound set.

**M6 — Alpha polish** · closed
Strava auto-upload, account export-all and delete, the production compose stack on a single VM ([ADR-0002](decisions/0002-single-vm-compose-deploy.md)) — wattroom.ch is live — release-driven deploys ([ADR-0019](decisions/0019-tagged-releases-and-a-self-converging-vm.md), owned by the operator's `janlauber/homelab`), calibration and sensor-dropout handling, the login gate and the public landing page.

*The Spotify Jam card listed here as remaining polish was never built:* [ADR-0018](decisions/0018-one-music-surface-drop-the-jam-card.md) deleted it — one room, one music surface. "Never Spotify API playback" ([ADR-0003](decisions/0003-spotify-via-jam-link-not-api.md)) still binds.

## Now

**M7 — The room you live in** · 446 closed, 18 open
The milestone that turned a workout tool into a place. The app took Discord's shape ([ADR-0020](decisions/0020-the-app-takes-discords-shape.md)) — one frame, one sidebar, rooms as channels. Then: text chat with pasted-link unfurls, GIFs and a soundboard ([ADR-0031](decisions/0031-the-server-unfurls-links-riders-paste.md), [0032](decisions/0032-a-gif-picker-proxied-through-the-server.md), [0033](decisions/0033-a-clip-is-a-file-the-room-fetches.md)); friends, presence, direct messages and rider pages ([ADR-0024](decisions/0024-social-profiles.md)); badges that travel with the rider ([ADR-0027](decisions/0027-an-earned-badge-travels-progress-stays-home.md)); planned sessions, RSVPs and a per-rider calendar feed ([ADR-0021](decisions/0021-rider-scoped-calendar-feed.md)); saved playlists ([ADR-0028](decisions/0028-room-and-personal-playlists.md), [0045](decisions/0045-a-saved-playlist-is-a-saved-queue.md)); themes ([ADR-0023](decisions/0023-how-a-theme-is-constructed.md)); crews as the layer above rooms ([ADR-0038](decisions/0038-the-crew-is-the-layer-above-rooms.md)) and a public directory that shows a door, not a window ([ADR-0039](decisions/0039-the-public-room-directory.md)); credentials as a set with email as recovery ([ADR-0029](decisions/0029-one-account-a-set-of-credentials.md), [0035](decisions/0035-stored-credentials-are-sealed-with-a-key-from-the-environment.md)); mail ([ADR-0030](decisions/0030-what-wattroom-emails.md)); session recaps ([ADR-0034](decisions/0034-a-session-leaves-one-recap.md)); what a room shows about its members ([ADR-0036](decisions/0036-what-a-room-shows-about-its-members.md)); clean full-band voice ([ADR-0043](decisions/0043-voice-goes-out-clean.md)); and one riding surface ([ADR-0046](decisions/0046-one-riding-surface.md)).

**M8 — Off the browser** · 9 closed, 2 open
An Electron shell for what a tab cannot reach ([ADR-0037](decisions/0037-a-desktop-shell-for-what-the-browser-cannot-reach.md)): macOS system audio, a floating HUD ([ADR-0041](decisions/0041-the-hud-mirrors-the-riding-screen.md)), notifications that answer back ([ADR-0042](decisions/0042-notifications-answer-back.md)), deep links, sign-in handed back from the browser ([ADR-0040](decisions/0040-desktop-sign-in-happens-in-the-browser.md)) and self-update. The web app stays the product. ANT+ — the shell's other founding justification — is unbuilt and backlogged as #2056.

## The fast-follows, seven years later

WATTROOM.md called seven things "explicitly not MVP". Four shipped in M7: **text chat**, **scheduling + RSVP + iCal**, **in-app invites** (as the crew's invite, [ADR-0038](decisions/0038-the-crew-is-the-layer-above-rooms.md)) and the **opt-in public room directory** ([ADR-0039](decisions/0039-the-public-room-directory.md)). **Custom sound and reaction packs** have their groundwork in the soundboard ([ADR-0033](decisions/0033-a-clip-is-a-file-the-room-fetches.md)) but no per-room upload.

Still not built: **`.zwo`/`.erg` import** and **intervals.icu sync**. The ride-export destinations — Garmin ([ADR-0044](decisions/0044-garmin-completed-rides-via-manual-fit.md)), Apple Health, intervals.icu, TrainingPeaks, Android Health Connect — are indexed on #806, and all five wait on the same prerequisite: FIT download from `/history`, validated through one manual import.

## What decides what comes next

The alpha's success signal is unchanged and still lives in [WATTROOM.md](../WATTROOM.md) §Validation: **the crew choosing WattRoom weekly, unprompted.** Widening comes after that, not before it.
