# ADR-0015: Self-hosted music pool — uploaded MP3s join the jukebox

- Status: accepted
- Date: 2026-08-31

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

**Pool and playlists.** One global pool per instance: every logged-in user
uploads to it and browses all of it. Quota **2 GB/user** (one config value —
tune later). Playlists are user-owned, visible to all logged-in users, and
queueable in any room — it's a crew app, sharing is the point.

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

## Consequences

- Easier: music sync (trivial vs. YouTube), ducking (direct gain node),
  audio-only playback (finally legal), no embed-disabled roulette.
- Harder: the VM now stores gigabytes of media — disk monitoring matters,
  and backups must decide whether media is included (metadata is; files are
  re-uploadable, so v1 excludes them from backup).
- Accepted: mp3-only intake; manual BPM tagging; global pool with no
  per-room scoping (metrics privacy is room-scoped, a music library is not
  metrics); 2 GB quota may need tuning.
- Amends WATTROOM.md's "jukebox = synced YouTube queue" line (pointer added
  there).
