# Changelog

All notable changes to WattRoom are recorded here.

The format is [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/).
Versions are [CalVer](https://calver.org/) `YYYY.0M.MICRO` — `2026.09.1`, then
`2026.09.2`, and MICRO back to 1 next month. The number tells you _when_ a
release is from; whether it breaks anything for you is what the headings below
are for, so read Changed and Removed rather than counting digits.

Entries are written by whoever did the work, in the PR that did it, under
`## [Unreleased]`. `make release VERSION=vX.Y.Z` promotes that section into a
dated release and opens a fresh one. Nothing here is generated from commit
subjects on purpose: a changelog is for the person deciding whether to upgrade,
not a second copy of `git log`.

## [Unreleased]

### Changed

- Appearance themes now recolour the whole app — surfaces, text, accents, and
  power zones — with matching dark and daylight variants instead of changing
  only two accent colours.

### Fixed

- The page no longer scrolls by the height of the top nav: the room fills
  exactly what is left of the screen instead of one nav-bar too much.

## [2026.09.2] - 2026-09-01

### Added

- What's new: the app shows the changelog of the version it is running, and
  says so once when a new version has landed — on the home screen, never
  during a ride.

## [2026.09.1] - 2026-09-01

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

- `/metrics` is no longer proxied to the public internet. The deploy config
  would have served rider counts and Go runtime internals to anyone; caught
  before wattroom.ch was ever deployed, so nothing was exposed in practice.

[Unreleased]: https://github.com/natrontech/wattroom/compare/2026.09.2...HEAD
[2026.09.2]: https://github.com/natrontech/wattroom/compare/2026.09.1...2026.09.2
[2026.09.1]: https://github.com/natrontech/wattroom/releases/tag/2026.09.1
