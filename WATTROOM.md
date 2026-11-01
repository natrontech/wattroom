# WattRoom

> Train together, not alone. WattRoom is collaborative indoor cycling: structured workouts, smart trainer control (FTMS), and crews that ride together with live metrics, voice, camera and a synced jukebox.

This file holds the decisions that hold today. Change one by editing it in the same PR as the code. The history of how each was reached is in git (`docs/decisions/` until 2026-11).

## What WattRoom is

Indoor training is boring alone. Zwift answers with a game world; WattRoom answers with presence. Your crew rides in its voice channel, everyone sees everyone's live watts and heart rate, you talk, you see each other, and the music plays in sync. On ride night WattRoom replaces both the trainer app and the voice app.

- A structured workout player with precise trainer control (ERG and SIM).
- Crews with chat channels, voice channels, and sessions that run in a voice channel.
- Roads: a rider's own route or a library climb, ridden in a 3D world in any mode.
- A hosted service at **wattroom.ch**, open source under **AGPL-3.0**, funded by donations only.

It is not a training plan generator, not an open world, and not a content treadmill.

## Stack and operations

- Go server (API, WebSocket, embedded SPA) + SvelteKit SPA + PostgreSQL + LiveKit, self-hosted.
- One Go instance. Live state lives in memory, one goroutine per voice channel, one coalesced message per channel per second. Postgres holds durable data only. Redis or NATS only when one instance measurably can't cope.
- Go: stdlib `net/http`, sqlc + pgx, goose migrations, coder/websocket, `log/slog`. No framework, no ORM.
- The WS protocol is JSON; Go structs are the source of truth and tygo generates the TypeScript.
- One VM with docker compose (app, Postgres, LiveKit, Caddy). Releases are CalVer tags; the VM converges on the newest tag and rolls back by image tag, never by restoring a dump.
- Prometheus `/metrics` and structured logs. No error-tracking SaaS, no product analytics.
- Chrome and Edge on desktop and Android are the training product. iOS gets the crew's channels with trainer features gated off. WattRoom installs as a web app, with no service worker.
- A desktop shell (Electron) covers only what the browser can't reach. Its sign-in happens in the browser and the session is handed back. Its HUD mirrors the riding screen and floats only while WattRoom is behind.
- A gate that would need someone's hardware is met by published sources, a test and a simulation, and then it ships.

## Crews and people

- The crew is what persists: members, roles (owner, admin, member), one ban, the schedule, the streak, medals and history. Its invite is a link and a 6-character code.
- A voice channel rides without a session (a free ride). A session drives only the riders who joined it.
- Everything is behind sign-in except the public pages, which are prerendered.
- One account holds a set of credentials: Google, GitHub, Strava and passkeys. No passwords. A verified email is for recovery, and a mailed link is the way back in.
- Friends are mutual. Presence is a friend's to see.
- A status is a line the rider writes, shown wherever their name goes.
- A crew pins what it keeps needing. An announcement is a chat message a coach marked.
- The public crew directory shows a door, not a window.
- A session leaves one recap: who was there, and for how long.
- A crew shows sums and your own turnout. It has no default ladder.
- A rider's page shows what their crews already see.
- Notifications fire when nobody is looking, and answer back. WattRoom mails an unconditional alarm class and one opt-in ride switch.
- In-app feedback files a GitHub issue.

## Riding

- One riding surface: the crew ride, the solo ride and the ramp test are the same screen.
- A ride belongs to the rider: one per device, owned by the app shell, ended only by End ride. Navigation never ends it.
- One rider, one voice: the first screen to join voice carries voice and camera, every other screen is a controller.
- One sensor, one screen: the hub arbitrates which screen holds a trainer.
- The client owns the trainer and the workout. A network hiccup never drops a target. Trainer reconnect mid-interval is core, not polish.
- Trainers are FTMS behind the `Trainer` interface, with a simulator for development and CI. Control-point writes are serialized. ANT+ is out.
- FTP comes from manual entry, the ramp test (75 % of the best minute), or an auto-detect prompt that never changes it silently. FTP history is the ride-time record. A guessed number says it is a guess.
- Heart-rate zones anchor on LTHR. Training load uses Coggan math under trademark-safe names, and nudges, never gates.
- Virtual gears are a multiplier on the simulated road: no dip on a shift, no auto-shift, no Zwift protocol.
- A planned week comes from intervals.icu, pulled once; the token and the week are kept nowhere.
- Sprint moments flip the trainer from ERG to SIM for the window, then back.
- Game modes are rule modules over the workout engine, all targets relative to FTP.

