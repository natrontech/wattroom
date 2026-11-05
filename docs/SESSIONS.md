# Sessions on their own

Status: plan, agreed with Jan on 2026-11-03. Each PR below edits [WATTROOM.md](../WATTROOM.md) for the part it ships.

A session is a group ride: a coach, a shared workout timeline, live numbers between its riders. Today it runs inside one voice channel. This plan takes it out. A session becomes a live object of the crew, with its own goroutine, clock and socket. A voice channel becomes a call and nothing else. It still shows who in it is riding, and on which session, with a way to join.

## Decisions

Taken with Jan on 2026-11-03:

1. **Several sessions at once.** A crew can run any number side by side. Each has its own id, socket and clock.
2. **A channel shows a badge, never numbers.** Watts, heart rate and cadence exist only inside a session. Riding together without a workout is a session with no workout ("Ride together"). It replaces the free ride's audience in the call.
3. **Announce, never bind.** Start a session while in a call and that call gets one line with Join. Joining a session never touches your call. A session names no channel.
4. **The sidebar lists live sessions at the top of the crew column.** One row each: name, coach, riders, clock. Nothing shows while none runs.

## Today

Where a session assumes a voice channel:

| Layer | Coupling |
| --- | --- |
| Hub | `channelState` ([channel.go](../server/internal/hub/channel.go)) is the voice channel's goroutine. It holds the call (clients, voice, jukebox, lounge, board, away) and the session (`session`, `record`, `sprint`, `game`, the bunch, start line, roadside, execution, recap, presence spans) in one struct, ticked by one loop ([tick.go](../server/internal/hub/tick.go)). At most one session per channel ([session.go](../server/internal/hub/session.go)). |
| Free ride | A free rider's metrics go to the channel tick. Everyone with the channel open sees them ([channel_ride.go](../server/internal/hub/channel_ride.go) `setMetrics`). |
| Socket | One socket per rider, `/ws/channels/{id}`, gated by `Access.Authorize` per channel. Session controls (`pick`, `start`, `join` …) ride it. |
| Lists | `GET /api/crews/{id}/live` walks the crew's voice channels and asks each for its session ([live.go](../server/internal/channels/live.go)). |
| Durable | Rides and `session_recaps` carry `channel_id`. A recap is gated by its channel's privacy, and a recap with no channel is shown to admins only ([recaps.sql](../server/internal/store/queries/recaps.sql)). `scheduled_sessions.channel_id` is nullable already (null is crew-wide) and is stamped when a plan starts ([schedule.sql](../server/internal/store/queries/schedule.sql)). |
| Roads | `ChannelsRiding(route)` serves a session's road to the members of the channels riding it ([channels_riding.go](../server/internal/hub/channels_riding.go)). |
| XP | The voice bonus counts seconds in the session's own voice channel (`voiceMs`). |
| Client connection | `channelConnection` ([connection.svelte.ts](../web/src/lib/channel/connection.svelte.ts)) holds one place at a time: socket, call and the session's shared state together. Opening a session in another channel leaves your call. |
| Client ride | `holdChannelRide` ([channel-ride.svelte.ts](../web/src/lib/ride/channel-ride.svelte.ts)) ties the ride to the call. Leaving the call ends it. |
| Routes | `/crew/[id]/s/[session]` resolves the session's channel and mounts that channel's shell ([+layout.ts](../web/src/routes/(app)/crew/[id]/s/[session]/+layout.ts)). An ended session redirects to its channel. The free ride lives at `/crew/[id]/v/[channel]/training`. |
| Now bar | Ride ▾ "Start a session for everyone" opens the picker in the current channel ([NowBar.svelte](../web/src/lib/nav/NowBar.svelte)). |

Open rides already work the way this plan wants. Each one is a hub object of its own, keyed by ride id, beside the voice channels and never messaging them ([openride.go](../server/internal/hub/openride.go)). A crew session follows the same shape.

## The model

