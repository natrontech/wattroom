# Architecture decision records

One line per decision. [WATTROOM.md](../../WATTROOM.md) is the founding set
and is locked; everything that changed architecture, protocol semantics,
dependencies, product behaviour or tooling since then has a number here
([ADR-0001](0001-adrs-and-founding-decisions.md) is the rule that says so).
Read the row, then the file — the row says whether the decision still stands,
the file says why it was made.

A new decision copies [0000-template.md](0000-template.md), takes the next
free number and lands in the same PR as the change it explains, with a row
added here. Amending a decision means a dated section in its own file plus a
pointer in the "see also" column of both rows; CI fails if a numbered file is
missing from this table or if a relative link in `docs/decisions/` points at a
file that does not exist.

| ADR | Title | Status | See also / superseded by |
| --- | --- | --- | --- |
| [0001](0001-adrs-and-founding-decisions.md) | Record decisions as ADRs; WATTROOM.md is the founding set | accepted | — |
| [0002](0002-single-vm-compose-deploy.md) | Deploy on a single VM with docker compose, not Kubernetes | accepted | Supersedes WATTROOM.md "Deploy" and "Hosting". Deploy path amended by [0019](0019-tagged-releases-and-a-self-converging-vm.md) |
| [0003](0003-spotify-via-jam-link-not-api.md) | Spotify listening via Jam link-out, never via API integration | partially superseded | The Jam card is gone per [0018](0018-one-music-surface-drop-the-jam-card.md); "never API playback" still binds |
| [0004](0004-chrome-first-with-native-escape-hatch.md) | Chrome-first stands; native wrapper is a contained escape hatch, not a rewrite | accepted | — |
| [0005](0005-synthwave-visual-identity.md) | Commit to a full synthwave identity, not near-black with one accent | accepted, amended five times (#113, #230, #292, #331, #397) | Supersedes the palette half of WATTROOM.md §7. How a theme is built: [0023](0023-how-a-theme-is-constructed.md) |
| [0006](0006-alpha-feedback-loop.md) | Ride feedback: in-app flag → GitHub issue → agent fix → deliberate deploy | accepted | The deploy paragraph is superseded by [0019](0019-tagged-releases-and-a-self-converging-vm.md); capture, trace and intake stand |
| [0007](0007-alpha-hardware-is-all-ftms.md) | Alpha hardware is all FTMS; WCPS leaves M1 | accepted | Supersedes the WCPS half of WATTROOM.md's M1 hardware line |
| [0008](0008-heart-rate-retention.md) | Heart rate: live in-room, never in a shared artifact | accepted, amended 2026-08-29 | Zones on top of it: [0014](0014-heart-rate-zones.md) |
| [0009](0009-login-gated-app.md) | Everything behind sign-in | accepted, amended (#111: `/` is public) | — |
| [0010](0010-room-first-positioning.md) | Room-first — WattRoom replaces the voice app, not just the trainer app | accepted, amended twice (#201: chat keeps a bounded history; #681: voice is one tap away, camera never auto-restores) | Chat rule amended by [0022](0022-room-events-are-ephemeral.md); the shape it implies: [0020](0020-the-app-takes-discords-shape.md) |
| [0011](0011-audio-profiles.md) | Two audio profiles — voice is processed, music never is | accepted | — |
| [0012](0012-friends-presence.md) | Friends — mutual only, formed in rooms, presence stays room-bounded | accepted, amended twice (friend code only; DMs #208) | Formation rule amended again by [0024](0024-social-profiles.md) — a shared room is a path beside the code |
| [0013](0013-room-identity-and-moderation.md) | Room identity is an emoji; a ban is a membership role | accepted | Icon and reaction set moved to curated lucide keys in #447; the amendment recording it is #679 |
| [0014](0014-heart-rate-zones.md) | Heart-rate zones anchor on LTHR, derived like power zones from FTP | accepted | Retention of the bpm they colour: [0008](0008-heart-rate-retention.md) |
| [0015](0015-self-hosted-music-pool.md) | Self-hosted music pool — uploaded MP3s join the jukebox | accepted, not yet built (#264, #268) | Amends WATTROOM.md's Jukebox row. Library playlists vs. a pasted one: [0026](0026-a-playlist-is-one-queue-entry.md) |
| [0016](0016-training-load-model.md) | Training load: Coggan math, trademark-safe names, nudges never gates | accepted | — |
| [0017](0017-personal-tokens-and-mcp.md) | Coach access: personal read tokens + a hand-rolled MCP endpoint | accepted | — |
| [0018](0018-one-music-surface-drop-the-jam-card.md) | One music surface — drop the Spotify Jam card | accepted | Supersedes the Jam-card half of [0003](0003-spotify-via-jam-link-not-api.md). Extended by [0026](0026-a-playlist-is-one-queue-entry.md) |
| [0019](0019-tagged-releases-and-a-self-converging-vm.md) | Releases are tags; the VM converges on a pinned tag and rolls itself back | accepted, amended twice 2026-09-01 (CalVer, written changelog; no homelab pin) | Supersedes [0006](0006-alpha-feedback-loop.md)'s deploy paragraph; amends [0002](0002-single-vm-compose-deploy.md) |
| [0020](0020-the-app-takes-discords-shape.md) | The app takes Discord's shape — one frame, one sidebar, no switchable layouts | accepted, amended 2026-09-01 and 2026-09-02 (#477: mixer and gate back in the room) | Builds on [0010](0010-room-first-positioning.md) |
| [0021](0021-rider-scoped-calendar-feed.md) | The calendar feed is addressed to the rider, not the room | accepted | — |
| [0022](0022-room-events-are-ephemeral.md) | Room events ride the tick and are never persisted | accepted | Amends [0010](0010-room-first-positioning.md)'s chat rule: lines persist, events do not |
| [0023](0023-how-a-theme-is-constructed.md) | How a theme is constructed | accepted | Builds on [0005](0005-synthwave-visual-identity.md) |
| [0024](0024-social-profiles.md) | A rider's page shows what rooms already see | accepted | Amends [0012](0012-friends-presence.md). Extended by [0027](0027-an-earned-badge-travels-progress-stays-home.md) |
| [0025](0025-one-sensor-one-screen.md) | One sensor, one screen — the hub arbitrates a claim it cannot hold | accepted | Extends [ARCHITECTURE.md](../ARCHITECTURE.md) seams 1 and 2 |
| [0026](0026-a-playlist-is-one-queue-entry.md) | A YouTube playlist is one queue entry, resolved by the client | accepted | Extends [0018](0018-one-music-surface-drop-the-jam-card.md). Saved playlists are a different object: [0015](0015-self-hosted-music-pool.md), #627 |
| [0027](0027-an-earned-badge-travels-progress-stays-home.md) | An earned badge travels with the rider; progress stays home | accepted | Extends [0024](0024-social-profiles.md) |
