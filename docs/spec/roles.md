# Spec: Roles and permissions

Part of the product spec. [docs/SPEC.md](../SPEC.md) indexes every section and says which values change without an ADR.

## Roles & permissions

One table, because there is one place roles live: the crew ([ADR-0058](../decisions/0058-the-room-dissolves-into-the-crew.md)). A channel has no roles of its own, and **coach** is not a role — it is whoever is running a session (‡).

| Capability | Crew owner | Crew admin | Member | On a phone † |
| --- | --- | --- | --- | --- |
| Rename the crew, set its icon and picture (#1237) | ✓ | ✓ | – | ✓ |
| Edit the crew — directory listing, weekly board (#2454) | ✓ | ✓ | – | ✓ |
| Make / unmake a crew admin | ✓ | ✓ | – | ✓ |
| Ban / unban from the crew (#1150) — never the owner | ✓ | ✓ | – | ✓ |
| See the crew's ban list | ✓ | ✓ | – | ✓ |
| Hand the crew to someone in it (#1208) | ✓ | – | – | ✓ |
| Make a new crew code (#1930) — the old one stops working at once | ✓ | ✓ | – | ✓ |
| Invite — share the crew's code or link (#1236) | ✓ | ✓ | ✓ | ✓ |
| Leave the crew (#1228) — the owner hands it on first | – | ✓ | ✓ | ✓ |
| Create, rename, reorder, open / make private, delete a channel; set a voice channel's sound pack (#2434) | ✓ | ✓ | – | ✓ |
| Name a member into a private channel, or take them out (#2434) | ✓ | ✓ | – | ✓ |
| Move a rider from one voice channel to another — drag their name, or its menu (#2730). Never one who is pedalling, and only through a door they may walk through | ✓ | ✓ | – | ✓ |
| Enter an open channel | ✓ | ✓ | ✓ | ✓ |
| Enter a private channel | ✓ | ✓ | if named | ✓ |
| Delete any message in a text channel ([#2417](https://github.com/natrontech/wattroom/issues/2417)) — anyone may delete **their own** | ✓ | ✓ | – | ✓ |
| Put up and take down a text channel's announcement ([ADR-0057](../decisions/0057-an-announcement-is-a-chat-message-marked.md)) | ✓ | ✓ | – | ✓ |
| Pin, edit and unpin on the crew's board ([ADR-0056](../decisions/0056-a-crew-pins-what-it-keeps-needing.md)) | ✓ | ✓ | ✓ | ✓ |
| Start a session — planned or not — in a voice channel you may enter (#2438, #2440) | ✓ | ✓ | ✓ | – |
| Join or leave a running session, or free-ride in a voice channel you may enter ([ADR-0059](../decisions/0059-a-voice-channel-rides-without-a-session.md)) | ✓ | ✓ | ✓ | – |
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
| Hand a bottle up to a rider riding the session (#3022) | ✓ | ✓ | ✓ | ✓ |

‡ **Only while they are the session's coach** — whoever started it, until they hand it to someone in the session (#2438). Being the crew's owner or an admin does not make anyone coach. The one lever the owner and admins hold over a session somebody else is running is **ending** it, which is what a voice channel needs when a session is left running in it: there is one session per channel, so an abandoned one would hold the channel shut.

† **The last column is a device, not a fourth role** (#1767, headed "Spectator (phone)" until then; `device.spectator` in the code is this column). It is the same rider holding a phone, and it reads _and on a phone?_ — a ✓ says the capability the first three columns gave them still works there. A **–** marks the only thing that can take one away: needing something a phone has not got — a **paired trainer** (Web Bluetooth is not on iOS Safari, [ADR-0004](../decisions/0004-chrome-first-with-native-escape-hatch.md)), or the **riding screen a session is run from**, since starting a session, picking its workout, counting it in and arming a sprint are the coach's cockpit and belong on the device they are pedalling at. Moderating and planning need neither, so an owner with nothing but a phone can ban a griefer, end a session left running and put next Tuesday on the calendar. The crew's **Settings** page is not offered in the narrow drawer (#2447) — a navigation choice under the 95 % rule, not a capability the phone lacks, so its rows keep their ✓. This column read "–" on every row above _Say you are in_ until #1767; the code had never gated moderation, so it was the matrix that was wrong ([ADR-0020](../decisions/0020-the-app-takes-discords-shape.md)'s 2026-09-05 amendment gates "the affordances that need something a phone does not have", and WATTROOM.md's device row gates "the affordances that would fail on it rather than the page").

Session controls — pick, start, pause, resume, end, arm a sprint, hand off, start or end a game — are rate-limited on the server **per rider and per control: the same control at most four times a second** (#3019, defaults — tune in alpha). No coach needs one button twice inside a quarter second, and without it a looping client had the room re-validate a 64 KiB workout as fast as its socket delivered. It is per control, not one allowance per rider, because the client sends its own Start on the first tick that shows its pick landed: ticks are once a second, so the Start follows the pick by a round trip plus anything up to a second, and a shared allowance would refuse up to one Start in four. A second tab shares the rider's allowance rather than doubling it, and a refused control answers `rate_limited`. Joining and leaving the session are not limited: each only marks the rider in or out, which the next tick carries, and the session page sends its join by itself, so a rider's second tab would otherwise be refused a join nobody tapped.

Caps (defaults — tune in alpha): a rider **founds at most 3 crews**, counted over the crews they founded and still own, so handing one on frees the slot, and so does one going. A crew has no delete button (#1935): **a crew with nothing left in it goes** — no channel and nobody in it but its owner — with the owner's delete of its last channel or its last member's leave, never with a ban (#2079, #2837). A crew with a channel never goes that way; its channels are what it holds (ADR-0058). A crew holds at most **20 text channels** and **10 voice channels**. A voice channel runs **one session** at a time — that one is not a default but the model (ADR-0058), and a second start is refused rather than counted. Membership is uncapped.

Names, counted in characters (not bytes, #1986): a crew or channel name is 1–60, a workout name (planned, ridden or saved) 1–80, a route name 1–80 ([#3024](https://github.com/natrontech/wattroom/issues/3024)), a token name 1–60, a chat or direct message 1–500, a display name 1–60.

Shelf ceilings (#1414, defaults — tune in alpha). A crew holds at most **100
planned sessions** — counted the way the crew's own schedule counts them,
upcoming and not yet started, so a plan that ran, was cancelled or fell past its
grace gives its slot back. An account holds at most **200 saved workouts** and
**200 routes** ([#3416](https://github.com/natrontech/wattroom/issues/3416)),
and keeps at most **10 routes a minute** — the saves budget rides already have.
**Rides are not capped**: a rider's history is the product, and nothing may
delete or refuse it. A ceiling — these, the crew and channel caps above — is
refused with **429 `rate_limited`** (errors.md, the same shape as the ten-token
cap) and the message names the number and the remedy — never a wait, because a
ceiling does not clear on its own.

Ceilings are not what keeps a read small, and a read must never silently drop
what it cannot fit (#1908): the saved-workout shelf is **paged, 100 a page**,
by the `?before=` cursor the rides list uses. Calendar feeds carry **30 days of
history and one year ahead**, at most **1000 events** per render — the ICS body
is built in memory for a bearer-token URL, and planning is capped three months
out, so the horizon hides nothing anyone planned.

### The crew, its owner and its channels ([ADR-0038](../decisions/0038-the-crew-is-the-layer-above-rooms.md), [ADR-0058](../decisions/0058-the-room-dissolves-into-the-crew.md))

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
  switch ([ADR-0039](../decisions/0039-the-public-room-directory.md), amended):
  the entry is a name, a mark and a link, and joining from it joins the crew,
  so its open channels come with it — which is why it is a crew-level act.
- **Succession**: when the owner deletes their account, the crew passes to its
  longest-standing admin (by the day they joined the crew, not their last role
  change), else its longest-standing member. With nobody left, the crew is
  deleted. Never the departing owner, never anyone the crew banned, never
  ownerless.

Crew identity & vocabulary (#223, #447, #2643): the crew's icon is **one drawn
icon from a curated set, or none**, stored as its lucide key, beside an optional
picture (#1237). Channels are named, not marked.

A rider's **reaction set is their own** (#2722), not the crew's: **up to 8** —
drawn icons from a second curated set (base set: flame, biceps-flexed,
party-popper, skull, rocket, snowflake) or any Unicode emoji, picked in
Settings → Profile. The first four are their mid-ride cheer buttons, and all
of them lead the chat's emoji picker in every crew and DM, which offers every
emoji and the crew's own besides. A crew's own emoji is not in the set — it
means something in one crew only ([ADR-0013](../decisions/0013-room-identity-and-moderation.md),
2026-09-24 amendments). The server checks a reaction's shape, not the
vocabulary.

**Crew emoji** (#2643): any member adds one; the one who added it, the owner
and admins delete it. A crew holds at most **50**, a picture is at most
**256 KB** (a still is drawn at 128 px; a GIF keeps its animation), and a name
is **2–32 characters of `a–z 0–9 _`**, unique in the crew **(defaults — tune in
alpha)**. Used as a reaction and inline in a message as `:name:`; a name the
crew does not know is shown as the text it is. The 51st is refused the way the
other ceilings are (429, the number and the remedy).

Session lifecycle: a voice channel idles (voice and jukebox) → a member who may enter it starts a session and picks the workout, becoming its coach → 10 s countdown **(default)** → shared timeline runs → the riders who joined execute their own %FTP targets (the starter is in; anyone else joins with Join the ride and leaves with Leave the ride) → session closes when the timeline ends (or the coach ends it, or the crew's owner or an admin does) → server computes stats + medals in one transaction. **One session per voice channel**: starting another while one runs there is refused with `conflict`, and the refusal names the coach (#2438). The coach hands the session to anyone riding in it — a light, live action, never a crew-role change. Late joiners sync to the current timeline position. A member stopping mid-session pauses _their own_ targets (auto-pause) — the shared timeline never waits. The picked workout is then ridden as planned: **nobody skips a block or adds a minute in a session** ([ADR-0046](../decisions/0046-one-riding-surface.md) amended, #1635). Pause, resume and end are the coach's only holds on the shared timeline — the coach cannot add a minute, and ending the session is the only escape; changing the work itself is the workout editor's job. A rider **alone** owns their clock outright and keeps `+1 min` and `Skip block`.

A ride **alone** has the same lifecycle with the roster removed: rider picks workout → **3 s count-in** → their own timeline runs → closes when it ends (or they end it) → the ride is saved to their account. The count-in is a session's, shortened because nobody else is being waited for — same 3-2-1-go cues, same one-digit screen, and the same three seconds the resume countdown gets below. It is **not** an exception to ADR-0046's parity rule: the clock starts when the count-in ends, so the first block's target reaches the trainer then and not at the tap. A rider who changes their mind during it cancels back to the setup screen with the trainer still paired — nothing was ridden, so nothing is saved. The ramp test counts in the same way; it is a workout, not a third thing.

A **free ride** ([ADR-0059](../decisions/0059-a-voice-channel-rides-without-a-session.md)) has no timeline and no count-in. One control, one toggle between two modes: **grade** in **0.5 %** steps from **−5 %** to **+15 %**, where it opens, at **0 %**; and **watts** in **10 W** steps from **50 W** to **1000 W**, opening at **55 % of FTP** rounded to 10 W (defaults — tune in alpha). A one-gear setup (`singleSpeed`, a Zwift Cog) opens in **watts** instead, since the slope has no usable range there; grade stays one tap away. The ride guards below apply in watts mode only, since grade holds no target to release. It records from the first pedal stroke to **End ride**, is saved as the empty, unscored workout "Free ride", and follows the solo ride's minute rule. A session in the channel leaves it alone; joining one saves the free ride first. A third mode rides a **road** ([ADR-0062](../decisions/0062-the-horizon-may-be-a-road.md)): the grade is the road's **felt grade**, the step control goes, and the numbers are under Route rides. The free ride rides alone on `/ride` too, in all three modes. In grade mode the rider also shifts: Easier and Harder move a virtual gear (see Virtual gears).

The free ride is not the only way to ride a voice channel with no session of your own: **your own workout** rides there too, beside any session (ADR-0059 amended, #3340). It is picked from the same library as `/ride`, and it follows the ride-alone lifecycle above — the **3 s** count-in, the rider's own clock with `+1 min` and `Skip block`, saved and scored like a ride alone. Its audience is the free ride's, and the workout's name and steps are shown to nobody. It is a spectator of the session: its trainer is not driven, nothing of it counts, and joining the session saves it first.
