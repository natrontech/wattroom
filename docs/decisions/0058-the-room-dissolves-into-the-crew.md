# 0058 — The room dissolves into the crew

- Status: accepted
- Date: 2026-09-22
- Answers: #2425, the first issue of milestone M9 (_The crew you live in_). The
  twelve decisions below were taken by the maintainer on 2026-09-22; this file
  records them and the arguments the milestone's issues build on
- Supersedes in part: [0038](0038-the-crew-is-the-layer-above-rooms.md) — its
  "a crew never carries" row and its "the weekly board stays room-scoped"
  section
- Amends: [0010](0010-room-first-positioning.md),
  [0013](0013-room-identity-and-moderation.md),
  [0020](0020-the-app-takes-discords-shape.md),
  [0021](0021-rider-scoped-calendar-feed.md),
  [0022](0022-room-events-are-ephemeral.md),
  [0028](0028-room-and-personal-playlists.md),
  [0036](0036-what-a-room-shows-about-its-members.md),
  [0039](0039-the-public-room-directory.md),
  [0045](0045-a-saved-playlist-is-a-saved-queue.md),
  [0056](0056-a-crew-pins-what-it-keeps-needing.md) and
  [0057](0057-an-announcement-is-a-chat-message-marked.md) — one dated section
  in each, one paragraph per ADR under Consequences below
- Constrained by: WATTROOM.md's locked privacy rules — metrics scoped to where
  people ride together, AV never recorded, rides private by default. They get
  tighter here, not looser, and the section on privacy says where

## Context

[ADR-0038](0038-the-crew-is-the-layer-above-rooms.md) put the crew above rooms
so that a group could be in one place while doing different things, and kept
everything a room owned in the room: _"a crew is membership, naming and
permission; nothing live."_ Every amendment since has moved something up to the
crew without moving the room down. What exists twice today:

