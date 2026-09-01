# Changelog

All notable changes to WattRoom are recorded here.

The format is [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/).
Versions are [CalVer](https://calver.org/) `YYYY.0M.MICRO` — `2026.09.1`, then
`2026.09.2`, and MICRO back to 1 next month. The number tells you _when_ a
release is from; whether it breaks anything for you is what the headings below
are for, so read Changed and Removed rather than counting digits.

Entries are written by whoever did the work, in the PR that did it, as a file
in [`changelog.d/`](changelog.d/) — one per PR, so parallel work never collides
on this file. `make release` collates them into a dated section and deletes
them. Nothing here is generated from commit
subjects on purpose: a changelog is for the person deciding whether to upgrade,
not a second copy of `git log`.

## [Unreleased]

## [2026.09.6] - 2026-09-01

### Changed

- The whole app now sits in one frame. A single sidebar holds your places, your rooms, and — for the room you are standing in — the places inside it: Lounge, Training, Sessions, Members and Settings, each with its own link. The top bar and the phone tab bar are gone, and so are five destinations: Rooms, Sessions, Progression, Ramp test and Sensors have moved into the pages they belonged to. Rides now carries the charts that were on Progression; Home carries what is planned across every room, and the forms for opening and joining one.
- Training is rebuilt around one question — am I on target. Your watts travel over a track marking the tolerance band, the interval graph runs along the bottom, and the whole crew is on screen with camera, watts, w/kg, rpm and bpm. When someone shares a screen the player takes over and your numbers move beneath it; when a sprint is armed or a game is running, that takes the screen and gives it back. The solo ride and the ramp test use the same instrument.
- Direct messages and friends are places now, not a box in the corner — a conversation shows who you are talking to, whether they are riding, and a way to join them.
- A room you are not looking at finally says so: an unread count on the rail, and the room name in bold, cleared when you open it.
- "Riding now" stops being a pink dot that read like something was broken. It is the WattRoom mark's own equalizer bars, moving.
- TV mode shows the same instrument as the training view, sized for the sofa: your watts travel over the tolerance band, so "am I on target" reads from three metres the way it reads from the saddle. One design at two distances instead of two designs.

### Fixed

- A solo ride or ramp test in light mode now darkens the whole frame, sidebar included — the ride is the cave whether or not anyone else is in it. Leaving either page mid-ride now really ends the session, so the trainer no longer keeps holding a target for a screen that is gone.
- Training: the crew strip is a row of fixed-size thumbnails again, so one other rider no longer fills the column and squeezes your instrument; sprint standings are sized for the 3 m surface.

## [2026.09.5] - 2026-09-01

### Changed

- Changelog entries are one file per pull request now, collated at release —
  so parallel work stops colliding on a single file, and an entry can no longer
  be lost in a rebase conflict.

## [2026.09.4] - 2026-09-01

### Added

- The landing page carries two live numbers: how many riders are online right
  now (it hides itself when nobody is), and the repo's real star count next to
  the GitHub link.
- `wattroom_room_riding` on `/metrics`: how many riders have sent a power
  sample in the last 10 seconds, as opposed to how many are sitting in a room.
  Anyone automating deploys can use it to avoid restarting mid-interval — a
  room between sessions no longer looks like a ride in progress.

### Fixed

- What's new no longer goes blank. Any release note that used the same code
  span twice in one line — `deploy/` did, in 2026.09.3 — took the whole page
  down with it.

## [2026.09.3] - 2026-09-01

### Added

- The room's chat now carries what the room did with its plan: a session
  planned, moved or cancelled, one starting and one finishing, and a reminder
  ten minutes before a planned session is due.

### Changed

- The room is two tabs instead of one long scroll: Room holds the shared
  screen and the rider tiles, Training holds the clock, the interval, your
  target and the graph — and a session starting takes you straight to it.
- A finished session now opens its summary over the room instead of drawing it
  below the fold, where riders watching the shared screen never saw it.
- Planning a session from the Sessions page opens the room's own picker, so
  you see the graph, the zones and the cadence bands before you commit a room
  to a workout.
- Appearance themes now recolour the whole app — surfaces, text, accents, and
  power zones — with matching dark and daylight variants instead of changing
  only two accent colours.
- The end-to-end smoke fixture is one minute of riding instead of two, which
  halves the slowest job in CI. It is a test fixture — never listed, resolvable
  by id only — so no workout anyone can pick changed length.

### Removed

- `deploy/` no longer ships an auto-updater: `wattroom-update.sh` and its
  systemd unit and timer are gone. Deploying is the operator's job — for
  wattroom.ch it lives in `janlauber/homelab` — and `deploy/` is the
  self-hosting reference and the home of the alert rules, nothing more. Pin a
  release tag in your own compose file and roll it forward however you already
  roll anything else forward.

### Fixed

- The page no longer scrolls by the height of the top nav: the room fills
  exactly what is left of the screen instead of one nav-bar too much.
- Stopping a screen share from the browser's own bar now ends it in the room.
  The button had gone on offering to stop a share that was already over, and
  the stage sat on its last frame while the room saw nothing.
- A dropped connection no longer leaves the mic button reading "on" with no
  mic behind it — which stuck permanently when the rejoin also failed.

### Security

- Corrected the 2026.09.1 note about the `/metrics` exposure: it claimed
  nothing was exposed in practice, which was wrong. wattroom.ch was already
  live, so the endpoint was public for as long as the site had been running.

## [2026.09.2] - 2026-09-01

*Reconstructed 2026-09-01: this release originally listed only the first entry
below. Six other changes shipped in it, three of them rider-visible, because
the per-PR changelog rule landed mid-flight and nothing enforced it.*

### Added

- What's new: the app shows the changelog of the version it is running, and
  says so once when a new version has landed — on the home screen, never
  during a ride.
- The room's video plays *on* the stage instead of floating over it. The
  player seats into the stage layout, and floats again — at the size and
  position you gave it — when you leave the room or scroll the stage away.

### Fixed

- Live numbers are readable on rider tiles and in TV mode. Name, watts and the
  bpm/rpm/w·kg row now sit on an edge scrim rather than on whatever the camera
  is pointing at, and TV mode no longer greys out the number while
  highlighting the unit.
- Picking a rider for the stage no longer blanks their tile. A camera track is
  deliberately mounted twice — tile and stage — and each mount was tearing the
  other one down, so both went black for as long as the pick stood.

## [2026.09.1] - 2026-09-01

*The first tagged release. WattRoom was built and deployed for months before
releases existed, so this section describes what the alpha comprises rather
than itemising the changes that got it there — those are the issue board and
the git history.*

### Added

- Solo workout player: FTMS trainer control, heart-rate/cadence/power sensor
  pairing over Web Bluetooth, a workout format with an editor and a curated
  library, interval graph with FTP scaling, a built-in ramp test, and `.fit`
  export that Strava classifies as a Virtual Ride.
- Rooms: social sign-in and profiles, persistent rooms with roles, the 1 Hz
  live dashboard, an IndexedDB crash buffer that survives a reconnect, and a
  phone spectator view behind the share link.
- Presence: LiveKit voice and camera, three room layouts plus TV mode, and a
  synced YouTube jukebox that ducks under voice — with a playlist, votes and
  play history.
- Stats and the game layer: the one-transaction ride completion pipeline, FTP
  auto-detection, a live execution meter, medals, room streaks and challenges,
  and sprint moments.
- Seven game modes with their own heroes, room-level sound packs, cheers and
  quick reactions.
- Friends and presence, direct messages, and room chat with image support.
- Personal read tokens and an MCP endpoint for your own data (ADR-0017).
- Production deploy: a single-VM compose stack behind Caddy, nightly `pg_dump`,
  tagged releases, and a systemd timer that converges the VM onto the pinned
  release and rolls itself back if the new one fails its health gate
  (ADR-0019).

### Changed

- `/api/healthz` performs a real database ping instead of always answering
  `ok`, and `/api/version` reports the release tag it was built as — both so a
  deploy can be gated on them rather than on hope.

### Security

- `/metrics` is no longer proxied to the public internet. Until this release
  wattroom.ch served rider counts and Go runtime internals to anyone who asked
  for them.

  *Corrected 2026-09-01.* This entry first claimed the exposure was caught
  before wattroom.ch was ever deployed and that nothing was exposed in
  practice. That was wrong — the site was already live, so the endpoint was
  reachable for as long as it had been running. The fix itself is unchanged;
  only the claim about impact was false.

[Unreleased]: https://github.com/natrontech/wattroom/compare/2026.09.6...HEAD
[2026.09.6]: https://github.com/natrontech/wattroom/compare/2026.09.5...2026.09.6
[2026.09.5]: https://github.com/natrontech/wattroom/compare/2026.09.4...2026.09.5
[2026.09.4]: https://github.com/natrontech/wattroom/compare/2026.09.3...2026.09.4
[2026.09.3]: https://github.com/natrontech/wattroom/compare/2026.09.2...2026.09.3
[2026.09.2]: https://github.com/natrontech/wattroom/compare/2026.09.1...2026.09.2
[2026.09.1]: https://github.com/natrontech/wattroom/releases/tag/2026.09.1
