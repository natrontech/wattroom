# Product Spec — the numbers and flows behind WATTROOM.md

[WATTROOM.md](../WATTROOM.md) says _what_ and _why_; this file pins the concrete values and flows so implementations match intent. Values marked **(default — tune in alpha)** are starting points, changeable without an ADR; everything else changes only via ADR.

## Glossary

| Term                  | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Crew** | The people who ride together, and the only object with an identity ([ADR-0038](decisions/0038-the-crew-is-the-layer-above-rooms.md), [ADR-0058](decisions/0058-the-room-dissolves-into-the-crew.md)): a name, an icon and picture, its members and their roles, the one ban, its **channels**, its schedule, the **crew streak**, medals, recaps, **pins** and the **weekly board**. A crew has **two doors**, and both admit to the crew: its code or share link (`/c/{code}`), the invite a member hands out (#1236), and — once its owner or an admin lists it — its entry in the public directory ([ADR-0039](decisions/0039-the-public-room-directory.md), amended). Once in, a rider walks into its open channels; its private ones admit the crew's owner, its admins and whoever is named into them. The owner or an admin can make a new code (#1930); the old one, and every link carrying it, stops working at once. The crew itself holds nothing live — the call, the deck and the session are a voice channel's. A rider founds at most 3 crews (Roles & permissions) and may come to own more when one is handed to them (#1208); the crews a rider founded are their own (#1928). The sidebar shows one crew at a time, with **You** — the rider's own pages — as the first entry of its switcher ([ADR-0020](decisions/0020-the-app-takes-discords-shape.md), amended), and opens in the **main crew** a rider in more than one has named (#2144) — the account's choice, on every device. `/crew/{id}`. |
| **Crew code**         | The crew's invite (ADR-0038 amended, #1236): **six** characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no 0/O/1/I/L — read out loud over trainer noise), minted with the crew, shared as the code or as `/c/{code}`. Every member may share it; it is the crew's invite, and channels have no codes of their own.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Channel** | A **text channel** or a **voice channel** — furniture under a crew, never an identity of its own ([ADR-0058](decisions/0058-the-room-dissolves-into-the-crew.md)). A channel belongs to one crew for good and has a name and a gate. It has no owner: the crew's owner and admins create, rename, order, gate and delete it. **Open** admits every member of the crew who is not banned; **private** admits the crew's owner, its admins and the members named into it. Every room became one text channel and one voice channel of its name, with its gate (#2428). |
| **Text channel** | A crew's place to talk in writing: a name, a gate and a scrollback — its messages, images, reactions and read marks, and at most one **announcement**. Read over HTTP; nothing in it rides a socket, and opening one joins nothing, so a rider hops between text channels freely. `/crew/{id}/c/{channel}`. |
| **Voice channel** | A crew's place to be together: a name, a gate, one **jukebox** deck and who is in it — the call, its **channel events**, and at most one **session** at a time. Opening its page connects nothing; voice is one tap away (Voice channel audio defaults). `/crew/{id}/v/{channel}`. |
| **Friend code**       | A rider's own handle on the Friends page: **eight** letters from `ABCDEFGHJKMNPQRS`, minted with the account. Knowing it is the permission to ask them (ADR-0012 amended). Six characters in the friend box, or eight in the crew box, is the other code in the wrong place — both boxes say so.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Session** | One group ride: a workout (or game mode) on a shared timeline, running **in a voice channel** — at most one per voice channel at a time ([ADR-0058](decisions/0058-the-room-dissolves-into-the-crew.md)). Any member who may enter the channel starts one and is its **coach** until they hand it off; the crew's owner or an admin may end it. It has an id while it runs and leaves a recap and the rides behind; it has no table of its own. `/crew/{id}/s/{session}`, and `/watch` below it to spectate. |
| **Workout**           | A named list of **steps** in the JSON below — curated in the library, or a rider's own on their shelf. What a session or a solo ride is ridden against.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Step**              | One entry of a workout as the editor edits it: steady, ramp, warmup, cooldown, sprint, or a repeat holding steps. A repeat is a step; what it expands to are blocks.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Block**             | One stretch of the flattened timeline the rider rides — "block 3 of 6" on the riding screen, the header's target, the strip's next-up. Repeats expand into blocks; a workout's expansion budget is counted in blocks (#1713).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Coach** | The rider driving a session's shared timeline (pick workout, start countdown, arm sprints): whoever started the session, until they hand it to someone in it. A property of the session, not a crew role — being the crew's owner or an admin does not make anyone coach. |
| **Tick**              | The 1 Hz server broadcast coalescing every rider's latest sample. 4 Hz during sprint windows.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Sample**            | One rider datapoint: watts, HR, cadence, seq. Client → server at ~1 Hz.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Execution score**   | How precisely you rode your prescribed targets (see formula below).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Level**             | XP-based, only goes up, earned by work done. Deleting a ride does not lower it ([ADR-0047](decisions/0047-deleting-a-ride-keeps-its-xp.md)): the record goes, the work done stays.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Category**          | Fitness tier D–A from your 90-day w/kg power curve. Moves both directions.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Sprint moment**     | Coach- or workout-armed 15 s all-out window; trainer flips ERG→slope.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Jukebox**           | A voice channel's one music surface (ADR-0018 — one deck per voice channel): a shared YouTube queue on a server-owned playhead. **Deck** = what is playing, **up next** = the queue, **just played** = the last 5, kept in the tick and, since #1432, in `track_plays` — a voice channel the server has just brought up shows what the log remembers, videos and library tracks alike, until it plays something of its own.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Library**           | A rider's own uploaded music ([ADR-0015](decisions/0015-self-hosted-music-pool.md) as amended by #1095/#1103): MP3s on the Music page, browsed and edited only by their uploader, heard in any voice channel the uploader may enter. A library track is a jukebox entry like any video — queued, voted, skipped, ducked — with no video tile to show. **Library** is the word on every rider-facing surface (#1420); _pool_ and _shelf_ are names the code uses and riders never read.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Playlist**          | A YouTube playlist queued whole ([ADR-0026](decisions/0026-a-playlist-is-one-queue-entry.md), #615) — **one** queue entry holding up to 50 tracks, not 50 entries, so a paste cannot own a voice channel's queue or its vote order. It plays once through and never restarts; skip and back move _inside_ it, and a separate control drops the rest of it. The word means this and only this: the queue is the queue. The **saved** kind is a _crew playlist_ or _personal playlist_ (below, #627) — a saved queue whose entries are what the live queue holds ([ADR-0045](decisions/0045-a-saved-playlist-is-a-saved-queue.md)): a video, a pasted playlist, or a **library** track. There is no third kind.                                                                                                                                                                                                                                                                                                                       |
| **Crew playlist** | A saved, named, ordered list of jukebox entries — videos, pasted playlists, library tracks ([ADR-0045](decisions/0045-a-saved-playlist-is-a-saved-queue.md)) — that belongs to a crew (#627, ADR-0058) — survives past any one queue. A crew can save several, and each voice channel's **autoplay** names one as that channel's **active** playlist, which is what its autoplay and its panel's default "queue" button use. A member creates one, adds to one and **reorders** one; renaming, deleting, removing a track and making one a channel's active playlist are the crew's owner's and admins' (#695). The split is that a member may put things on the crew's shelf and arrange them, and may not take anything off it — reordering is the queue's own move applied to the shelf (#1428), and it changes no more about what autoplay plays than a member's add already does. Queueing a crew playlist into a channel's live queue is a straight append of its entries, subject to the same caps the queue always had (`maxQueue`, `maxQueuedTracks`); one playlist queued into two channels plays in each independently. |
| **Personal playlist** | A saved, named, ordered list of jukebox entries — the same three kinds — that belongs to a rider, not a crew (#627) — self-managed, and queueable into whichever voice channel they're in.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Announcement** | One line the crew's owner or an admin marked in a **text channel** ([ADR-0057](decisions/0057-an-announcement-is-a-chat-message-marked.md), #2408, amended by ADR-0058): no session Thursday, the route changed. It **is a chat message**, marked from that message's own menu — there is no announcement composer, and the notice keeps the message's author and time. **One per text channel**: marking another there replaces it. The channel shows its own above its log; the crew's **Board** leads with the newest across its text channels, and a voice channel's page carries that one while no session runs there. The marked line is kept past the 500-message cap. |
| **Board** | The crew's page for what it wrote down ([#2413](https://github.com/natrontech/wattroom/issues/2413), ADR-0058), `/crew/{id}/board`: the newest **announcement** across its text channels at the top, then the crew's **pins**. The old per-room addresses redirect here (#2458). |
| **Pin**               | A title and a block of lines on a crew's board ([ADR-0056](decisions/0056-a-crew-pins-what-it-keeps-needing.md), #2405): the handful of facts a crew keeps needing and nothing else holds — a game server and its password, the Discord link, the door code. Owned by the **crew**, and read and written on its **Board**. The body is plain text with one rule: a line written `Label: value` draws as a row with its own copy button, everything else stays prose. **Everyone in the crew** pins, edits and unpins; nothing records who wrote one. Bounded at **20 pins** per crew, a **40-character** title and a **1000-character** body (`protocol`, generated both sides). A pin is not a secret: every member reads it, and the editor says so. |
| **Autoplay** | A per-**voice-channel** setting (#627, ADR-0058) that starts the channel's **active** crew playlist when a rider joins a channel whose deck is idle (nothing current, empty queue) — never interrupts a deck already playing. **Order** is `ordered` (loops the active playlist in list order), `shuffled` (randomized), or `smart` (#269, #1429 — the active playlist's **library** tracks drawn by this channel's play/skip history, cadence and taste; its videos are left to the other two orders, and with no active playlist, or one holding no library track, the draw is the whole libraries of the riders who may enter the channel), sticky across runs until changed. One source, three orders. Set on the crew's **Settings** page by its owner or an admin (#1422, #2454); the jukebox panel says what it is set to, and a crew playlist's menu can still make it the channel's active one. There is no pinned first track — the active playlist's first entry is the start. (The _fixed start_ of #627 was dropped by #1422 under the 95 % rule; its columns leave one release later, #1430.) |
| **Vote**              | One rider's upvote on a queued track, toggled. A vote floats its track above every lower-voted track ahead of it; hand-reordering sets the order among equals.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Channel event** | A line on a voice channel's page for something that happened there rather than something a rider said (#321) — `Kim queued Midnight City`, `Kim skipped Midnight City`, `now playing: Midnight City — queued by Kim`. Ephemeral ([ADR-0022](decisions/0022-room-events-are-ephemeral.md), amended by ADR-0058): it rides the voice channel's tick, is never persisted and never enters a text channel. A burst of adds is one line ("Kim queued 8 tracks"). |
| **Planned session** | A session put on a crew's calendar for a time (#116), naming the voice channel it will run in, or none yet (#2440). Members **RSVP**: in, or out — there is no maybe. Three states are _stored_ and only two are ever asked for: **in**, **out**, and the crew not having heard from you, which is the absence of an answer rather than a third thing a rider can say (#1011). It is not a second kind of object, and it is not a _channel event_, which is the line above. |
| **Streak**            | Consecutive **weeks**, counted from Monday-start weeks, in which something was ridden. The current week is forgiving: a streak survives until that week ends without a ride, so a crew that always rides on Saturday does not read as broken on Tuesday. There are **two** streaks and they are different numbers — a **crew streak** and a **rider streak**, below. Say which one you mean; unqualified "streak" is ambiguous.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Crew streak** | Consecutive weeks in which a **crew** held at least one session, in whichever of its voice channels, in **UTC** weeks — a crew's riders are in several zones and a crew has none of its own. Two sessions in two channels in one week are one week, not two. It is a consistency number and it is the one on screen: the crew's Home labels it **this crew's streak**. It pays **no** XP — a crew streak that paid would let a rider join a crew on a six-week run and be paid for other people's rides. |
| **Rider streak**      | Consecutive weeks in which a **rider** rode at least once — in any crew's session, or solo — in **their own** weeks (the day boundary under Stats formulas). This is the streak that **pays**: the XP streak bonus below is `25 ×` the rider's own current-week streak, capped at 250. It is read before the ride being saved lands, so the ride extends the streak from the next ride on. Never displayed as the crew's number.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Consistency** | Showing up, as opposed to how hard you rode — the thing a crew's own numbers are about ([RESEARCH.md §14.7](RESEARCH.md)). A crew expresses it two ways: its **crew streak**, and its **sessions this month** against its own last month, counted as distinct days, so an evening split across two voice channels counts once. It is never a per-rider score and never a ranking; a rider sees only their own turnout ([ADR-0036](decisions/0036-what-a-room-shows-about-its-members.md)). |
| **Weekly board** | The one ordered surface a crew may have ([ADR-0036](decisions/0036-what-a-room-shows-about-its-members.md), amended by ADR-0058): each member's **kJ** and time ridden in the crew's sessions **this week**, bracketed by **Category**, resetting Monday with the crew streak's week. **Off until the crew's owner or an admin turns it on**, and never the crew's front page. It is the only crew surface that publishes a number derived from one member's rides, so it is disclosed twice — the crew's **door** (`/c/{code}`) says the crew keeps one before anyone joins (#1651), and each member has their own **include me** switch (`on_board` on their crew membership, default on; riders carried over from rooms start on only if they were on a board before, ADR-0058). A rider is on it only while they are a member: leaving takes their row with them. |
| **Spiral guard**      | ERG low-cadence protection: detect collapse, temporarily release target.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **WCPS**              | Wahoo's proprietary BLE control protocol (Kickr v2 path).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

## Roles & permissions

One table, because there is one place roles live: the crew ([ADR-0058](decisions/0058-the-room-dissolves-into-the-crew.md)). A channel has no roles of its own, and **coach** is not a role — it is whoever is running a session (‡).

| Capability | Crew owner | Crew admin | Member | On a phone † |
| --- | --- | --- | --- | --- |
| Rename the crew, set its icon and picture (#1237) | ✓ | ✓ | – | ✓ |
| Edit the crew — reaction set, directory listing, weekly board (#2454) | ✓ | ✓ | – | ✓ |
| Make / unmake a crew admin | ✓ | ✓ | – | ✓ |
| Ban / unban from the crew (#1150) — never the owner | ✓ | ✓ | – | ✓ |
| See the crew's ban list | ✓ | ✓ | – | ✓ |
| Hand the crew to someone in it (#1208) | ✓ | – | – | ✓ |
| Make a new crew code (#1930) — the old one stops working at once | ✓ | ✓ | – | ✓ |
| Invite — share the crew's code or link (#1236) | ✓ | ✓ | ✓ | ✓ |
| Leave the crew (#1228) — the owner hands it on first | – | ✓ | ✓ | ✓ |
| Create, rename, reorder, open / make private, delete a channel; set a voice channel's sound pack (#2434) | ✓ | ✓ | – | ✓ |
| Name a member into a private channel, or take them out (#2434) | ✓ | ✓ | – | ✓ |
| Enter an open channel | ✓ | ✓ | ✓ | ✓ |
| Enter a private channel | ✓ | ✓ | if named | ✓ |
| Delete any message in a text channel ([#2417](https://github.com/natrontech/wattroom/issues/2417)) — anyone may delete **their own** | ✓ | ✓ | – | ✓ |
| Put up and take down a text channel's announcement ([ADR-0057](decisions/0057-an-announcement-is-a-chat-message-marked.md)) | ✓ | ✓ | – | ✓ |
| Pin, edit and unpin on the crew's board ([ADR-0056](decisions/0056-a-crew-pins-what-it-keeps-needing.md)) | ✓ | ✓ | ✓ | ✓ |
| Start a session — planned or not — in a voice channel you may enter (#2438, #2440) | ✓ | ✓ | ✓ | – |
| Pick the workout or mode, start the countdown, pause, resume and end, arm sprint moments, hand the session off ‡ | ✓ ‡ | ✓ ‡ | ✓ ‡ | – |
| End anyone's session (#2438) | ✓ | ✓ | – | ✓ |
| Plan a session, naming a voice channel or none yet (#116, #2440) | ✓ | ✓ | ✓ | ✓ |
| Move / cancel a planned session (#116) | ✓ | ✓ | their own | ✓ |
| Say you are in for a planned session (#450) | ✓ | ✓ | ✓ | ✓ |
| Add to a voice channel's jukebox queue | ✓ | ✓ | ✓ | ✓ |
| Jukebox play/pause/skip/back/seek | ✓ | ✓ | ✓ (default — tune in alpha) | ✓ |
| Skip the rest of a queued playlist (#615) | ✓ | ✓ | ✓ | ✓ |
| Jukebox upvote / reorder / remove a queued track (#286) | ✓ | ✓ | ✓ | ✓ |
| Create a crew playlist, add a track to one, reorder its tracks (#627, #1428) | ✓ | ✓ | ✓ | ✓ |
| Rename / delete a crew playlist, remove one of its tracks, make it a voice channel's active one (#627, #695) | ✓ | ✓ | – | ✓ |
| Change a voice channel's autoplay settings (#627, #695) | ✓ | ✓ | – | ✓ |
| Manage own personal playlists (#627) | ✓ | ✓ | ✓ | ✓ |
| Ride (metrics on dashboard) | ✓ | ✓ | ✓ | – |
| Voice/camera | ✓ | ✓ | ✓ | ✓ |
| Cheers | ✓ | ✓ | ✓ | ✓ |

‡ **Only while they are the session's coach** — whoever started it, until they hand it to someone in the session (#2438). Being the crew's owner or an admin does not make anyone coach. The one lever the owner and admins hold over a session somebody else is running is **ending** it, which is what a voice channel needs when a session is left running in it: there is one session per channel, so an abandoned one would hold the channel shut.

† **The last column is a device, not a fourth role** (#1767, headed "Spectator (phone)" until then; `device.spectator` in the code is this column). It is the same rider holding a phone, and it reads _and on a phone?_ — a ✓ says the capability the first three columns gave them still works there. A **–** marks the only thing that can take one away: needing something a phone has not got — a **paired trainer** (Web Bluetooth is not on iOS Safari, [ADR-0004](decisions/0004-chrome-first-with-native-escape-hatch.md)), or the **riding screen a session is run from**, since starting a session, picking its workout, counting it in and arming a sprint are the coach's cockpit and belong on the device they are pedalling at. Moderating and planning need neither, so an owner with nothing but a phone can ban a griefer, end a session left running and put next Tuesday on the calendar. The crew's **Settings** page is not offered in the narrow drawer (#2447) — a navigation choice under the 95 % rule, not a capability the phone lacks, so its rows keep their ✓. This column read "–" on every row above _Say you are in_ until #1767; the code had never gated moderation, so it was the matrix that was wrong ([ADR-0020](decisions/0020-the-app-takes-discords-shape.md)'s 2026-09-05 amendment gates "the affordances that need something a phone does not have", and WATTROOM.md's device row gates "the affordances that would fail on it rather than the page").

Caps (defaults — tune in alpha): a rider **founds at most 3 crews**, counted over the crews they founded and still own, so deleting one or handing it on frees the slot. A crew holds at most **20 text channels** and **10 voice channels**. A voice channel runs **one session** at a time — that one is not a default but the model (ADR-0058), and a second start is refused rather than counted. Membership is uncapped.

Names, counted in characters (not bytes, #1986): a crew or channel name is 1–60, a workout name (planned, ridden or saved) 1–80, a token name 1–60, a chat or direct message 1–500, a display name 1–60.

Shelf ceilings (#1414, defaults — tune in alpha). A crew holds at most **100
planned sessions** — counted the way the crew's own schedule counts them,
upcoming and not yet started, so a plan that ran, was cancelled or fell past its
grace gives its slot back. An account holds at most **200 saved workouts**.
**Rides are not capped**: a rider's history is the product, and nothing may
delete or refuse it. A ceiling — these two, the crew and channel caps above — is
refused with **429 `rate_limited`** (errors.md, the same shape as the ten-token
cap) and the message names the number and the remedy — never a wait, because a
ceiling does not clear on its own.

Ceilings are not what keeps a read small, and a read must never silently drop
what it cannot fit (#1908): the saved-workout shelf is **paged, 100 a page**,
by the `?before=` cursor the rides list uses. Calendar feeds carry **30 days of
history and one year ahead**, at most **1000 events** per render — the ICS body
is built in memory for a bearer-token URL, and planning is capped three months
out, so the horizon hides nothing anyone planned.

### The crew, its owner and its channels ([ADR-0038](decisions/0038-the-crew-is-the-layer-above-rooms.md), [ADR-0058](decisions/0058-the-room-dissolves-into-the-crew.md))

- The **owner** is exactly one person and cannot be demoted, removed or
  banned. Handing the crew on leaves them an admin; the new owner's crew role
  is cleared, since owner beats it.
- **There are no channel roles.** A channel has no owner, no coach and no ban
  of its own: the crew's owner and admins keep every channel, and a private
  channel admits them without naming them — ADR-0058 says what that costs. The
  **one ban** is the crew's. It keeps the seat, so it survives every way back
  in; it severs the rider's socket and voice in every channel at once; and
  lifting it restores plain membership. Room bans became crew bans in the move
  from rooms, the narrow side (ADR-0058).
- A new channel is **open to the crew**; one made private admits the crew's
  owner, its admins and the members named into it. Channels that came from
  rooms kept their room's gate — a private room's members and grants are its
  two channels' named members (#2428).
- **Listing** the crew in the public directory is its owner's or an admin's
  switch ([ADR-0039](decisions/0039-the-public-room-directory.md), amended):
  the entry is a name, a mark and a link, and joining from it joins the crew,
  so its open channels come with it — which is why it is a crew-level act.
- **Succession**: when the owner deletes their account, the crew passes to its
  longest-standing admin (by the day they joined the crew, not their last role
  change), else its longest-standing member. With nobody left, the crew is
  deleted. Never the departing owner, never anyone the crew banned, never
  ownerless.

Crew identity & vocabulary (#223, #447, #2643): the crew's icon is **one drawn
icon from a curated set, or none**, stored as its lucide key, beside an optional
picture (#1237). Its reaction set is **up to 8** — drawn icons from a second
curated set (base set: flame, biceps-flexed, party-popper, skull, rocket,
snowflake), any Unicode emoji, or the crew's own — the first four are the
mid-ride cheer buttons, and all of them lead the chat's emoji picker, which
offers every emoji besides ([ADR-0013](decisions/0013-room-identity-and-moderation.md),
2026-09-24 amendment). The server checks a reaction's shape, not the
vocabulary. Channels are named, not marked.

**Crew emoji** (#2643): any member adds one; the one who added it, the owner
and admins delete it. A crew holds at most **50**, a picture is at most
**256 KB** (a still is drawn at 128 px; a GIF keeps its animation), and a name
is **2–32 characters of `a–z 0–9 _`**, unique in the crew **(defaults — tune in
alpha)**. Used as a reaction and inline in a message as `:name:`; a name the
crew does not know is shown as the text it is. The 51st is refused the way the
other ceilings are (429, the number and the remedy).

Session lifecycle: a voice channel idles (voice and jukebox) → a member who may enter it starts a session and picks the workout, becoming its coach → 10 s countdown **(default)** → shared timeline runs → riders execute their own %FTP targets → session closes when the timeline ends (or the coach ends it, or the crew's owner or an admin does) → server computes stats + medals in one transaction. **One session per voice channel**: starting another while one runs there is refused with `conflict`, and the refusal names the coach (#2438). The coach hands the session to anyone riding in it — a light, live action, never a crew-role change. Late joiners sync to the current timeline position. A member stopping mid-session pauses _their own_ targets (auto-pause) — the shared timeline never waits. The picked workout is then ridden as planned: **nobody skips a block or adds a minute in a session** ([ADR-0046](decisions/0046-one-riding-surface.md) amended, #1635). Pause, resume and end are the coach's only holds on the shared timeline — the coach cannot add a minute, and ending the session is the only escape; changing the work itself is the workout editor's job. A rider **alone** owns their clock outright and keeps `+1 min` and `Skip block`.

A ride **alone** has the same lifecycle with the roster removed: rider picks workout → **3 s count-in** → their own timeline runs → closes when it ends (or they end it) → the ride is saved to their account. The count-in is a session's, shortened because nobody else is being waited for — same 3-2-1-go cues, same one-digit screen, and the same three seconds the resume countdown gets below. It is **not** an exception to ADR-0046's parity rule: the clock starts when the count-in ends, so the first block's target reaches the trainer then and not at the tap. A rider who changes their mind during it cancels back to the setup screen with the trainer still paired — nothing was ridden, so nothing is saved. The ramp test counts in the same way; it is a workout, not a third thing.

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

Targets are fractions of FTP; absolute watts allowed via `"watts": 250` instead of `target`. `freeride` step type for slope-mode segments comes with game modes. A `ramp` step (`from`/`to`, the editor's) is a mid-workout ramp between two fractions — the same shape as `warmup`/`cooldown`, interpolated per second and unscored like them (#1709). All three interpolate the same way: the block's first second is `from` and its last is one step short of `to`, because `to` is where the next block starts — a ramp is still ramping on its final second (#1394).

`repeat` steps nest: a set of sets expresses over-unders without writing every rep out. The engine has always flattened recursively; the type used to forbid it (#12).

A workout may also carry top-level `"unscored": true`, which says its execution score is meaningless and stores the ride with `execution_scored = false` — no percentage on the ride, no `execution% × 50` XP bonus. Absent is scored. The **ramp test is the only workout that sets it**, and the editor never offers it: it is a property of a workout that measures the rider, not a setting (#1400).

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

- **LTHR suggestion from a ramp test**: a scoreable ramp test with HR recorded suggests
  `0.90 × max test HR` **(default — tune in alpha)** — a rough estimate: LT2 sits at 85–92 % of
  HRmax and a ramp's peak need not be HRmax (RESEARCH §17.2; Friel's 30-min field test is the
  real measurement) — one tap to apply, never
  auto-applied (same posture as FTP suggestions). The result panel says it is rough.
- **LTHR suggestion from a hard ride** (#1620): a **solo** ride of **at least 30 minutes**
  carrying heart rate, whose **average HR over its last 20 minutes** exceeds the rider's set
  LTHR by **more than 2 %**, prompts with that average — one tap to apply, **never
  auto-applied**. Scoped to the same rolling **90 days** as the FTP rule below, and the largest
  such average in the window is the one offered. The measurement is Joe Friel's 30-minute time
  trial (RESEARCH §17.2): ride 30 minutes alone as hard as is sustainable, and the last 20
  minutes' average heart rate is LTHR.
  - **Solo** is a ride outside any session — the protocol wants nobody to pace off.
  - **There is no power gate.** The qualification is duration and the HR gap alone: a rider
    doing a genuine HR field test need not be near their best 20-minute power, so gating on
    power would silently skip the very protocol this implements. The cost is prompts after
    hard rides that were not tests — accepted, because a prompt is one tap to dismiss and
    never applies itself. **The prompt therefore says out loud that it assumes the ride was
    all-out**; that sentence is what a power gate would otherwise have done.
  - Seconds in the window with no reading are not averaged — a dropped strap second is
    absent, never a zero — but **at least half the window has to carry a reading**, or the
    ride has no number at all. Without that floor one second IS the average: a strap that
    re-acquires in the last minute with a single spurious beat would offer it as a threshold.
  - A rider with **no LTHR set** is not prompted: there is nothing for the average to exceed.
    The ramp test above is where a first LTHR comes from.

## The rider's two numbers (ADR-0048)

FTP and weight are what everything else here is relative to: every workout target is a
fraction of FTP, and so are the execution score, the XP bonus, the category, the training
load and every later FTP suggestion; weight is the denominator of every w/kg the app prints.
Bounds, enforced identically by the schema CHECKs, the profile PATCH and the web store
(`PROFILE_LIMITS`): **FTP 50–600 W**, **weight 30–200 kg**, **LTHR 100–210 bpm**.

- **Where they come from** is recorded per number as `default` (nobody chose it — the account
  was created with the app's opening 200 W / 75 kg), `manual` (the rider set it, by typing it
  or accepting a suggestion) or `ramp` (a ramp test measured it). Rejected, never coerced: a
  typed 900 is a refusal naming the field, not a silent 200.
- **A new account is asked, and never gated.** The first-run card's first step asks for both,
  prefilled with 200 W and 75 kg — keeping them is a valid answer and records `manual`. A
  rider who skips it rides anyway.
- **An unchosen number never reads as a measured one.** While the source is `default`, Home's
  FTP tile says it is a starting guess, and w/kg is withheld until at least one of the pair is
  the rider's own — two guesses divided by each other is a fiction with a decimal point.

## Stats formulas (defaults — tune in alpha)

- **The day boundary is the rider's own** (#2063). Every per-rider calendar
  bucket — the daily Load below, the **rider streak**'s week, the clock
  achievements, the rider page's month — starts the day where the rider is,
  from `users.timezone` as the browser reported it (#858). The column is
  nullable and a rider who has never told us buckets at **UTC**. This was
  written down because four of those surfaces once disagreed: a ride finished
  at 21:00 CET was on today in one place and tomorrow in three others, and a
  Monday-00:30 ride in Zurich was filed into the week before, halving a streak
  bonus the rider had earned. Neither answer was wrong; showing a rider both
  was. One helper decides it for the SQL and the Go alike
  (`server/internal/stats/zone.go`), because a query bucketing in one zone
  while Go re-buckets in another is the same bug one level down.
  - **Crew buckets are UTC**, and that is a different question, not an
    oversight: a crew's riders sit in several zones and a crew has no zone of
    its own. The **crew streak**, its month, its session days and its weekly
    board are all UTC, and the copy never calls them a rider's days.
  - **The lounge XP cap stays a UTC day** (below). It is applied inside the
    insert as blocks land, so it is a rate limit on a live meter rather than a
    number a rider reads back against their calendar.
- **Tolerance band**: within ±5 % of target power, floor ±10 W (beginners at 100 W targets need the floor). The target is the rider's **own**: the prescribed fraction × their bias (0.8–1.2, set during the ride, #795), so the band follows the plan they were actually on; the weight below stays the prescribed intensity.
- **Execution score** (per ride): `% of riding seconds inside the band`, weighted by step intensity (each second weighs `target/FTP`, so nailing VO2 intervals counts more than nailing recovery). Warmup/cooldown/freeride excluded. Auto-paused time excluded. Because the band is biased, execution is not like-for-like between riders — one at 0.8 rides 20 % easier and can still score 1.0; Metronome and the execution bonus reward riding the plan you set, not the hardest plan.
- **XP**: `1 kJ = 1 XP`, plus per-ride bonus `execution% × 50`, plus streak bonus `25 × current-week-streak` (capped at 250) — the **rider streak**, their own weeks wherever they rode, never the crew streak its Home displays (Glossary). Level thresholds: level n requires `500 × n^1.6` cumulative XP (a winter of 3 rides/week ≈ level 25–30).
- **Category** from best 20-min w/kg over rolling 90 days: **D < 2.5, C 2.5–3.2, B 3.2–4.0, A ≥ 4.0**. Recompute on ride completion; category changes announce in the session (up: fanfare; down: silently).
- **Power curve**: best-effort 5 s / 1 min / 5 min / 20 min per ride, merged into the 90-day rolling curve.
- **FTP suggestions**: when 90-day `0.95 × best-20-min` exceeds set FTP by >2 %, prompt (never auto-apply).
- **FTP history** (the trend chart, #222/#1572): the line is the FTP each ride was **scored against**, captured on the ride row — a record, never a reconstruction. A ramp test additionally records the FTP it **produced** on its own ride, set only once the rider accepts the number, and that is drawn as its own mark rather than bending the line; without it a test's result would not appear until the rider's next ride. Fewer than two rides is not a trend and draws the empty state instead.
- **Ramp test**: 5-min warmup (35 → 50 % FTP), then target starts at 100 W **(default)**, +20 W/min for up to 25 steps; FTP = 75 % of **best rolling 60 s** (rolling, not per-step — riders fail mid-step and their best minute straddles the boundary). The 75 % is Ric Stern's MAP→FTP midpoint of a 72–77 % band, ±5 % for most riders and worse at the extremes (RESEARCH §17.1).
  - **Blown** = power below 75 % of target for 5 consecutive seconds. The test ends itself; a rider at the end of a ramp will not press a button.
  - **Too short to score**: fewer than warmup + 2 completed steps produces no FTP at all. FTP scales every workout, so a number derived from a warmup is worse than no number.
  - **Saved as a ride, unscored** (#1400): a finished ramp lands on the history like any other ride — kJ, XP, power curve, FIT and Strava export — and carries `"unscored": true`, so no execution score is stored, shown or paid. The steps are ERG targets the trainer holds the rider on, so a score there measures the trainer; a ramp is still the hardest ride most riders do in a month and discarding it was read as data loss.

## XP sources (defaults — tune in alpha)

Riding earns XP as above. Everything else a rider earns lives in the `xp_events`
ledger (#467), and `user_total_xp` = rides + ledger is the one lifetime number
every level derives from. **Fairness rule**: no non-riding source out-earns a
typical ride — 45 min ≈ 600 kJ ≈ 650 XP — so the lounge caps at 24 a day, a
session bonus is 5, and achievements pay once.

| Source                  | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Riding**              | `1 kJ = 1 XP` + execution bonus + streak bonus (Stats formulas above).                                                                                                                                                                                                                                                                                                                                                                        |
| **Lounge presence**     | **1 XP per 5 full minutes in voice** — in any voice channel's call — capped at **24 XP per rider per UTC day**. Leaving resets the five-minute count. Presence is what LiveKit's join/leave webhooks say — the server cannot hear who talks (mute state is client-reported), so "talking" is measured as being on the call, and every surface says "in voice", never "talking". Blocks past the cap are recorded at 0 XP so lounge hours keep counting toward Lounge Lizard. |
| **Session voice bonus** | **5 XP per group session** the rider was in voice for **at least half of** the running timeline (pauses excluded). A group session has **≥ 2 saved rides** and **≥ 10 min** of timeline. Riders and listeners alike — a coach without a trainer on the call earns it.                                                                                                                                                                         |
| **Achievements**        | One-time **100 (easy) / 250 (medium) / 500 (hard)** XP, paid the day the shelf gets the trophy.                                                                                                                                                                                                                                                                                                                                               |
| **Deleted rides**       | An offsetting row when a rider deletes a ride: **amount = that ride's XP**, `ref` = the ride's id. The delete is hard, so the ride leaves `sum(rides.xp)` and this puts the same number back — `user_total_xp` does not move. Never new XP and never a measure a badge is judged from: deleting a ride is privacy, not work ([ADR-0047](decisions/0047-deleting-a-ride-keeps-its-xp.md)).                                                     |

### Achievements

Only what the server can verify on its own is in the catalogue
(`server/internal/gamify/catalogue.go`; the client's copy is held to it by a
test). Clock times use the **rider's own zone** — the day boundary above,
falling back to UTC for a rider who has never reported one — and say so:
getting up at 07:30 is not an early ride wherever the rider lives, and the
server's zone made Sunrise Club a fact about the server (#2063). Ride achievements are judged per ride at save time from the samples
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
| `dj`                  | DJ                  | 50 queued tracks a voice channel played to the end — a skip does not count, the "ended" report does            | medium |
| `crew-chief`          | Crew Chief          | pressed start on 20 sessions with ≥ 3 saved rides (the medal minimum)                                   | hard   |
| `sprint-snob`         | Sprint Snob         | first on the w/kg podium of 10 sprint moments with **≥ 2** riders scored — a podium of one is not a win | medium |

Not in the catalogue, because the server cannot verify them: **The Quiet
Type** (10 sessions in voice without unmuting — mute is client-reported) and
**Never Gonna Give You Up** (riding through a track queued "as a joke" — a joke
is not a fact the server holds). Client-reported claims never earn trophies.

Visibility: `/api/me/trophies` is yours; `/api/riders/{id}/trophies` shows a
rider's case to the people who could already watch them ride — riders who share
a channel with them, and friends — and is a 404 to everyone else.

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

## How a ride felt (#2328)

Two rides with identical average watts can feel nothing alike, and the trainer
records neither difference. A finished ride may therefore carry two optional
things the rider says about it: one number and one sentence. Both are entered
after the ride, never during it — this is the one moment `.claude/rules/ux.md`'s
no-typing rule does not apply, because the rider is off the bike.

- **RPE is the Borg CR10 session scale, integers 1–10**, one number for the
  whole ride — the category-ratio scale published by Borg, in the session-RPE
  form Foster (2001) put it to. Published anchors, used verbatim: **1** very easy · **2** easy · **3** moderate · **4** somewhat hard ·
  **5** hard · **7** very hard · **10** maximal. **6, 8 and 9 carry no word** —
  that is the scale's own design, steps between the anchors either side of them,
  and inventing labels for them would not be the CR10 any more.
- **0 is not offered.** CR10's zero is "rest"; a saved ride is at least a minute
  of pedalling, so the lowest a ride can be is 1.
- **The note is free text, 1–500 characters** — the same bound a chat message
  has, and for the same reason: it is a sentence, not a journal entry. An empty
  note is no note, and clearing it removes it.
- **Both are optional, both are erasable, and neither is ever asked for twice.**
  Nothing in the app is gated on them, no streak counts them, and a ride without
  them is not incomplete.
- **Neither feeds the load model.** Load is computed from power
  ([ADR-0016](decisions/0016-training-load-model.md)) and RPE does not move it.
  Letting it would be its own decision, with its own ADR.
- **Where they travel: nowhere the rider did not put them**
  ([ADR-0055](decisions/0055-a-shared-ride-carries-numbers-not-words.md)).
  Sharing a ride with friends shares the numbers the trainer recorded; the note
  and the RPE stay on the rider's own account. They are in the account export,
  because they are the rider's own words about their own ride.

There is no separate "feeling" control. The number says how hard and the
sentence says why — a third picker between them would be a setting that most
riders would leave alone, which the 95 % rule makes a default instead.

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
- **Metronome** — best execution score (each against their own biased targets — see Stats formulas)
- **Hammer** — best 5 s w/kg
- **Lanterne Rouge** — last on the final sprint/podium metric but completed the session (their ride reaches the workout's final segment)
- Ties: earlier joiner wins. Minimum 3 riders for medals (default — tune in alpha).

## Planned sessions (#116)

- **A crew may plan two sessions that overlap, and nothing refuses one** (#1767). Planning is bounded three months out and by the crew's 100-plan shelf, and that is the whole of it: two members taking the same evening, or a short spin offered against a long one, is a thing a crew does, and a crew that argued with its own calendar over it would be worse than one that shows both. There is no 409 at planning time — two plans may even name the same voice channel. The channel's one-session rule is met at **start**: a plan started while another session runs in its channel is refused with `conflict` naming that session's coach, and a plan that names no channel asks for one (#2440).
- **Which of two overlapping plans leads is settled by which was planned first**, not by which read asked. The crew's schedule, the sidebar's next-session line, Home's _What's next_ and both calendar feeds order by start time, then creation time, then id — a total order, so the plan labelled _next session in this crew_ is the same plan on every read. Ordering by start time alone left that label on whichever row Postgres returned first, which could differ between two reads of an unchanged crew.
- **Who is in is named; who is out is a number** (#1011). A plan reads **`4 in · 2 out · 9 unanswered`**, with the parts that are nobody left out, and the names of the riders who are in beside it. The count is what changes a planner's decision — hold the session, or move it — and the list of who declined would only add pressure to a decision a rider has already made. Crews are small, so naming is close to automatic once it is shown at all; this is the one place the crew deliberately says less than it knows.
- **A decline is cleared when the session moves to a new time**, on exactly the condition that re-arms the hour-before reminder: the time really changed. The session that was turned down is not the session now planned, so the people who turned it down are asked again. An "in" survives a move — dropping it would empty a line the crew reads, while a decline that outlived a move would silence a reminder for a session the rider never turned down.
- **A rider who said they are out is not reminded about it.** The hour-before reminder ([ADR-0030](decisions/0030-what-wattroom-emails.md)) is the only session mail whose audience depends on the answers: a plan has no answers yet, a move clears the declines, and a cancellation is news whatever anyone said. Changing your mind is one tap and asks nothing — there is nothing to undo that a second tap does not.

## Text channel chat

- **The last 500 messages per text channel persist** ([ADR-0010](decisions/0010-room-first-positioning.md)'s 2026-08-31 amendment, #201, re-keyed by ADR-0058) **(default — tune in alpha)**, pruned on every write — except the channel's marked announcement, which the prune keeps; an image outlives neither its message nor a 15-minute grace for an upload still awaiting its send.
- **An author may edit their own line for as long as that line exists — there is no time window, by design** (#1767). The 500-message bound above _is_ the bound: a line lives until the channel talks past it, and nothing else expires it. Deleting is a separate act ([#2417](https://github.com/natrontech/wattroom/issues/2417)): an author deletes their own line, the crew's owner and admins any line, and a deleted line vanishes from the channel. A line carrying a picture may lose its words (the picture stays); a line without one may not be edited to nothing, because emptying it is deleting it by another name. Editing someone else's words is not a moderator power that exists. Every edited line says **edited**.

## Session recap retention (ADR-0034)

- A finished session leaves **one recap** per session: who was in the session's voice channel, when they arrived, how long they stayed, and whether they rode. **Presence and time only** — never watts, kJ, execution, heart rate or a per-rider workout.
- **Kept 90 days**, then pruned. Long enough to answer "who rode with us last month"; short enough to stop answering "where was this person in March". A crew is a group of people, not an attendance register.
- Readable by the crew's **current members who may enter the channel it ran in** only — a session in a private channel leaves a recap only that channel's people read, because presence is never a way into a private channel (ADR-0058). Leaving the crew ends access. Deleting the crew takes its recaps with it, and deleting an account removes that rider's interval from every recap that names them.
- A session that never started leaves nothing. Sitting in a voice channel with no session leaves nothing.

## Game mode parameters (defaults — tune in alpha)

| Mode            | Parameters                                                                                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Backyard Ramp   | 3-min rounds, start 80 % FTP, +5 % FTP/round; eliminated after 10 s continuously below band; eliminated riders get 50 % FTP ERG and stay in the session                                     |
| Floor is Lava   | Called zone (Coggan 7-zone); leaving the zone >5 s burns a life; 3 lives; zone changes every 2 min                                                                                   |
| Watt Golf       | 9 holes (default — tune in alpha); "hit X W for 10 s, starting in 20 s"; meter hidden from 20 s before to hole end; strokes = mean absolute deviation in watts; targets 60–110 % FTP |
| Sprint Roulette | 10–15 s sprints, random gap 3–8 min, klaxon 3 s before; scored on best 5 s w/kg                                                                                                      |
| Points Race     | Sprints 5 pts/3/2/1; best interval-execution 3 pts; time-in-zone streak 1 pt/interval                                                                                                |
| Team Relay      | One rider "on front" at 110 % FTP (others 55 %); rotate on 60–90 s timer or call-out; the session's distance = Σ front-seconds × front-watts                                                  |
| Collective Ramp | Backyard rules on the **session-average** %FTP; line starts 75 %, +4 %/round; score = rounds survived                                                                                   |

Elimination modes: 30 s disconnect grace (IndexedDB buffer proves continued pedalling on reconnect).

## Sync tolerances

- Metrics latency budget: pedal → every screen **< 500 ms**.
- Jukebox drift (revised per RESEARCH.md §10, retuned #286): **tiered**. Hard `seekTo(t, allowSeekAhead=true)` above **1.5 s**, then **hold still for a 1.2 s settle window and re-measure** (unbuffered seeks land on an earlier keyframe and read back stale while buffering — measuring through it turns one correction into a storm). Between **0.25 s** and 1.5 s, close it on the playback **rate at ±5 %**, which nobody can hear; below 0.25 s, play straight. Settled by doing on a live embed (2026-08-31): a 1.05× request reads back as 1.05, a 1.02× request rounds to 1 — the "rounds unsupported rates toward 1" caveat is real, but its floor is far finer than `getAvailablePlaybackRates()` advertises. An embed that rounds the nudge away loses nothing: its drift grows into the seek tier. All **(defaults — tune in alpha)**. Between corrections, dead-reckon position locally every 250 ms (OpenTogetherTube's proven design).
- Jukebox playhead arithmetic is on **server time, never the rider's wall clock** (#286): a client's clock is routinely seconds off, and adding `Date.now()` to a server anchor put that skew straight into the playhead — each rider chased a different target. Clients estimate the offset from `ServerTick.At` (**max of the last 8 samples** — the least-delayed tick is the truest, no ping/pong needed) and reset the window on every socket open **and whenever the tab returns to the foreground**: a backgrounded tab has its delivery batched, so every sample it takes reads late and the max-filter has no prompt sample left to prefer. A hidden tab therefore stops feeding the ring and keeps what it learned on screen (measured drifting ~2 s otherwise). Verified with three clients on one deck, wall clocks 6 s apart: **2 ms** of spread, against 6 s on the old arithmetic. Below **0.6 s** of measured drift the deck reads as in sync, and the panel says so — the rate tier exists to keep it there, so the badge is a claim the system actively defends rather than a threshold it merely observes.
- The server holds an **anchor, not a timeline**: it has no duration and cannot know a track ended. Clients report `ended` — and a client that finds the shared playhead already **past the track's duration** reports it too. Without that, a deck left playing to an empty channel runs its anchor off the end and the next rider inherits a position no player can reach (#286).
- Shared timeline: server-authoritative; clients render from tick timestamps, never local clocks.
- **A trainer that has sent nothing for 3 s is silent**, and the surface says so — the same number wherever a rider is riding (`SIGNAL_LOST_MS`, #2161). A trainer sends about once a second, so three missed samples is a dropout rather than a slow second; the fault is persistent dashboard status with one recovery button, never a toast (.claude/rules/errors.md). Group riding used to wait ten seconds for the same rider's own trainer while `/ride` and `/ramp` waited three.

## Voice channel audio defaults (defaults — tune in alpha; rationale RESEARCH.md §12)

- Voice and camera are **one tap away, never on by default** (ADR-0010 amendment, #681): entering a voice channel's page connects nothing; the rider presses **Join voice**. A tab that was in voice and reloads within **60 s** of its last heartbeat rejoins with the mic as it was (`REJOIN_WINDOW_MS` — a refresh, not a return from lunch; the tab restamps every **20 s**); hanging up cancels that, and a mic held by another tab on the same machine vetoes it. The **camera never auto-restores** — a shut capture device stays shut until the rider opens it.
- Mic default: **voice-activity gating** (browser echoCancellation + **autoGainControl on**, **noiseSuppression off**. AGC stays on: LiveKit decides who is speaking from the published track's level, the jukebox's ducking rides on that, and every rider's stored gate threshold was set against an AGC'd signal, so switching it off takes the channel's loudness, its ducking and some riders' gates with it — #555. Noise suppression is off because the channel is meant to hear a voice, not a call centre: Chrome's suppressor takes the fan and the voice's air together, and the gate below is what keeps the fan out between sentences — ADR-0043, #1340). The published voice is **Opus, mono, full-band, 96 kbps** (livekit-client's `musicHighQuality` preset), **DTX off** (the gate already sends digital silence; comfort noise over it reads as more suppression), **RED on**; the transmit graph runs at **48 kHz**, Opus's rate, not the speakers'. The level is a **continuous envelope taken on the audio thread** (5 ms attack, 150 ms release), never a window sampled by a timer. Gate numbers: open at level **≥ 0.02** (RMS, 0–1), hold open while it stays within **6 dB** under that, shut **1200 ms** after it falls below, ramps **5 ms up / 150 ms down**; while the jukebox plays the threshold **doubles** (defaults — tune in alpha). The asymmetry is the point: opening late clips a word, closing late costs a moment of fan and breathing, and on a bike the first is worse. The gate rides a local gain stage, never the track's mute — mute state shown to others is only ever the rider's own toggle. Push-to-talk is the alternative, not the default: it suits the desk spectator, and says so where offered.
- **Who came and went** appears on the voice channel's page (ADR-0022's join/leave shape, #984): joined, left, went away, is back. A rider's last socket going quiet is announced after a **15 s grace window** — the client's reconnect backoff is `min(1000 × 2^attempts, 10 s)`, which spends 1+2+4+8 = 15 s trying before it settles, so a phone that is coming back is back inside it and the flap produces no line at all, in either direction. An open socket that hears nothing for **5 s** — five missed 1 Hz ticks — counts as dropped and enters the same backoff (#2135): a network that changes under a socket sends no close, and the hub, which pings every 5 s, has already let the rider go. A device that reports itself offline says so rather than "reconnecting", and dials the moment it is back online (#2121). Arrivals inside the **10 s** event-burst window coalesce into one growing line ("Ana and 2 others joined"). Ephemeral like every other channel event: nothing is written, and a reload shows none of it.
- **A handheld has no gate, and joins listening** (#2142). While a page holds an audio capture, iOS and Android both put the device into its communication mode and play the whole page — WebAudio and media elements alike — out of the **receiver**; nothing on the web overrides that route, and releasing the capture is the only thing that hands the loudspeaker back. A gate holds a capture open for as long as a rider is in voice, so everything above would keep a phone on its earpiece from the moment it joined. Where the pointer is coarse, then: **Join voice arrives with the mic closed**, the chain publishes the capture as it comes (no meter, no gate, no `MediaStreamDestination` — that round trip is also what a phone's audio thread cannot keep up with), and **the mic button is the gate**. Everything else on this page is unchanged; this is what the platform allows, not a second opinion about what is good.
- **A voice channel nobody is in is forgotten after 2 h** ([#2297](https://github.com/natrontech/wattroom/issues/2297)). Its live state — the tick goroutine, jukebox queue, timeline, roster and per-rider sample accumulators — is built by the first join and, until #2297, was held until the process was replaced. Two hours of **no open sockets, nobody in the call, and a session that is idle or done** releases it; the next join rebuilds it from nothing ([ADR-0052](decisions/0052-a-room-ride-the-server-loses-comes-back-from-the-browser.md)'s re-form path, the same one a restart takes). What goes is what was never durable: the **queue and what it was playing**, the channel's "just played", the ephemeral **timeline**, who the channel had **seen**, and any sounding clip. A ride was saved when its session closed, and chat was never here — it lives in the text channels. Two hours is deliberately long rather than tuned — nobody returns to "the call I was just in" after that, so the reclaim is one a rider cannot notice. A session in **countdown, running or paused** does not release the channel however empty it is: those still hold samples nobody has saved, and the session's own clock is what closes and saves them.
- **Who a voice channel shows as speaking** is measured locally, not read from the SFU's active-speaker broadcast (#987): the level of each subscribed voice, taken by the same audio-thread envelope as the mic gate, is what lights a rider. Same threshold as the gate (RMS **≥ 0.02**, holding within **6 dB** under it), but the hang is **400 ms** rather than the gate's 1200 ms — the gate is deciding whether to keep transmitting, where cutting a word is the expensive mistake, while this is deciding whether to draw a ring, and a ring that trails the conversation by more than a second reads as broken. A reading also cannot go stale: the server's broadcast was a memory, so a rider who left or muted mid-sentence stayed lit for the rest of the channel's life.
- Joining voice with music playing and mic open → one-line **headphone nudge** (dismissible, never blocking). Echo cancellation is treated as best-effort — the defaults must work without it.
- Smart autoplay's weighting (#269, ADR-0015 smart selection step 2) — a weighted random draw over the pool, `weight = recency × skip`, both penalties **channel-scoped** so one voice channel's taste never reaches another: **recency** is `0.05` the instant a track ends and rises linearly to `1` over **4 h** (the floor is what makes it a penalty rather than a ban — nothing becomes unplayable); **skip** divides by one more than the times this channel skipped the track, so one skip halves its chances and three quarter them. One refill queues **10** tracks — the deck re-triggers autoplay every time it runs dry, so a short batch re-weights against a fresher history instead of committing the channel to an hour chosen an hour ago. All **(defaults — tune in alpha)**.
- Smart autoplay's **BPM matching** (#270, ADR-0015 smart selection step 3) — while a session runs, a smart refill also weighs each track against the cadence the current block asks for. A track matches when its BPM is within **±5 %** of that cadence **or of double it** (the same beat, felt one pedal stroke at a time instead of two); a match multiplies its weight by **3**. It is a boost and never a penalty, so a pool with no BPM tagged, a track nobody has tagged, and a channel with no session running all draw exactly as they did without it. The cadence rides the tick as `targetRpm` (#1431), and a queue row whose library track fits it says so beside its bpm — the same rule, shown rather than only weighed. The cadence comes from the block's own **cadence band** when it has one (#66 — that band _is_ the work, so it beats any guess), otherwise from effort: **≤ 55 % FTP → 80 rpm**, **≤ 75 % → 85**, **≤ 90 % → 90**, **above → 95 rpm**. An absolute-watts block or a sprint has no fraction that describes the session and so expresses no preference. All **(defaults — tune in alpha)**; the effort tiers in particular are a first guess at how self-selected cadence rises with intensity, not a measured curve.
- Smart autoplay's **affinity** (#271, ADR-0015 smart selection step 4 — auto-DJ) — a track that resembles what this channel has lately played _through_ is boosted: **×3** for the same **artist**, **×1.5** for a **tag** in common, taken in that order so a track that is both earns only the stronger. Taste is the channel's last **20 completions** — by count, not by clock, so a channel that rode yesterday does not come back to a blank slate. A **skip builds no affinity** (it is the inverse of the signal), and a track the channel just finished is excluded from its **own** affinity — that is "more like that one", never "that one again", which the recency penalty already answers. All **(defaults — tune in alpha)**.
- Smart autoplay's weight is the **product** of all four factors — recency × skip × BPM × affinity — evaluated in one SQL pass with no reranking step and no model (ADR-0015's ceiling). Each sits on a base of 1 and is switched off by its own inputs, so a channel with no history, no session and an untagged pool draws uniformly at random.
- The jukebox is a voice channel's **only** music surface (ADR-0018). Jukebox audio is always local per rider (own iframe, own volume) and never enters the voice path. Ducking (#24/#152): dip to **25 %** of the rider's own volume with a **150 ms** attack ramp; release after a **600 ms** hold with a **400 ms** ramp — never a snap in either direction (defaults — tune in alpha).
- **Soundboard** (#877, ADR-0033): a clip is at most **60 s** _of kept audio_ — the source may be longer and is trimmed in the editor, and an untrimmed upload past the ceiling arrives already cut to it — and a rider's clips at most **100 MB** in total. Gain is limited to **12 dB** either way. The board is its **own mixer channel**, never the cues fader — pulling cues down for a quiet ride does not silence it, and pulling the board down does not cost the countdown cue. The board **does not duck under a voice** (#1900) — the one channel on the mixer that does not, where music, cues and a shared screen all dip. A pad is meant to interrupt, and clips are short by design: the 60 s ceiling is an outer bound, not the shape of a fire, so a dip on the ramp above would spend its 150 ms attack and 600 ms hold smearing a clip that is over before the release. A rider who leans on it is turned down by their **per-rider fader**, which covers their voice and their board together (#463): the board's own fader reaches zero, so the channel's remedy is a person, not the feature. Fires are rate-limited on the server to **one per second per rider**, the same ceiling a cheer takes — a client asking nicely is not a limit. A rider's new fire **stops their previous one** on every listener's machine: one rider is at most one voice, so the cooldown bounds what is _sounding_ rather than only what is starting — which is what makes a 60 s clip safe to allow.
- Ride-critical timers (ERG targets, tick handling) run in a **Web Worker** with Wake Lock held — main-thread timers throttle in hidden tabs (an active call exempts the tab, solo rides are not exempt).

## Notifications ([ADR-0042](decisions/0042-notifications-answer-back.md))

- What reaches a rider who is **not looking** — the tab hidden, or the window not the front one: a chat message, a rider arriving, a **session** starting, a poke. A focused, visible page speaks for itself and gets a toast instead.
- Default: **off in a browser**, **on in the desktop shell** (which grants the permission itself). The answer is remembered **per device** either way, because the permission it needs belongs to that browser.
- **Offered once, in context** (#1485): the first time a rider sees a **planned session** in one of their crews — Home's _What's next_ — an inline line offers to turn them on, alongside the plan that makes them worth having. It renders only where the button can succeed: notifications possible on this device, not already on, not blocked by this browser, and not switched off or waved away before. **No browser permission dialog until the rider presses the button** — the 95 % rule rules out a prompt in the first minute. Turning them on, or waving the offer away, retires it on that device for good; Settings → Notifications is where the answer is changed afterwards.
- One switch, in **Settings → Notifications**, plus the email switch for planned sessions ([ADR-0030](decisions/0030-what-wattroom-emails.md)) — a different channel, the same page.
