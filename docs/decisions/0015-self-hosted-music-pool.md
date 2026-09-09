# ADR-0015: Self-hosted music pool — uploaded MP3s join the jukebox

- Status: accepted
- Date: 2026-08-31

> **Amended by [ADR-0028](0028-room-and-personal-playlists.md) (2026-09-05):**
> playlists are room-owned or rider-owned, not "user-owned and visible to all
> logged-in users". The Decision paragraph below said the latter for a month
> after it stopped being true, and was read as evidence that playlists shared
> the pool's scope problem — they never did (#1097).
>
> **Amended by [#1095](https://github.com/natrontech/wattroom/issues/1095)
> (2026-09-08):** the pool is scoped to the uploader, not global per
> instance, and a room's autoplay reaches its own members' shelves. The
> "one global pool per instance" decision and the "no per-room scoping"
> consequence below are both struck through in place; the reasoning for
> each is beside it.

## Context

The jukebox is YouTube-only (WATTROOM.md, locked), and every hard problem it
has is YouTube's: RMF constraints force an always-visible ≥200×200 tile with
nothing overlaid and prohibit audio-only playback (docs/RESEARCH.md §3),
embed-disabled music is a constant annoyance, and sync needs the whole
seek-first/re-measure/rate-nudge machinery (docs/SPEC.md) because iframe
seeks land on keyframes. Riders mostly want *music*, not video. A shared
library the crew uploads to — with playlists, metadata, and selection that
understands the workout — also fits M7's "room as a persistent place".

## Decision

**Mixed queue.** `JukeboxEntry` carries `videoId` *or* `trackId`; one queue,
entries interleave. The hub's anchor sync (`PositionSec` + `AnchorMs`,
clients chase) is unchanged. MP3 entries play through an `<audio>` element:
sample-accurate instant seeks (drift correction collapses to
`currentTime = target`), ducking via a direct gain node, and — since no
YouTube policy applies — genuinely audio-only, no tile required. RMF rules
apply only while a YouTube entry is playing. The YouTube path stays for
shared video watching.

**Storage.** Audio files live on the VM disk (ADR-0002), content-addressed
by SHA-256 — duplicate uploads dedupe to one file. Postgres holds metadata
only (`tracks`, `playlists`, `playlist_tracks`), keeping the durable-data
seam intact. Serving is authenticated stdlib `http.ServeContent` (range
requests, seeking, caching for free). MP3 only at first — every browser
decodes it natively, so no transcoding and no ffmpeg in the image.
<!-- ponytail: mp3-only, no transcoding. Add m4a/flac acceptance when
     someone actually has a library in them — still no transcoding, both
     decode natively in evergreen browsers. -->