- **A session belongs to the crew.** Any member can start one. Its coach is whoever started it, until a hand-off. Any member can open it and watch; only those who joined are driven and counted (as today).
- **It has its own live room in the hub**, keyed by session id. Its own goroutine, its own 1 Hz tick (4 Hz in a sprint), its own socket `/ws/sessions/{id}`. The gate is crew membership, asked once at connect. A crew ban severs every session socket of that crew.
- **A voice channel is a call.** Its room holds the call, the jukebox, the lounge, cheers, the board and away. It carries no metrics. It knows which of its people ride, and on which session, and shows that.
- **A ride is the rider's** (as ADR-0093 decided). It joins at most one session at a time. Joining hands the trainer's targets to the session's timeline. Leaving the session, or its end, hands them back and the ride runs on as a free ride.
- **A free ride is private.** Nobody sees its numbers. The rider's call shows a badge: riding.
- **Ride together** is a session with no workout. Everyone rides their own free ride (watts, grade or a road) and sees each other's numbers. It has a coach, an End and a recap like any session.

## Presence in a voice channel

- The call's roster carries, per rider, `riding` (a free ride or a session) and the session's id when they are on one. The tick sends it; no numbers ride along.
- A tile and a lounge sprite get a bike badge. On a session, the badge names it ("Tempo · 3"). A tap on it opens Join.
- Starting a session while in a call posts one line to that call: "Ana started Tempo · Join". It stays until the session's count-in ends, then goes. It is a tick field, never persisted.
- The sidebar's voice rows show the same bike glyph beside a rider on a session.

## Voice and sessions side by side