- **bans at two levels**, read through one expression (0038's #1106 amendment);
- **roles at the crew** and **overrides per room**, with `room_grants` holding
  the exceptions a private room names;
- **two settings pages**, the crew's and each room's;
- **pins on the crew** ([0056](0056-a-crew-pins-what-it-keeps-needing.md)) and
  **the announcement on the room**
  ([0057](0057-an-announcement-is-a-chat-message-marked.md)), both drawn on
  every room's Board place;
- **the invite on the crew** (#1236) and **the directory listing on the room**,
  which #2245 then had to read as a second door into the crew;
- **the streak, medals, weekly board and sessions-this-month on the room**,
  while the people who actually ride together are the crew;
- **playlists on the room**, so a crew with two rooms keeps two copies of its
  music;
- **a calendar feed per room** beside the one per rider
  ([0021](0021-rider-scoped-calendar-feed.md)).

The room is both halves of Discord at once: a _server_ (members, roles, bans,
streak, history, a door) and a _channel_ (a call, a deck, a scrollback). The
crew was built as the server and never took the server's job. The cost is in the
code as well as in the product — the milestone's sizing counts 45 `/api/rooms`
routes, eleven tables carrying a `room_id`, a 6.4k-line hub keyed by room slug,
a 4.2k-line `rooms` package and 188 files under `web/src/lib/room`.

WATTROOM.md's Rooms, Room UX, Devices, Privacy, Competition, Fan-out and Join
flow rows, and the ADRs listed above, all assume the room. That is why this
takes an ADR rather than a refactor.

## Decision

**The crew is the only object with an identity. Below it are channels, which
are furniture, and sessions, which are events.** The room is not renamed; it is
taken apart, and each of its halves goes where it belongs.

### The object model

| object            | what it is                                                        | what it carries                                                                                                                                                                                   | where it lives                                                                                                                       |
| ----------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **crew**          | the people who ride together                                      | members and roles (owner, admin, member, banned), the one ban, the code and door, the directory listing, image and cheers, pins, the weekly board, the schedule, the streak, medals, session recaps | Postgres                                                                                                                             |
| **text channel**  | a name, a gate, a scrollback                                      | its messages, images, reactions and read marks; at most one announcement                                                                                                                          | Postgres. No socket: chat is HTTP (#468), and the lobby ping says which channel changed                                            |
| **voice channel** | a name, a gate, a deck, who is in it                              | the call (one LiveKit room), one jukebox deck with its queue and autoplay, its events, at most one running session                                                                                | its name, gate and autoplay settings in Postgres; the call, the deck and who is in it in the hub                                   |
| **session**       | a workout on a shared timeline, running in one voice channel      | an id, a coach, the workout, phase, sprint, game and metrics; when it ends, a recap and the rides                                                                                                 | the hub while it runs. Afterwards only what it leaves: the recap ([0034](0034-a-session-leaves-one-recap.md)) and every ride carry its id |

- **A channel belongs to one crew for good**, as a room did. 0038's argument
  carries over unchanged: a movable object makes every visibility rule
  time-dependent.
- **A channel is open or private.** Open: every crew member who is not banned
  may enter. Private: the crew's owner, its admins and the members named into
  it. One function decides entry (`mayEnter`, #2434) and every door asks it —
  the page, the socket, the AV token, presence.
- **Channels have no owner.** The crew's owner and admins create, rename,
  order, gate and delete them.
- **Any member starts a session** in a voice channel they may enter, and is its
  coach until they hand off. A crew admin may end anyone's. **One session per
  voice channel at a time**: starting a second is refused with `conflict`, and
  the refusal names the coach. Two voice channels of one crew run two sessions
  side by side, each on its own tick.
- **A session has no table.** `sessions` is already the login table, and a
  running session is live state, which [ARCHITECTURE](../ARCHITECTURE.md)'s
  seam keeps out of Postgres. Its id is minted when it starts and written onto
  what it leaves behind.

### The twelve decisions

1. **A session runs in a voice channel.**
2. **One deck per voice channel.** [0018](0018-one-music-surface-drop-the-jam-card.md)'s
   one music surface, per call.
3. **Playlists are the crew's** (or a rider's own, as before).
4. **Text lives in the crew's text channels only.** A voice channel has no text
   of its own.
5. **"You" is the first entry of the crew switcher** — the rider's own Home,
   Workouts, Rides, Music, Friends and Messages are a mode like a crew is.
6. **Big bang.** PRs land on `main` in dependency order, CI green is the bar,
   and no release is cut until the milestone closes.
7. **Every room becomes one text channel and one voice channel of the same
   name.**
8. **Roles live at the crew, and a channel may be private** — the crew's admins
   plus named members.
9. **The streak, medals, weekly board and sessions-this-month port to the
   crew.**
10. **The words are text channel, voice channel and session.** "Room" leaves the
    vocabulary.
11. **Any member starts a session**, is its coach until they hand off, and a
    crew admin may end it.
12. **Channels have no owner**; the crew's owner and admins manage them.

### Why a session is not a channel

Three shapes were on the table: a session as a third kind of channel, a session
as a mode a voice channel switches into with a text pane of its own, and a
session as something that happens _in_ a voice channel. The third, for four
reasons:

- **It is Discord's own answer.** An Activity — Watch Together, a game — is
  launched in a voice channel, runs for as long as people are in it, and leaves
  the channel as it found it. The channel is the place; the activity is what is
  happening there. A session has exactly that lifetime: the call before the
  warm-up and after the cool-down is the same call.
- **A channel is somewhere you go; a session is something you join.** A session
  as a channel would put a Thursday ride in the sidebar as a row that appears
  and vanishes, with the people warming up in one row and the people riding in
  another, in what is supposed to be one conversation.
- **`ux.md` forbids typing mid-ride.** A session with its own text puts a
  composer on the one screen where the rule says there must be none. Text is
  read before and after the ride, in a text channel; during it, the voice
  channel is how you talk. The same rule is why there is **no text in voice at
  all**: a scrollback inside each voice channel would be a second conversation
  for the crew to check, split by where people happened to be sitting.
- **One session per voice channel keeps one question one question.** "Who is on
  this call" and "who is on this timeline" stay the same set. Two timelines in
  one call would have one coach counting down over another.

### The URLs

| address                                     | what                                             |
| ------------------------------------------- | ------------------------------------------------ |
| `/crew/[id]`                                | the crew's Home                                  |
| `/crew/[id]/c/[channel]`                    | a text channel                                   |
| `/crew/[id]/v/[channel]`                    | a voice channel                                  |
| `/crew/[id]/s/[session]`                    | a session; `/watch` below it to spectate         |
| `/crew/[id]/schedule`, `/workouts`, `/board`, `/members`, `/settings` | the crew's pages |
| `/c/[code]`                                 | the door, unchanged                              |

Every `/r/[slug]/…` address redirects to its successor (#2458) — the room's
text channel for the room and its chat, the voice channel or its running
session for Training and Watch, the crew's page for the rest — so nothing a
rider bookmarked or pasted lands nowhere.

### The numbers are SPEC's

Channels per crew, planned sessions per crew, messages per text channel, recap
retention and how many crews a rider may found are defaults proposed in the
milestone and set in [SPEC](../SPEC.md) by #2426, to be tuned in alpha. None is
decided here and none is written into code. The one structural number — **one
session per voice channel** — is a decision, not a default.

### Every room becomes a pair, and the migration errs narrow

Each room becomes a text channel and a voice channel with the room's name and
the room's gate: an open room gives two open channels, a private room two
private channels whose named members are the room's members and grants. Its
chat goes to the text channel; its deck settings and play log to the voice
channel; its recaps, plans, medals and rides to the crew, with the channel where
there is one. The room tables stay for one release and are dropped in the
release after M9 (#2433) — [ADR-0019](0019-tagged-releases-and-a-self-converging-vm.md)'s
expand/contract rule, which is what keeps retagging the previous image safe.

**One rule governs every backfill: nobody can reach, see or be shown anything
the day after the migration that they could not the day before.** Where the new
model cannot say exactly what the old one said, the backfill picks the narrow
side:

- **A room ban becomes a crew ban.** There is one ban now (#2442), and
  dropping a room's ban would let the banned rider walk into the channels of
  the room that banned them. A rider banned from one room and welcome in
  another loses the other as well until an admin lifts the ban — the narrow
  side, undone in one action, against the wide side, which cannot be undone at
  all.
- **A room owner who is not a crew admin becomes a member.** Promoting them
  would open every private channel in the crew to them. Where their room's
  channels are private they stay in them as a named member.
- **A rider is on the crew's weekly board after the migration only if they were
  on a board before it** — `on_board` set in a room whose board was on. A crew
  board turned on because one of its rooms had one would otherwise put everyone
  from the crew's other rooms on it: [0036](0036-what-a-room-shows-about-its-members.md)'s
  enrolment by existence, which is the exact thing 0038 kept the board
  room-scoped to prevent.
- **A room's icon does not survive.** Channels are named, not marked; the crew
  carries the mark.

### Privacy gets tighter

**Live metrics are visible only inside the session, and only while it runs.**
Inside the session means connected to the voice channel it runs in — on its
timeline or watching it. A room's tick carried every rider's numbers to
everybody connected to the room; a session's numbers go to its own channel
(#2438), so a crew running two sessions keeps each one's numbers inside its
own call, and the rest of the crew gets none of them. What the rest of the crew
does see — that a session is running, which workout, how far in, who is
coaching, how many are riding — is presence, the same class of fact as
[0010](0010-room-first-positioning.md)'s sidebar radar, and never a number from
anybody's trainer.

**Who may see whom follows the channels two people may both enter**, which is
0038's rooms-in-common rule with the room taken out. On migration day it is the
same set, because every channel inherits its room's gate.

**The weekly board stays off until the crew turns it on**, and the crew's door
says so (0036's disclosure, moved from the room's door to `/c/[code]`); the
per-rider switch moves onto the crew membership; the migration rule above keeps
anybody from waking up on a board.

**There is one ban and one gate.** Every door asks the same function, and a
crew ban severs every channel at once (#2436) instead of relying on two levels
being read together everywhere they need to be.

**The one change that can read as looser**, said out loud: a crew admin enters
a private channel without being named. Under 0038 an admin could not read a
private room they had not joined — but they could let themselves in, because
opening a private room to the crew and naming anyone into it were both theirs
(#1226, and 0038's #2294 amendment). The set of people who can reach a private
channel is therefore unchanged; the step is what goes, and with it the trace
that opening the room or a grant row left. In a voice channel an admin is on the roster
like anyone, so live numbers are never seen by someone who is not visibly
there. A text channel's history carries no such presence, and that is the cost
decision 8 accepts.

Unchanged and restated so nobody reads the reshuffle as licence: AV is never
recorded, rides are private by default, and nothing here puts a rider's
numbers anywhere a rider did not choose to ride.

### What does not change

The door (`/c/[code]`, the crew code). Voice connecting on a tap and never on
arrival — entering a voice channel's page connects nothing, exactly as
entering a room did (0010's #681 amendment). One deck per call and every
YouTube RMF rule on it. TV mode. The client owning the trainer. Every stats
formula and XP value: only their scope changes, so a crew that rode in two
voice channels in one week has **one** streak, and sessions this month still
count distinct days (0036), which keeps splitting an evening across two
channels from flattering a crew any more than its size could. The
`crew-chief` slug, which 0038 left named after the old sense of the word, now
reads right. And the product's name: _WattRoom_ is a name, not a noun in the
vocabulary.

### Big bang, and why

M9 ships as one release. 0038 made the argument and it binds harder here: _a
half-built permission model in production is a privacy failure rather than a
missing feature_. A crew whose channels exist while a room still gates, or one
ban level collapsed and the other still read, is exactly that failure. So PRs
land on `main` in dependency order, each green on its own, migrations
expand-only; no release is cut until every M9 issue has merged and been seen
working in the running app and against a copy of production (#2462); and
nothing outside the milestone lands until it closes.

## Consequences

### What this supersedes or amends

- **[0010](0010-room-first-positioning.md)** — the place you idle in is a
  voice channel. Decision 1: voice is what a voice channel is for, and entering
  one still connects nothing. Decision 2: the radar is the crew's channels — who
  is in which voice channel, what is running, unread per text channel (#2444).
  Decision 3 as amended by #201: the bounded log is per text channel, at SPEC's
  bound. Decision 4 is unchanged.
- **[0013](0013-room-identity-and-moderation.md)** — identity is the crew's:
  its mark and its reaction palette. A ban is a crew role
  (`crew_roles.role = 'banned'`), which keeps the seat occupied the way the
  membership row did; there is no room ban. The lucide amendment carries over
  unchanged.
- **[0020](0020-the-app-takes-discords-shape.md)** — a room opening into its
  places is gone. A crew opens into its pages (Home, Schedule, Workouts, Board,
  Members, Settings), then its text channels, then its voice channels (#2447).
  "You" joins the switcher as its first entry: the #1023 amendment's _the crew
  is a mode, not a level_, finished — the rider's own pages are the mode with no
  crew. One column, one lit row, one home per object and voice as a state you
  carry all hold.
- **[0021](0021-rider-scoped-calendar-feed.md)** — the room feed is replaced by
  the crew feed, on `crews.ics_token`; the rider feed unions the crews it is in.
  _"Room feeds stay exactly as they are … existing subscriptions must not
  break"_ does not survive: an old room-feed URL answers 404 and a subscribed
  calendar goes quiet (#2441), which the crew's settings page says once. The
  alternative was serving the crew's schedule at the room's address, and that
  would widen what a link already in somebody's calendar discloses — to plans
  in every channel of the crew, handed to a holder who was given one room's.
- **[0022](0022-room-events-are-ephemeral.md)** — events ride the voice
  channel's tick and are drawn on that channel's page, beside the deck they are
  about. They never enter a text channel, which has no tick and holds what
  riders said. Chat leaves the tick altogether (#2437).
- **[0028](0028-room-and-personal-playlists.md) and
  [0045](0045-a-saved-playlist-is-a-saved-queue.md)** — a saved playlist is the
  crew's or a rider's. Autoplay belongs to the voice channel: each one names its
  active playlist from the crew's, ordered or shuffled, and still only fills
  silence. One playlist queued into two channels plays in each independently.
  0045's audio door asks the same question with the room taken out — whether
  the rider may enter a channel with the uploader.
- **[0036](0036-what-a-room-shows-about-its-members.md)** — what a crew shows
  about its members: sums, your own turnout, and a board that is off until the
  crew's owner or an admin turns it on, disclosed at the crew's door. 0038 kept
  the board room-scoped because a crew board would put a rider beside people
  from rooms they had never entered. With no rooms, the crew _is_ the set a
  rider was let into — the unit that reasoning asked for — and the migration
  rule keeps its trap shut on the way across.
- **[0038](0038-the-crew-is-the-layer-above-rooms.md)**, superseded in part.
  The crew now carries voice, decks and sessions — through its voice channels.
  The crew itself still holds nothing live: a voice channel holds the call and
  the deck, a session holds the game and the metrics. _"The weekly board stays
  room-scoped"_ is superseded (0036 above). _"Coach stays a room-level
  assignment"_ ends where its own reason pointed — _a light, live action, never
  a crew-role change_: the coach is whoever started or was handed the session.
  Two ban levels become one; per-room overrides become a channel's gate;
  person-visibility follows channels in common; the #1334 amendment's _the crew
  carries no chat_ becomes _the crew's conversation is its text channels_. What
  stands: the crew as the unit of membership, objects that never move between
  crews, the door (#1236, #2144) and the owner (#1106).
- **[0039](0039-the-public-room-directory.md)** — the directory lists crews
  (`crews.listed`, #2445). The entry rule stands word for word: a name, a mark
  and a link; listing opens the door into the crew (#2245) and nothing past it.
- **[0056](0056-a-crew-pins-what-it-keeps-needing.md)** — the Board is the
  crew's page, `/crew/[id]/board`, not a place repeated inside every room. The
  pins, the bound and _everyone in the crew writes_ are unchanged.
- **[0057](0057-an-announcement-is-a-chat-message-marked.md)** — an
  announcement is a text channel's message marked, one per text channel, kept
  through the prune as before. The crew's Board leads with the newest across
  its text channels; the channel shows its own above its log; the Lounge's
  idle-only strip moves with the Lounge to the voice channel page and carries
  the crew's newest. Marking and clearing move from the coach to the crew's
  owner and admins: the coach was a standing room role and is now a role for an
  evening, and an announcement speaks for the crew.

Other ADRs say "room" where the substance is unchanged, and are read through
this one rather than annotated: where one says _room_ about a session's
riding, read the session ([0034](0034-a-session-leaves-one-recap.md), 0046,
0041, 0052); about a call or a deck, read the voice channel (0018, 0011);
about who may see whom, read channels in common (0024); about membership,
identity or a door, read the crew.

### WATTROOM.md is marked now, not at the cutover

0038 held its WATTROOM.md markings back until the change that made them true,
so the founding record would never describe a repo that did not exist. This ADR
marks the seven rows in the same PR, for two reasons that did not hold then.
M9 is a big bang: nothing is released until every one of its issues has
landed, so the rows and the released product change in the same tag. And every
agent building M9 reads WATTROOM.md first; leaving the room rows unmarked would
have them building against the rows the milestone removes. The rest of the
file's room vocabulary — the pitch, §3's hub, §4's room streaks, §7's naming
line — is the final pass in #2461, not this PR.

### What gets harder, and what is accepted

- **Size.** This is the largest single change the repository has taken, and
  the freeze that comes with it is a real cost at the repo's pace: everything
  outside M9 waits until M9 closes. A fix production needs before then is the
  maintainer's call, not a path this ADR pre-builds.
- **One re-subscription per crew.** Old links redirect; calendar feeds cannot
  (0021 above). The changelog says so before anyone upgrades (#2461).
- **LiveKit rooms are renamed** from slug to channel id, so a call in
  progress at the deploy drops. The deploy already refuses to interrupt a ride,
  and a call rejoins in one tap.
- **Text beside a ride** is deliberately absent. Revisit only if riders in the
  alpha ask for it unprompted, and even then the first answer is a text channel
  linked from the voice channel, before any scrollback inside one.

## Alternatives considered

**Keep the room, as a container of channels** — crew → room → channel. Three
levels of the same idea; Discord has two, and 0020's arithmetic (#1023) already
had to be re-argued once for the depth 0038 added. Rejected.

**A session as a channel.** Rejected above: a channel is a place, a session is
an event in one.

**Text in voice.** Rejected above: a second scrollback per call, and a composer
where a rider must not type.

**Channels owned by whoever made them.** Two management models in one crew,
and a room owner's powers reborn one level down. A channel is furniture; the
people who already manage the crew's gates keep it.

**Coach as a crew role.** 0038 already refused it — handing off mid-session
must stay light and live. Carried to its end: the coach is a property of the
session.

**A phased move with rooms and channels side by side in production.** 0038's
one-release argument, with more at stake: this time both permission models
would be live at once.