## Roads and the world

- A ride may carry a road in any mode: free ride, workout, bunch ride, race or game. The road decides the grade or where a block ends.
- Riding a road together: one bunch position owned by the hub, paced by the plan, nobody removed, never ranked.
- The wind is shared: shelter computed by the hub, capped at 50 %, felt in SIM only.
- Races on a road are opt-in game modes on W/kg physics, with results per Category on the closing card only.
- Your own ghost: at most three recorded lines plus the pacer, only where your own watts move your dot.
- A time is yours when your own watts moved your dot. The road board is opt-in: unnamed times on library climbs, top 10 per Category over 90 days.
- Shared roads, not an open world. Live strangers appear only on open rides, which a crew hosts on library roads within a cap.
- A crew's season is a tour, never a league: stages, opt-in, no standings.
- The roadside paints, sounds and informs. It never touches a trainer, a position or a score.
- The world is keyed by place, never by the route file. A climb belongs to the map.
- Maps come from our own copy of OpenStreetMap, served from wattroom.ch.
- A route keeps its place with care: sealed or not stored, cut per audience by the server.
- The rider is a figure that is dressed, never measured: a chosen build, height and skin tone, no face.
- Cosmetics are earned, never bought, traded, random or expiring.

## Music, voice and media

- Voice goes out clean: no noise suppression, full-band Opus. Voice is processed, music never is.
- The jukebox is a synced YouTube queue. YouTube's terms bind the player: a tile of at least 200×200 px, always visible while it plays, nothing overlaid, no audio-only mode, no auto-advance while it is off screen.
- A YouTube playlist is one queue entry. A saved playlist is a saved queue. Uploaded MP3s join the crew's pool.
- Spotify is a link out, never an API integration.
- A soundboard clip is a file the channel fetches, not audio down the voice track.
- An idle voice channel is the lounge: a pixel room of who is in the call, playing house radio.
- The server unfurls pasted links through a pinned-address fetch. The GIF picker (GIPHY) is proxied and posts a plain chat message.

## Data, privacy and competition

- Live metrics exist only inside a session while it runs. AV is never recorded. Rides are private by default.
- Heart rate is live in the session, never in a shared artifact. A shared ride carries numbers, never the rider's note.
- Channel events ride the tick and are never persisted.
- Nobody loses a ride: samples stream to the server and buffer in IndexedDB, and a ride the server loses comes back from the browser as a file.
- Rides export as .fit, upload to Strava, and reach Garmin by manual FIT import. Strava data never enters an LLM context.
- A rider's own uploads travel with their export. The calendar feed is addressed to the rider.
- Coaches read through personal tokens and a hand-rolled MCP endpoint.
- Stored credentials are sealed with a key from the environment.
- Competition is crew-scoped. Ranks use W/kg power PRs, execution score, consistency and climb times per Category, never raw watts.
- Level is XP from work done and climbs forever. Category is a fitness tier from the W/kg curve and moves both ways.
- Deleting a ride keeps its XP. An earned badge travels with the rider; progress stays home.
- Rides store summary columns plus 1 Hz samples as one compressed bytea in plain Postgres. Stats compute in-process when a ride completes.

## Open for the redesign

These were locked and are open again. A redesign may replace them; the rules above still bind it.

- The app frame: one left sidebar beside the content, with the people column on the right.
- The riding screen's layout: the slots, how they dock around the world, the bike computer paging slot 3, the desk sizes, the 3D/Flat/Map switch row.
- The look: the synthwave identity and palette, how a theme is built, the world's light, ground and flat-colour style.
- Motion, except flash safety: at most one luminance flash per 10 s over 25 % of a 10° field (WCAG 2.3.1).

## Naming

- Name: WattRoom, at wattroom.ch. The vocabulary is crew, chat channel, voice channel, session and coach. Never "room".
- Type: Chakra Petch for display and every numeral, Barlow for running text.