**Pool and playlists.** ~~One global pool per instance: every logged-in user
uploads to it and browses all of it.~~ **Amended 2026-09-08 (#1095):** the
pool is **scoped to the uploader**, and a room's autoplay reaches the shelves
of its own **members**. Quota **2 GB/user** (one config value — tune later).
Playlists are user-owned — ~~visible to all logged-in users~~, superseded by
[ADR-0028](0028-room-and-personal-playlists.md), which made them room-owned
or rider-owned — and queueable in any room.

The original decision was coherent *while one instance meant one crew*: it is
a crew app and sharing is the point. It stops being coherent the moment
wattroom.ch carries crews who do not know each other, at which point "global
per instance" means a library shared with strangers rather than a record
shelf shared with mates. The fence was never removed; the ground moved out
from under it. See the copyright posture below, which assumed *private crew*
all along.

A row is identified by `(uploader, sha256)`, not by content alone — otherwise
the second person to upload a song gets handed somebody else's row and has
none of their own. **The file is not scoped**: one blob per `sha256` on disk
however many shelves point at it, and the delete path is refcounted so the
bytes go only with the last row. Privacy is what you can see, not how many
times the bytes are stored.

**Crew scope (Phase 2) is the intended end state**, waiting on #1022's crew
ADR; it only ever *widens* access from here, never narrows it. *Landed —
see the 2026-09-08 amendment below.*

**When a playlist can hold a pool track**, its entries inherit the scope
above — a saved list is not a way around who may hear a shelf. Nothing does
today: `playlist_tracks` stores `video_id`, so every saved entry is YouTube.
[#655](https://github.com/natrontech/wattroom/issues/655) is the open ADR for
making saved playlists multi-source, and is where that rule has to be
written down rather than inferred from here.

**Metadata.** ID3 tags parsed at upload (`dhowden/tag` — small pure-Go;
duration comes from the uploading browser's `audio.duration`, no server-side
frame parsing). Every field is user-editable in place — real-world tags are
garbage and edit-beats-cleanup. Genre/style are free-form tags, not a
taxonomy.

**Smart selection — all four, staged in this order:**

1. *Search + filters*: Postgres full-text over title/artist/album plus tag
   facets. No search engine, no embeddings.
2. *Smart shuffle*: weighted random in one SQL query — recently-played
   penalty, skip-count penalty. Requires recording plays and skips per track.
3. *BPM-to-workout matching*: during a segment, prefer tracks whose BPM fits
   the target cadence/effort (~cadence or 2× cadence). BPM comes from the
   ID3 `TBPM` frame plus manual tagging — no automatic beat detection.
   <!-- ponytail: no audio analysis. Add in-browser beat detection at upload
        if untagged tracks dominate the pool. -->
4. *Auto-DJ*: taste-based picks from the play/skip history that (2) records.
   Ships last — it only gets good once the pool and history exist.

**Copyright posture.** The pool is the private-crew-Plex risk profile,
accepted deliberately and fenced: login-gated (ADR-0009), never public, no
federation, no public share links to audio files, uploads only by
authenticated members. Loosening any of these fences is a new ADR.

**#1095 restored a fence rather than moving one.** *Private crew* is the
assumption this paragraph rests on, and an instance-wide pool stopped
supplying it once one instance could hold several crews. Scoping the pool
is what makes the risk profile above true again.

## Consequences

- Easier: music sync (trivial vs. YouTube), ducking (direct gain node),
  audio-only playback (finally legal), no embed-disabled roulette.
- Harder: the VM now stores gigabytes of media — disk monitoring matters,
  and backups must decide whether media is included (metadata is; files are
  re-uploadable, so v1 excludes them from backup).
- Accepted: mp3-only intake; manual BPM tagging; ~~global pool with no
  per-room scoping (metrics privacy is room-scoped, a music library is not
  metrics)~~ — **reversed by #1095**: a music library turned out to be
  exactly as personal as metrics once an instance could hold strangers;
  2 GB quota may need tuning.
- Changed by #1095: **a duplicate is no longer free.** This ADR's storage
  note said a second upload of the same bytes "stores nothing, and charges
  nobody — which is also why the quota can be a plain sum of `size_bytes`
  over a user's own rows". Two shelves holding one song are now both
  charged while one file sits on disk. That is arguably the right answer —
  a shelf costs what it holds — but it is a change, and the quota sum is
  now a statement about a shelf rather than about disk.
- Amends WATTROOM.md's "jukebox = synced YouTube queue" line (pointer added
  there).

## Amendment, 2026-09-08 (#1103): Phase 2 — the pool's reach follows the rooms you may enter

Phase 1 (#1095) drew the playing-versus-browsing line and set *playing* to
"the uploader, and anyone who shares a room with them". Phase 2 keeps the
line and re-derives the reach from the crew ([ADR-0038](0038-the-crew-is-the-layer-above-rooms.md)):

- **A track plays for whoever may enter a room its uploader may enter**,
  asked of `visible_rooms` — the single expression ADR-0038's third
  amendment makes the only place allowed to answer that. A room open to its
  crew counts for everyone in the crew, so joining one of a crew's rooms is
  enough to hear what its members put on the deck of any room you could
  walk into. This is the same rule person-visibility follows (#1135), and
  it is *widening only*: nobody who could hear a track before loses it.
- **Except the banned.** The old join read `memberships.role != 'banned'`
  by hand. A crew ban leaves the membership row in place, so a crew-banned
  rider kept fetching a crew-mate's bytes — the door #1126 did not list.
  Routing the reach through the view closes it, at both levels.
- **Autoplay's draw stays on the room's members**, not the crew — confirmed
  on purpose, against the option the issue held open. Crew membership
  follows room membership, so a crew-wide draw would put a shelf into the
  rotation of rooms its owner never entered, which is the "my music plays
  in a room I left" surprise at a larger radius. The member join goes
  through `visible_rooms` too: a member the crew banned loses their say in
  what the room plays.
- **Browsing is not widened.** List, search, facets, edit and delete stay
  uploader-only on `GetTrack`. Sharing a crew means hearing what its people
  put on, not reading their libraries.

The copyright fence above holds: reach is still bounded by rooms people were
let into, one code at a time. Nothing here makes a file reachable to anyone
who was not already permitted into a room with its uploader.