- The client holds two live connections at most: the call (`channelConnection`) and the session (`sessionConnection`). Either can exist without the other.
- In a call and on a session: you hear the call, you ride the session. Leaving the call keeps the session; leaving the session keeps the call.
- On a session with no call: the session's screen and its sounds. Music is the call's, so a rider with no call hears no jukebox.
- One rider, one voice and one sensor, one screen stay true. What is the rider's and not a room's moves to the hub, keyed by rider and reached from any of their sockets: the sensor claims (#610), the phone remote's relays (#3217) and the voice seat.

## URLs and navigation

| Address | Becomes |
| --- | --- |
| `/crew/[id]/s/[session]` | Stays the session's address. It connects to the session's socket, not to a channel. |
| `/crew/[id]/s/[session]/watch` | Stays. |
| An ended session's address | The crew page, with the recap. No channel to fall back to. |
| `/crew/[id]/v/[channel]` | The call only: stage, lounge, music. |
| `/crew/[id]/v/[channel]/training` | Redirects to `/ride`, the device's one ride. |

Navigation never ends a session or a call. Opening another voice channel moves the call and leaves the session where it is.

## The now bar and the ride's controls

- The bar shows when there is a call, a session or a ride.
- Voice, Away and Leave are the call's. On a desk they sit under your name in the sidebar's foot. Riding or on a phone the sidebar is out of reach, so they sit in the bar.
- **Ride** opens the device's free ride. Its arrow lists, for the crew you are looking at: **Start a session**, **Ride together**, then one row per live session ("Join Tempo · 3 riding").
- On a session: the ride's controls from the ride HUD (#4386), plus **Leave session**. The coach also gets Pause and End.
- Off any crew page, Start a session uses the crew of your call, else the last crew you opened.

## Sidebar

- Live sessions sit at the top of the crew column, above the channels. One row each: name, coach, riders, clock. A neon edge marks the one you are on. A click opens it.
- Nothing shows when none runs. The next planned session stays on the crew page.

## Schedule and plans

- A plan names no channel. The plan form loses its channel picker.
- Starting a plan opens a crew session from it. The RSVP list becomes the start line's "awaited", read against the session rather than the channel.
- Plans already saved with a channel keep that channel's gate until they are past. The column is then dropped (see migrations).
- MCP's plan tool accepts a channel and ignores it for one release, then drops the argument. The calendar feed stops naming a channel.

## Server

- **Session rooms first reuse `channelState`.** A session room is a `channelState` keyed by session id, with a crew, and with its call parts never used: no voice, no jukebox, no lounge. Every session feature (timeline, coach, sprint, game, bunch, start line, record, recap, saver) works unchanged on day one. `ponytail:` until the contract PR splits the struct.
- The hub keeps `sessions map[string]*channelState` beside `states`, `openRides` beside both. A session room is made by `POST /api/crews/{id}/sessions` and forgotten by the existing sweep once it is closed and empty.
- `GET /api/crews/{id}/live` lists the crew's session rooms. `LiveSession.Channel` is empty for them, and goes in the contract PR.
- The saver gets an empty channel: the ride's `channel_id` is null and the recap is crew-wide.
- `SessionsRiding(route)` returns crews, and the road endpoint serves the road to members of those crews while the session rides it.
- The voice bonus counts a rider's seconds in any call while the timeline runs.
- The contract PR splits `channelState` into `callState` and `sessionState`, each with its own tick, and removes session controls from the channel socket.

## Privacy

- Live metrics exist only inside a session, as WATTROOM.md says. After this plan that is literal: channels carry none.
- A session's numbers reach whoever has it open: its riders and crew members watching. Nobody outside the crew.
- Heart rate follows the sharing control inside the session, as today.
- A free ride's numbers reach nobody. The privacy copy ("whoever has it open sees your live watts") is rewritten in the PR that ships Ride together.

## Migrations

Expand and contract only.

| PR | Change |
| --- | --- |
| Session rooms | Add `session_recaps.crew_wide boolean`, nullable. True means every crew member sees it. Null keeps today's channel gate, so old recaps of a private channel stay narrow forever. |
| Schedule | None. `scheduled_sessions.channel_id` is nullable already; the code stops writing it. |
| Contract, one release after Schedule and after the last channel-pinned plan is past | Drop `scheduled_sessions.channel_id`. |

`rides.channel_id` and `session_recaps.channel_id` stay. They are history, and they keep old rows gated as they were.

## PRs, in order

Each one ships on its own and leaves the app working.

1. **This plan.**
2. **Session rooms.** Hub session rooms, `POST /api/crews/{id}/sessions`, `/ws/sessions/{id}`, the crew gate and the ban, the live list, the crew-wide recap. On the client, the crew page gets Start a session for a crew session and the session page connects to its socket. Old sessions inside channels keep working. Until PR 3 a crew session takes the one live connection, so opening one leaves your call.
3. **Call and session side by side.** `sessionConnection` beside `channelConnection`. Rider-scoped state (sensor claims, remote relays) moves to the hub. The ride joins the session's socket. The now bar's Start a session and Join rows open crew sessions. Channel sessions can no longer be started.
4. **Channels show riding.** Roster `riding` and session id, badges on tiles, lounge and sidebar voice rows, the "started Tempo · Join" line, the sidebar's session rows.
5. **Ride together.** A session with no workout. The call stops carrying metrics. `/v/[channel]/training` redirects to `/ride`. The privacy copy changes.
6. **Schedule.** Plans name no channel; starting one opens a crew session; MCP and the calendar follow.
7. **Contract.** Split `channelState`; the channel socket refuses session controls; `LiveSession.Channel` goes. One release later, drop `scheduled_sessions.channel_id`.

## What WATTROOM.md says when this lands

- What WattRoom is: "Crews with chat channels, voice channels, and sessions that any member starts."
- Stack: "Live state lives in memory, one goroutine per voice channel and one per session, one coalesced message per room per second."
- Crews and people: "A session belongs to the crew. Several can run at once. A voice channel is a call and carries no ride." replaces "A voice channel rides without a session (a free ride)."
- Riding: "A ride joins at most one session. Joining never touches the rider's call. A call shows who rides, and on which session, never their numbers."
- Data and privacy: "Live metrics exist only inside a session while it runs" stays, and is now literal.

## Not in this plan

- Music in a session. The jukebox stays the call's.
- Sessions open to other crews. Open rides already cover strangers.
- Merging open rides and crew sessions into one room type. They share a shape; the merge waits until both are stable.
