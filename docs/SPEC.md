# Product Spec — the numbers and flows behind WATTROOM.md

[WATTROOM.md](../WATTROOM.md) says _what_ and _why_; this file pins the concrete values and flows so implementations match intent. Values marked **(default — tune in alpha)** are starting points, changeable without an ADR; everything else changes only via ADR.

## Glossary

| Term                  | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Room**              | Persistent named space with members and roles. Sessions happen _in_ rooms. Every room belongs to exactly one **crew**, permanently.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Crew**              | The layer above rooms ([ADR-0038](decisions/0038-the-crew-is-the-layer-above-rooms.md)): a name, an icon, its rooms and the people in them. You join a crew with its code or share link (`/c/{code}`), and that is the only invite there is ([ADR-0038](decisions/0038-the-crew-is-the-layer-above-rooms.md) amended, #1236): its open rooms you walk into, its private ones admit their members and whoever was let in. Rooms are channels and have no codes of their own. A crew carries no voice, deck, session, game or metrics; everything live stays the room's. Every rider gets one crew, named after them, made with their first room; the sidebar shows one crew at a time ([ADR-0020](decisions/0020-the-app-takes-discords-shape.md), amended). |
| **Crew code**         | The crew's invite (ADR-0038 amended, #1236): **six** characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no 0/O/1/I/L — read out loud over trainer noise), minted with the crew, shared as the code or as `/c/{code}`. Every member may share it; it is the one way into a crew, and rooms have no codes of their own.                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Friend code**       | A rider's own handle on the Friends page: **eight** letters from `ABCDEFGHJKMNPQRS`, minted with the account. Knowing it is the permission to ask them (ADR-0012 amended). Six characters in the friend box, or eight in the crew box, is the other code in the wrong place — both boxes say so.                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Session**           | One group ride in a room: a workout (or game mode) + a shared timeline.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Coach**             | The role driving the shared timeline of a session (pick workout, start countdown, arm sprints). The owner is coach by default and can hand it off.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Tick**              | The 1 Hz server broadcast coalescing every rider's latest sample. 4 Hz during sprint windows.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Sample**            | One rider datapoint: watts, HR, cadence, seq. Client → server at ~1 Hz.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Execution score**   | How precisely you rode your prescribed targets (see formula below).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Level**             | XP-based, only goes up, earned by work done.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Category**          | Fitness tier D–A from your 90-day w/kg power curve. Moves both directions.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Sprint moment**     | Coach- or workout-armed 15 s all-out window; trainer flips ERG→slope.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Jukebox**           | The room's one music surface (ADR-0018): a shared YouTube queue on a server-owned playhead. **Deck** = what is playing, **up next** = the queue, **just played** = the last 5, kept in the tick.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Library**           | A rider's own uploaded music ([ADR-0015](decisions/0015-self-hosted-music-pool.md) as amended by #1095/#1103): MP3s on the Music page, browsed and edited only by their uploader, heard in any room the uploader may enter. A library track is a jukebox entry like any video — queued, voted, skipped, ducked — with no video tile to show. **Library** is the word on every rider-facing surface (#1420); _pool_ and _shelf_ are names the code uses and riders never read. |
| **Playlist**          | A YouTube playlist queued whole ([ADR-0026](decisions/0026-a-playlist-is-one-queue-entry.md), #615) — **one** queue entry holding up to 50 tracks, not 50 entries, so a paste cannot own the room's queue or its vote order. It plays once through and never restarts; skip and back move _inside_ it, and a separate control drops the rest of it. The word means this and only this: the queue is the queue. The **saved** kind is a _room playlist_ or _personal playlist_ (below, #627) — a saved queue whose entries are what the live queue holds ([ADR-0045](decisions/0045-a-saved-playlist-is-a-saved-queue.md)): a video, a pasted playlist, or a **library** track. There is no third kind.                                                                                                                                                                                 |
| **Room playlist**     | A saved, named, ordered list of jukebox entries — videos, pasted playlists, library tracks ([ADR-0045](decisions/0045-a-saved-playlist-is-a-saved-queue.md)) — that belongs to a room (#627) — survives past any one queue, editable by any member. A room can save several; one is marked **active**, which is what **autoplay** and the panel's default "queue" button use. Queueing a room playlist into the live queue is a straight append of its entries, subject to the same caps the queue always had (`maxQueue`, `maxQueuedTracks`).                                                                                                                                                                                                                                                                                                                             |
| **Personal playlist** | A saved, named, ordered list of jukebox entries — the same three kinds — that belongs to a rider, not a room (#627) — self-managed, and queueable into whichever room they're currently in.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Autoplay**          | A per-room setting (#627) that starts the room's **active** room playlist when a rider joins a room whose deck is idle (nothing current, empty queue) — never interrupts a deck already playing. **Order** is `ordered` (loops the active playlist in list order), `shuffled` (randomized), or `smart` (#269, #1429 — the active playlist's **library** tracks drawn by this room's play/skip history, cadence and taste; its videos are left to the other two orders, and with no active playlist, or one holding no library track, the draw is the members' whole libraries), sticky across runs until changed. One source, three orders. Set on the room's **Settings** page by the coach or the owner (#1422); the jukebox panel says what it is set to, and a room playlist's menu can still make it the active one. There is no pinned first track — the active playlist's first entry is the start. (The _fixed start_ of #627 was dropped by #1422 under the 95 % rule; its columns leave one release later, #1430.)                                                                                                                              |
| **Vote**              | One rider's upvote on a queued track, toggled. A vote floats its track above every lower-voted track ahead of it; hand-reordering sets the order among equals.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Room event**        | A line in the chat timeline for something the _room_ did rather than something a rider said (#321) — `Kim queued Midnight City`, `Kim skipped Midnight City`, `now playing: Midnight City — queued by Kim`. Ephemeral ([ADR-0022](decisions/0022-room-events-are-ephemeral.md)): it rides the tick and is never persisted. A burst of adds is one line ("Kim queued 8 tracks").                                                                                                                                                                                                                                                                                                                                                                             |
| **Planned session**   | A session put on a room's calendar for a time (#116). Members **RSVP**: in, or not in — there is no maybe. It is not a second kind of object, and it is not a _room event_, which is the chat line above.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Streak**            | Consecutive **weeks** in which a room held at least one session, counted from Monday-start weeks. The current week is forgiving: a streak survives until that week ends without a session, so a crew that always rides on Saturday does not read as broken on Tuesday. Feeds the XP bonus (`25 × current-week-streak`).                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Consistency**       | Showing up, as opposed to how hard you rode — the thing a room's own numbers are about ([RESEARCH.md §14.7](RESEARCH.md)). A room expresses it two ways: its **streak**, and its **sessions this month** against its own last month. It is never a per-rider score and never a ranking; a rider sees only their own turnout ([ADR-0036](decisions/0036-what-a-room-shows-about-its-members.md)).                                                                                                                                                                                                                                                                                                                                                            |
| **Spiral guard**      | ERG low-cadence protection: detect collapse, temporarily release target.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **WCPS**              | Wahoo's proprietary BLE control protocol (Kickr v2 path).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

## Roles & permissions

| Capability                                                                            | Owner | Coach | Member                      | Spectator (phone) |
| ------------------------------------------------------------------------------------- | ----- | ----- | --------------------------- | ----------------- |
| Edit room (name, icon, listing, sound pack, reaction set, weekly board)               | ✓     | –     | –                           | –                 |
| Assign/remove coach role                                                              | ✓     | –     | –                           | –                 |
| Hand the room to a member — you stay on as a coach (#1227)                            | ✓     | –     | –                           | –                 |
| Remove / ban / unban member (#223)                                                    | ✓     | –     | –                           | –                 |
| Pick workout / mode, start countdown, pause/end session                               | ✓     | ✓     | –                           | –                 |
| Arm sprint moments                                                                    | ✓     | ✓     | –                           | –                 |
| Plan / move / cancel a session (#116)                                                 | ✓     | ✓     | –                           | –                 |
| Say you are in for a planned session (#450)                                           | ✓     | ✓     | ✓                           | –                 |
| Add to jukebox queue                                                                  | ✓     | ✓     | ✓                           | –                 |
| Jukebox play/pause/skip/back/seek                                                     | ✓     | ✓     | ✓ (default — tune in alpha) | –                 |
| Skip the rest of a queued playlist (#615)                                             | ✓     | ✓     | ✓                           | –                 |
| Jukebox upvote / reorder / remove a queued track (#286)                               | ✓     | ✓     | ✓                           | –                 |
| Create a room playlist, add a track to one (#627)                                     | ✓     | ✓     | ✓                           | –                 |
| Rename / delete a room playlist, remove one of its tracks, set it active (#627, #695) | ✓     | ✓     | –                           | –                 |
| Change room autoplay settings (#627, #695)                                            | ✓     | ✓     | –                           | –                 |
| Manage own personal playlists (#627)                                                  | ✓     | ✓     | ✓                           | ✓                 |
| Ride (metrics on dashboard)                                                           | ✓     | ✓     | ✓                           | –                 |
| Voice/camera                                                                          | ✓     | ✓     | ✓                           | –                 |
| Cheers                                                                                | ✓     | ✓     | ✓                           | ✓                 |

Ownership cap: a user **owns at most 3 rooms** (default — tune in alpha).
Membership is uncapped; deleting a room frees a slot. A rider owns **one
crew**, made with their first room. Rooms-per-crew is not capped separately
(#1201): every room counts against its own owner's 3, and only the crew's
owner and admins open rooms in it, so a crew holds at most 3 × the people
running it — ADR-0038 asks for two caps and this is the pair.

### Crew roles ([ADR-0038](decisions/0038-the-crew-is-the-layer-above-rooms.md))

| Capability                                                                      | Crew owner                                            | Crew admin         | Crew member |
| ------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------ | ----------- |
| Rename the crew, set its icon and picture (#1237)                               | ✓                                                     | ✓                  | –           |
| Make / unmake a crew admin                                                      | ✓                                                     | ✓                  | –           |
| Ban / unban from the crew (#1150) — never someone who owns a room in it (#1212) | ✓                                                     | ✓                  | –           |
| Hand the crew to someone in it (#1208)                                          | ✓                                                     | –                  | –           |
| See the crew's ban list                                                         | ✓                                                     | ✓                  | –           |
| Open a room in the crew (#1201)                                                 | ✓                                                     | ✓                  | –           |
| Invite to the crew — share its code or link (#1236)                             | ✓                                                     | ✓                  | ✓           |
| Leave the crew (#1228) — the owner hands it on first                            | –                                                     | ✓                  | ✓           |
| See the crew's rooms listed, with their access state (#1149)                    | ✓                                                     | ✓                  | ✓           |
| Open a room to the crew or shut it, without entering it (#1226)                 | ✓                                                     | ✓                  | –           |
| Enter a room open to the crew                                                   | ✓ (if in the crew)                                    | ✓ (if in the crew) | ✓           |
| Read a room's contents, rename it, ban from it                                  | only as that room's member/owner — never by crew role |

- The **owner** is exactly one person and cannot be demoted, removed or
  banned; they gain no reading power over rooms they never joined. Handing
  the crew on leaves them an admin; the new owner's crew role is cleared,
  since owner beats it. A room owner cannot be crew-banned: a room never
  leaves its crew, so neither can the person who owns it.
- **Room roles are unchanged.** Coach, room ban and room unban stay the room
  owner's (matrix above). A crew ban implies exclusion from every room in the
  crew; a room ban implies nothing at the crew; **lifting one never lifts the
  other**.
- A new room is **open to its crew**; rooms that existed at the cutover stayed
  private with their members as the named exceptions. The owner moves a room
  either way in its settings, under _who can find this room_ (#1204) — the
  same ladder that lists it publicly, one step further.
- **Succession**: when the owner deletes their account, or no longer stands in
  any of the crew's rooms, the crew passes to its longest-standing admin, else
  its longest-standing member, else the owner of any room left in it. With no
  room left to own, the crew is deleted. Never the departing owner, never
  anyone the crew banned, never ownerless.

Room identity & vocabulary (#223, #447): the icon is **one drawn icon from a
curated set, or none**, stored as its lucide key; the reaction set is **up to
8 icons** from a second curated set (base set: flame, biceps-flexed,
party-popper, skull, rocket, snowflake) and is the palette for cheers and chat
reactions alike. The server checks a key's shape, not the vocabulary, and still
accepts one emoji so rooms and clients from before #447 keep working — the
client draws a known emoji as its icon. A **ban** is a membership state:
it survives rejoin via link or code, severs the live socket and voice on the
spot, and only the owner sees the ban list. Unban restores plain membership.

Session lifecycle: room idles (voice/jukebox lounge) → coach picks workout → 10 s countdown **(default)** → shared timeline runs → riders execute their own %FTP targets → session closes when the timeline ends (or coach ends it) → server computes stats + medals in one transaction. Late joiners sync to the current timeline position. A member stopping mid-session pauses _their own_ targets (auto-pause) — the shared timeline never waits.

## Workout JSON (draft — M1 finalizes)

**HR bands (#67 flavour 1, shipped)**: `steady` steps may carry `hrLow`/`hrHigh`
in raw bpm ("stay under 145" is `{ "hrHigh": 145 }`). Raw bpm on purpose —
these are personal workouts; %LTHR is the upgrade path if shared HR workouts
ever want it. Display-only and **never scored** (ADR-0008: no HR-derived
competition — no execution, no medals, no ranking). Bounds 60–220 bpm.
Closed-loop HR ERG (the trainer chasing a zone) is #67's remaining half and
its own project.

**Cadence bands (#66, shipped)**: `steady` steps may carry `cadenceLow` and/or
`cadenceHigh` (rpm) — "under 60" is `{ "cadenceHigh": 60 }`, "over 100" is
`{ "cadenceLow": 100 }`. Display-only: the player shows the band next to the
power target, coloured in/out of band; the execution score stays power-based.
Bounds 30–150 rpm; a `cadenceLow` at or under the spiral guard's 50 rpm trip
is refused at validation — a workout must not fight a safety feature.

```jsonc
{
  "name": "2x20 Sweet Spot",
  "author": "wattroom",
  "steps": [
    { "type": "warmup", "seconds": 600, "from": 0.4, "to": 0.7 }, // ramp, fractions of FTP
    { "type": "steady", "seconds": 1200, "target": 0.9 },
    {
      "type": "steady",
      "seconds": 360,
      "target": 0.85,
      "cadenceLow": 55,
      "cadenceHigh": 65,
    }, // torque block
    { "type": "steady", "seconds": 300, "target": 0.5 },
    {
      "type": "repeat",
      "times": 4,
      "steps": [
        { "type": "steady", "seconds": 30, "target": 1.2 },
        { "type": "steady", "seconds": 90, "target": 0.55 },
      ],
    },
    { "type": "cooldown", "seconds": 300, "from": 0.6, "to": 0.35 },
    { "type": "sprint", "seconds": 15 }, // armed sprint moment marker
  ],
}
```

Targets are fractions of FTP; absolute watts allowed via `"watts": 250` instead of `target`. `freeride` step type for slope-mode segments comes with game modes.

`repeat` steps nest: a set of sets expresses over-unders without writing every rep out. The engine has always flattened recursively; the type used to forbid it (#12).

## Power zones (Coggan 7-zone, % of FTP)

Used by Floor is Lava's called zones, time-in-zone scoring, and the interval-graph colour ramp.
Token names are the styleguide's (`--color-z1`…`z7`) — see `/dev/styleguide`.

| Zone | Name            | % FTP     |
| ---- | --------------- | --------- |
| Z1   | Active recovery | ≤ 55 %    |
| Z2   | Endurance       | 56–75 %   |
| Z3   | Tempo           | 76–90 %   |
| Z4   | Threshold       | 91–105 %  |
| Z5   | VO₂ max         | 106–120 % |
| Z6   | Anaerobic       | 121–150 % |
| Z7   | Neuromuscular   | > 150 %   |

## Heart-rate zones (Coggan 5-zone, % of LTHR — ADR-0014)

Anchored on the rider's **LTHR** (profile, bpm, bounds 100–210). Display-only:
colours the rider's **own** bpm readout, never anyone else's, never scored
(ADR-0008). Z6/Z7 have no HR analog — heart rate lags too hard for them.

| Zone | Name            | % LTHR   |
| ---- | --------------- | -------- |
| Z1   | Active recovery | ≤ 68 %   |
| Z2   | Endurance       | 69–83 %  |
| Z3   | Tempo           | 84–94 %  |
| Z4   | Threshold       | 95–105 % |
| Z5   | VO₂ max         | > 105 %  |

- **LTHR suggestion**: a scoreable ramp test with HR recorded suggests
  `0.90 × max test HR` **(default — tune in alpha)** — one tap to apply, never
  auto-applied (same posture as FTP suggestions).

## Stats formulas (defaults — tune in alpha)

- **Tolerance band**: within ±5 % of target power, floor ±10 W (beginners at 100 W targets need the floor).
- **Execution score** (per ride): `% of riding seconds inside the band`, weighted by step intensity (each second weighs `target/FTP`, so nailing VO2 intervals counts more than nailing recovery). Warmup/cooldown/freeride excluded. Auto-paused time excluded.
- **XP**: `1 kJ = 1 XP`, plus per-ride bonus `execution% × 50`, plus streak bonus `25 × current-week-streak` (capped at 250). Level thresholds: level n requires `500 × n^1.6` cumulative XP (a winter of 3 rides/week ≈ level 25–30).
- **Category** from best 20-min w/kg over rolling 90 days: **D < 2.5, C 2.5–3.2, B 3.2–4.0, A ≥ 4.0**. Recompute on ride completion; category changes announce in the room (up: fanfare; down: silently).
- **Power curve**: best-effort 5 s / 1 min / 5 min / 20 min per ride, merged into the 90-day rolling curve.
- **FTP suggestions**: when 90-day `0.95 × best-20-min` exceeds set FTP by >2 %, prompt (never auto-apply).
- **Ramp test**: 5-min warmup (35 → 50 % FTP), then target starts at 100 W **(default)**, +20 W/min for up to 25 steps; FTP = 75 % of **best rolling 60 s** (rolling, not per-step — riders fail mid-step and their best minute straddles the boundary).
  - **Blown** = power below 75 % of target for 5 consecutive seconds. The test ends itself; a rider at the end of a ramp will not press a button.
  - **Too short to score**: fewer than warmup + 2 completed steps produces no FTP at all. FTP scales every workout, so a number derived from a warmup is worse than no number.

## XP sources (defaults — tune in alpha)

Riding earns XP as above. Everything else a rider earns lives in the `xp_events`
ledger (#467), and `user_total_xp` = rides + ledger is the one lifetime number
every level derives from. **Fairness rule**: no non-riding source out-earns a
typical ride — 45 min ≈ 600 kJ ≈ 650 XP — so the lounge caps at 24 a day, a
session bonus is 5, and achievements pay once.

| Source                  | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Riding**              | `1 kJ = 1 XP` + execution bonus + streak bonus (Stats formulas above).                                                                                                                                                                                                                                                                                                                                                                        |
| **Lounge presence**     | **1 XP per 5 full minutes in voice**, capped at **24 XP per rider per UTC day**. Leaving resets the five-minute count. Presence is what LiveKit's join/leave webhooks say — the server cannot hear who talks (mute state is client-reported), so "talking" is measured as being on the call, and every surface says "in voice", never "talking". Blocks past the cap are recorded at 0 XP so lounge hours keep counting toward Lounge Lizard. |
| **Session voice bonus** | **5 XP per group session** the rider was in voice for **at least half of** the running timeline (pauses excluded). A group session has **≥ 2 saved rides** and **≥ 10 min** of timeline. Riders and listeners alike — a coach without a trainer on the call earns it.                                                                                                                                                                         |
| **Achievements**        | One-time **100 (easy) / 250 (medium) / 500 (hard)** XP, paid the day the shelf gets the trophy.                                                                                                                                                                                                                                                                                                                                               |

### Achievements

Only what the server can verify on its own is in the catalogue
(`server/internal/gamify/catalogue.go`; the client's copy is held to it by a
test). Clock times use the **server's local zone** (its `TZ`; UTC when unset)
and say so. Ride achievements are judged per ride at save time from the samples
in hand — rides store no zone seconds — so they show no partial progress.

| Key                   | Name                | Earned by                                                                                               | Tier   |
| --------------------- | ------------------- | ------------------------------------------------------------------------------------------------------- | ------ |
| `sunrise-club`        | Sunrise Club        | 5 rides started before 07:00                                                                            | easy   |
| `night-shift`         | Night Shift         | 5 rides ended after 23:00 (a ride that runs past midnight counts)                                       | easy   |
| `200-rides`           | 200 Rides           | 200 rides                                                                                               | hard   |
| `sufferfest-survivor` | Sufferfest Survivor | ≥ 45 min at or above FTP in one ride                                                                    | hard   |
| `hot-end`             | Hot End             | ≥ 3 min in Z6 or above (≥ 121 % FTP) in one ride                                                        | medium |
| `espresso-ride`       | Espresso Ride       | a ride under 25 min with ≥ 80 % of its seconds above sweet spot (> 94 % FTP; sweet spot is 88–94 %)     | medium |
| `lounge-lizard`       | Lounge Lizard       | 10 h of voice presence (120 five-minute blocks)                                                         | medium |
| `dj`                  | DJ                  | 50 queued tracks the room played to the end — a skip does not count, the "ended" report does            | medium |
| `crew-chief`          | Crew Chief          | pressed start on 20 sessions with ≥ 3 saved rides (the medal minimum)                                   | hard   |
| `sprint-snob`         | Sprint Snob         | first on the w/kg podium of 10 sprint moments with **≥ 2** riders scored — a podium of one is not a win | medium |

Not in the catalogue, because the server cannot verify them: **The Quiet
Type** (10 sessions in voice without unmuting — mute is client-reported) and
**Never Gonna Give You Up** (riding through a track queued "as a joke" — a joke
is not a fact the server holds). Client-reported claims never earn trophies.

Visibility: `/api/me/trophies` is yours; `/api/riders/{id}/trophies` shows a
rider's case to the people who could already watch them ride — room-mates and
friends — and is a 404 to everyone else.

## Training load (defaults — tune in alpha; model rationale ADR-0016, research RESEARCH.md §13)

Naming is deliberate: TSS/NP/IF/CTL/ATL/TSB are Peaksware trademarks — WattRoom ships the
published math under the names **Load, Intensity, Fitness, Fatigue, Form** (the
intervals.icu convention). Everything below is per-rider, computed from WattRoom rides
only, and every surface says so ("based on your WattRoom rides").

- **NormPower** (per ride): 30 s rolling average of 1 Hz power → each value to the 4th
  power → mean → 4th root. Rides shorter than 20 min use plain average power instead
  (the rolling-4th-power estimate is not meaningful below that; TrainingPeaks convention).
  Stored on the ride at save time; missing values are backfilled once from the sample blob.
- **Intensity** = `NormPower / FTP-at-ride-time`.
- **Load** = `Intensity² × hours × 100` — one hour exactly at FTP = 100 by construction.
  Derived from stored columns on read, never stored itself.
- **Daily Load** = sum of that UTC day's rides; a day without rides counts 0.
- **Fitness** = 42-day exponentially-weighted average of daily Load
  (`F_d = F_d−1 + (Load_d − F_d−1)/42`). **Fatigue** = the same with 7
  (`/7`). **Form** = yesterday's Fitness − yesterday's Fatigue, displayed as a
  **percentage of Fitness** (absolute bands assume a ~100 Load/day athlete; ours aren't).
- **Form zones** (Friel-derived, via intervals.icu's percentage form):
  **> +20 %** transition · **+5…+20 %** fresh · **−10…+5 %** grey ·
  **−30…−10 %** optimal (building) · **< −30 %** high risk.
- **Cold start**: form status and every load-derived nudge stay hidden until **28 days**
  after the rider's first saved ride — a 42-day average over a week of data reads as a
  dangerous ramp for every new rider. Charts may render sooner with a "building history"
  note.
- **Tone rule** (not a number, still binding): zone words describe the day, never grade
  the rider — no "unproductive", no "failed". Load-derived suggestions are hints with a
  one-clause why and never gate picking any workout.

**Suggested for today** (one suggestion, first matching rule wins; nothing before the
28-day cold start; thresholds from RESEARCH.md §13.3, worded per the tone rule):

| #   | Rule                                      | Suggests      | Why-clause                      |
| --- | ----------------------------------------- | ------------- | ------------------------------- |
| 1   | form < −30 %                              | recover       | "carrying serious load"         |
| 2   | no ride in ≥ 14 days                      | restart       | "first ride back after a break" |
| 3   | yesterday's Load > 1.5 × median ride Load | endurance     | "yesterday was big"             |
| 4   | Fitness rose > 8 in the last 7 days       | endurance     | "load is climbing fast"         |
| 5   | form ≥ +5 %                               | intensity     | "you're fresh"                  |
| —   | otherwise                                 | no suggestion |                                 |

Suggestion → workout focus: **recover** = Recovery · **restart** = Recovery, Endurance ·
**endurance** = Endurance · **intensity** = Sweet spot, Threshold, VO₂ max. The badge
marks matching workouts in the picker; every workout stays rideable.

## Ride guards

Numbers moved here from code after being ridden (#46). The cadence path was validated on a
Kickr Core on 2026-08-29: deliberate grind tripped the guard at 37 rpm under a held target,
the target released for 9.6 s (one tick under the 10 s window), and re-engaged at 158 W
once cadence recovered to 82 rpm. No false trips across any prior hardware session.

**Auto-pause** — the rider stopped, so their targets stop (clock does not rewind):

| Parameter               | Value                                                   |
| ----------------------- | ------------------------------------------------------- |
| Stopped = cadence below | 5 rpm                                                   |
| …AND power below        | 20 W (cadence alone unsafe — some trainers report none) |
| Pause after             | 3 s stopped                                             |
| Resume countdown        | 3 s (resuming must not be a jump-scare)                 |

**Spiral-of-death guard** — ERG piles on resistance as cadence dies; the guard breaks the loop:

| Parameter                    | Value                                           |
| ---------------------------- | ----------------------------------------------- |
| Trip: cadence below          | 50 rpm while an ERG target is held              |
| …for                         | 5 consecutive seconds                           |
| Fallback (no cadence source) | power below 50 % of target, same 5 s            |
| Release duration             | 10 s of no target, then re-engage automatically |

The power-collapse fallback is unit-tested but has never run on hardware: every trainer on
the team reports cadence (ADR-0007), so the cadence branch always wins. It stays for any
future trainer that reports none.

## Medals (per group session)

- **Diesel** — lowest power variability (coefficient of variation) across steady steps
- **Metronome** — best execution score
- **Hammer** — best 5 s w/kg
- **Lanterne Rouge** — last on the final sprint/podium metric but completed the session
- Ties: earlier joiner wins. Minimum 3 riders for medals (default — tune in alpha).

## Session recap retention (ADR-0034)

- A finished session leaves **one recap** per session: who was in the room, when they arrived, how long they stayed, and whether they rode. **Presence and time only** — never watts, kJ, execution, heart rate or a per-rider workout.
- **Kept 90 days**, then pruned. Long enough to answer "who rode with us last month"; short enough to stop answering "where was this person in March". A room is a group of people, not an attendance register.
- Readable by the room's **current members** only; leaving the room ends access. Deleting the room takes its recaps with it, and deleting an account removes that rider's interval from every recap that names them.
- A session that never started leaves nothing. Sitting in a room with no session leaves nothing.

## Game mode parameters (defaults — tune in alpha)

| Mode            | Parameters                                                                                                                                                       |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backyard Ramp   | 3-min rounds, start 80 % FTP, +5 % FTP/round; eliminated after 10 s continuously below band; eliminated riders get 50 % FTP ERG and stay in room                 |
| Floor is Lava   | Called zone (Coggan 7-zone); leaving the zone >5 s burns a life; 3 lives; zone changes every 2 min                                                               |
| Watt Golf       | 9 or 18 holes; "hit X W for 10 s, starting in 20 s"; meter hidden from 20 s before to hole end; strokes = mean absolute deviation in watts; targets 60–110 % FTP |
| Sprint Roulette | 10–15 s sprints, random gap 3–8 min, klaxon 3 s before; scored on best 5 s w/kg                                                                                  |
| Points Race     | Sprints 5 pts/3/2/1; best interval-execution 3 pts; time-in-zone streak 1 pt/interval                                                                            |
| Team Relay      | One rider "on front" at 110 % FTP (others 55 %); rotate on 60–90 s timer or call-out; room distance = Σ front-seconds × front-watts                              |
| Collective Ramp | Backyard rules on the **room-average** %FTP; line starts 75 %, +4 %/round; score = rounds survived                                                               |

Elimination modes: 30 s disconnect grace (IndexedDB buffer proves continued pedalling on reconnect).

## Sync tolerances

- Metrics latency budget: pedal → every screen **< 500 ms**.
- Jukebox drift (revised per RESEARCH.md §10, retuned #286): **tiered**. Hard `seekTo(t, allowSeekAhead=true)` above **1.5 s**, then **hold still for a 1.2 s settle window and re-measure** (unbuffered seeks land on an earlier keyframe and read back stale while buffering — measuring through it turns one correction into a storm). Between **0.25 s** and 1.5 s, close it on the playback **rate at ±5 %**, which nobody can hear; below 0.25 s, play straight. Settled by doing on a live embed (2026-08-31): a 1.05× request reads back as 1.05, a 1.02× request rounds to 1 — the "rounds unsupported rates toward 1" caveat is real, but its floor is far finer than `getAvailablePlaybackRates()` advertises. An embed that rounds the nudge away loses nothing: its drift grows into the seek tier. All **(defaults — tune in alpha)**. Between corrections, dead-reckon position locally every 250 ms (OpenTogetherTube's proven design).
- Jukebox playhead arithmetic is on **server time, never the rider's wall clock** (#286): a client's clock is routinely seconds off, and adding `Date.now()` to a server anchor put that skew straight into the playhead — each rider chased a different target. Clients estimate the offset from `ServerTick.At` (**max of the last 8 samples** — the least-delayed tick is the truest, no ping/pong needed) and reset the window on every socket open **and whenever the tab returns to the foreground**: a backgrounded tab has its delivery batched, so every sample it takes reads late and the max-filter has no prompt sample left to prefer. A hidden tab therefore stops feeding the ring and keeps what it learned on screen (measured drifting ~2 s otherwise). Verified with three clients on one room, wall clocks 6 s apart: **2 ms** of spread, against 6 s on the old arithmetic. Below **0.6 s** of measured drift the room reads as in sync, and the panel says so — the rate tier exists to keep it there, so the badge is a claim the system actively defends rather than a threshold it merely observes.
- The server holds an **anchor, not a timeline**: it has no duration and cannot know a track ended. Clients report `ended` — and a client that finds the shared playhead already **past the track's duration** reports it too. Without that, a deck left playing to an empty room runs its anchor off the end and the next rider inherits a position no player can reach (#286).
- Shared timeline: server-authoritative; clients render from tick timestamps, never local clocks.

## Room audio defaults (defaults — tune in alpha; rationale RESEARCH.md §12)

- Voice and camera are **one tap away, never on by default** (ADR-0010 amendment, #681): entering a room connects nothing; the rider presses **Join voice**. A tab that was in voice and reloads within **60 s** of its last heartbeat rejoins with the mic as it was (`REJOIN_WINDOW_MS` — a refresh, not a return from lunch; the tab restamps every **20 s**); hanging up cancels that, and a mic held by another tab on the same machine vetoes it. The **camera never auto-restores** — a shut capture device stays shut until the rider opens it.
- Mic default: **voice-activity gating** (browser echoCancellation + **autoGainControl on**, **noiseSuppression off**. AGC stays on: LiveKit decides who is speaking from the published track's level, the jukebox's ducking rides on that, and every rider's stored gate threshold was set against an AGC'd signal, so switching it off takes the room's loudness, its ducking and some riders' gates with it — #555. Noise suppression is off because the room is meant to hear a voice, not a call centre: Chrome's suppressor takes the fan and the voice's air together, and the gate below is what keeps the fan out between sentences — ADR-0043, #1340). The published voice is **Opus, mono, full-band, 96 kbps** (livekit-client's `musicHighQuality` preset), **DTX off** (the gate already sends digital silence; comfort noise over it reads as more suppression), **RED on**; the transmit graph runs at **48 kHz**, Opus's rate, not the speakers'. The level is a **continuous envelope taken on the audio thread** (5 ms attack, 150 ms release), never a window sampled by a timer. Gate numbers: open at level **≥ 0.02** (RMS, 0–1), hold open while it stays within **6 dB** under that, shut **1200 ms** after it falls below, ramps **5 ms up / 150 ms down**; while the jukebox plays the threshold **doubles** (defaults — tune in alpha). The asymmetry is the point: opening late clips a word, closing late costs a moment of fan and breathing, and on a bike the first is worse. The gate rides a local gain stage, never the track's mute — mute state shown to others is only ever the rider's own toggle. Push-to-talk is the alternative, not the default: it suits the desk spectator, and says so where offered.
- **Who came and went** appears on the room's timeline (ADR-0022's join/leave shape, #984): joined, left, went away, is back. A rider's last socket going quiet is announced after a **15 s grace window** — the client's reconnect backoff is `min(1000 × 2^attempts, 10 s)`, which spends 1+2+4+8 = 15 s trying before it settles, so a phone that is coming back is back inside it and the flap produces no line at all, in either direction. Arrivals inside the **10 s** event-burst window coalesce into one growing line ("Ana and 2 others joined"). Ephemeral like every other room event: nothing is written, and a reload shows none of it.
- **Who the room shows as speaking** is measured locally, not read from the SFU's active-speaker broadcast (#987): the level of each subscribed voice, taken by the same audio-thread envelope as the mic gate, is what lights a rider. Same threshold as the gate (RMS **≥ 0.02**, holding within **6 dB** under it), but the hang is **400 ms** rather than the gate's 1200 ms — the gate is deciding whether to keep transmitting, where cutting a word is the expensive mistake, while this is deciding whether to draw a ring, and a ring that trails the conversation by more than a second reads as broken. A reading also cannot go stale: the server's broadcast was a memory, so a rider who left or muted mid-sentence stayed lit for the rest of the room's life.
- Joining a room with music playing and mic open → one-line **headphone nudge** (dismissible, never blocking). Echo cancellation is treated as best-effort — the defaults must work without it.
- Smart autoplay's weighting (#269, ADR-0015 smart selection step 2) — a weighted random draw over the pool, `weight = recency × skip`, both penalties **room-scoped** so one room's taste never reaches another: **recency** is `0.05` the instant a track ends and rises linearly to `1` over **4 h** (the floor is what makes it a penalty rather than a ban — nothing becomes unplayable); **skip** divides by one more than the times this room skipped the track, so one skip halves its chances and three quarter them. One refill queues **10** tracks — the deck re-triggers autoplay every time it runs dry, so a short batch re-weights against a fresher history instead of committing the room to an hour chosen an hour ago. All **(defaults — tune in alpha)**.
- Smart autoplay's **BPM matching** (#270, ADR-0015 smart selection step 3) — while a session runs, a smart refill also weighs each track against the cadence the current block asks for. A track matches when its BPM is within **±5 %** of that cadence **or of double it** (the same beat, felt one pedal stroke at a time instead of two); a match multiplies its weight by **3**. It is a boost and never a penalty, so a pool with no BPM tagged, a track nobody has tagged, and a room with no session running all draw exactly as they did without it. The cadence rides the tick as `targetRpm` (#1431), and a queue row whose library track fits it says so beside its bpm — the same rule, shown rather than only weighed. The cadence comes from the block's own **cadence band** when it has one (#66 — that band _is_ the work, so it beats any guess), otherwise from effort: **≤ 55 % FTP → 80 rpm**, **≤ 75 % → 85**, **≤ 90 % → 90**, **above → 95 rpm**. An absolute-watts block or a sprint has no fraction that describes the room and so expresses no preference. All **(defaults — tune in alpha)**; the effort tiers in particular are a first guess at how self-selected cadence rises with intensity, not a measured curve.
- Smart autoplay's **affinity** (#271, ADR-0015 smart selection step 4 — auto-DJ) — a track that resembles what this room has lately played _through_ is boosted: **×3** for the same **artist**, **×1.5** for a **tag** in common, taken in that order so a track that is both earns only the stronger. Taste is the room's last **20 completions** — by count, not by clock, so a room that rode yesterday does not come back to a blank slate. A **skip builds no affinity** (it is the inverse of the signal), and a track the room just finished is excluded from its **own** affinity — that is "more like that one", never "that one again", which the recency penalty already answers. All **(defaults — tune in alpha)**.
- Smart autoplay's weight is the **product** of all four factors — recency × skip × BPM × affinity — evaluated in one SQL pass with no reranking step and no model (ADR-0015's ceiling). Each sits on a base of 1 and is switched off by its own inputs, so a room with no history, no session and an untagged pool draws uniformly at random.
- The jukebox is the room's **only** music surface (ADR-0018). Jukebox audio is always local per rider (own iframe, own volume) and never enters the voice path. Ducking (#24/#152): dip to **25 %** of the rider's own volume with a **150 ms** attack ramp; release after a **600 ms** hold with a **400 ms** ramp — never a snap in either direction (defaults — tune in alpha).
- **Soundboard** (#877, ADR-0033): a clip is at most **60 s** _of kept audio_ — the source may be longer and is trimmed in the editor, and an untrimmed upload past the ceiling arrives already cut to it — and a rider's clips at most **100 MB** in total. Gain is limited to **12 dB** either way. The board is its **own mixer channel**, never the cues fader — pulling cues down for a quiet ride does not silence it, and pulling the board down does not cost the countdown cue. A rider who leans on it is turned down by their **per-rider fader**, which covers their voice and their board together (#463): the board's own fader reaches zero, so the room's remedy is a person, not the feature. Fires are rate-limited on the server to **one per second per rider**, the same ceiling a cheer takes — a client asking nicely is not a limit. A rider's new fire **stops their previous one** on every listener's machine: one rider is at most one voice, so the cooldown bounds what is _sounding_ rather than only what is starting — which is what makes a 60 s clip safe to allow.
- Ride-critical timers (ERG targets, tick handling) run in a **Web Worker** with Wake Lock held — main-thread timers throttle in hidden tabs (an active call exempts the tab, solo rides are not exempt).
