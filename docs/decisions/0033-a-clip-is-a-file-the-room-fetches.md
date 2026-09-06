# 0033 — A soundboard clip is a file the room fetches, not audio down the voice track

- Status: accepted
- Date: 2026-09-06
- Answers: the transport question [#877](https://github.com/natrontech/wattroom/issues/877)
  parked — the mockups on that issue drew every other part of the feature and
  deliberately left this one open
- Extends: [0022](0022-room-events-are-ephemeral.md) — the fire is a room event,
  the clip is not. Inherits [0002](0002-single-vm-compose-deploy.md)'s "no
  object store"

## Context

[#877](https://github.com/natrontech/wattroom/issues/877) asks for a personal
soundboard: mp3s the rider uploads, nine pads, keys `1`–`9`, a panel that
floats where you drag it, and **its own fader in the mixer** — turning cues
down for a quiet ride must not silence the board, and turning the board down
must not cost you the countdown.

Everything there can be drawn without deciding anything. One thing cannot: how
the sound gets from the rider who pressed the pad to everyone else's ears.

Nothing in the repository answers it, because nothing has needed to. The feel
layer's cues are **synthesised** — oscillators, filters and envelopes in
`web/src/lib/sound/cues.ts` — so a cue has never travelled. It is a `CueId` on
the tick and an identical parameter set on every machine. The moment the sound
is a file one rider owns, that stops working, and the two available answers
are not variations on a theme: they put the audio in different places, with
different failure modes and a different mixer.

## Decision

**The clip is a file. The fire is an event.**

**The clip is durable data.** A `board_clips` table holds `owner_id`, `name`,
`mime`, `bytes`, and the trimmed clip's key — the same shape `chat_images`
already uses for pasted images, and for the same reason: blobs live in
Postgres, and a single VM does not get an object store
([0002](0002-single-vm-compose-deploy.md)). It is served from
`GET /api/board/clips/{id}`, gated on the requester sharing a live room with
the clip's owner — the hub knows who is in the room, and that is the whole
authorization rule.

The one place it departs from `chat_images` is scope, and the departure is the
point. A pasted image belongs to a room and dies with that room's bounded chat
log ([0010](0010-room-first-positioning.md): chat never leaves the room). A
clip belongs to a **rider** and travels with them into every room they ride in.

**The fire is a room event, and rides the tick**
([0022](0022-room-events-are-ephemeral.md)). A new `protocol.Board{ClipID}`,
sent by the client carrying only the clip id; the hub fills the sender from
authenticated presence, checks the clip is the sender's, rate-limits it
through the room's existing `allow(kind, riderID, now, min)`, and batches it
onto the tick beside `Cheer`. Nothing about a fire is persisted.

This supersedes the sketch in #877's body, which proposed one more field on
`Cheer` to save a message type. That was written before the mixer question was
settled: a cheer is an emoji on the reaction layer, a fire carries a blob id,
a different rate limit and a different output channel. Two messages.

**Every client plays it locally**, through its own board fader and its own
per-rider gain. The sound is therefore mixed on the listener's machine, which
is the only place a listener's mixer can possibly work.

### Why not mix it into the sender's voice track

This was the tempting one, and it deserves an honest account rather than a
strawman. `openMic()` already builds a WebAudio graph — capture → meter →
gate gain → `MediaStreamDestination` → `publishTrack` — so a clip is a second
source node into a destination that already exists. No table, no endpoint, no
quota, no licensing question. It is a genuinely small change.

It is still wrong, for three reasons in descending order of how fatal they are:

1. **It cannot deliver the fader that was decided.** The clip would be inside
   the sender's `Microphone` track. A listener's only control over it is that
   rider's voice fader — turn the board down and you have turned that person's
   voice down with it. The mixer in #877 becomes undeliverable, not merely
   harder.
2. **Riders who are not in voice hear nothing.** Mic closed, headphones only,
   LiveKit down: the board silently does nothing, which is the worst way for
   a feature to fail — the sender gets no signal that the room heard silence.
3. **Voice encoding is the wrong tool for the sound.** A `Microphone` source
   is mono, voice-bitrate and DTX-gated; that is tuned for speech and unkind
   to a transient. [#152](https://github.com/natrontech/wattroom/issues/152)
   is already the open bar for that path's quality, and this would add a load
   it was not measured against.

### Why not simply synthesise more cues

The cheapest answer of all is to leave transport undecided forever: extend
`CUES` with more parameter sets. Zero bytes, zero licensing, no transport
question, and it is what the feel layer does today — it should stay the answer
for anything the *product* wants to make a noise about.

It is not an answer to #877, which asks for the rider's own mp3s. It is
recorded here because it is the **retreat**: if the storage or licensing
consequences below turn out to cost more than the feature is worth, the move
is to drop uploads and ship a bigger synthesised pack, not to go looking for
an object store.

## Consequences

- Everyone hears the same bytes at their own level, and the board keeps
  working when LiveKit is down or the rider never joined voice.
- **It is not sample-synchronous.** A fire lands a tick apart across the room,
  plus whatever the first fetch costs. Fine for an airhorn; nobody should
  reach for this to build a metronome or a synchronised countdown.
- **The first press is late unless the clips are warm.** A rider's clip ids
  ride their presence, and each client warms that rider's board in the
  background on join — at most nine small files per rider in the room.
- A new table only: additive, so the expand/contract rule
  ([0019](0019-tagged-releases-and-a-self-converging-vm.md)) is satisfied and
  the rollback path stays safe.
- **Storage becomes permanent and per-rider.** A chat image dies with the
  bounded log; a clip is meant to survive, so it needs a quota and a maximum
  clip length. Those are product numbers: they belong in
  [SPEC](../SPEC.md), not in an ADR, and the feature cannot ship before SPEC
  has them.
- **Riders will upload audio they did not make.** What this decision fixes is
  the exposure: a clip is only ever served to riders sharing a live room with
  its owner, is never public, is never recorded (WATTROOM.md's privacy rules
  cover the room's audio and this is now part of it), and is deleted with the
  account. That is a bound, not a legal position — the operator's takedown
  obligation is untouched, and settling it is the second thing #877 must
  resolve before anyone writes code.
- Revisit trigger: if per-rider clip storage becomes the largest thing in the
  nightly dump, the answer is the synthesised pack above.
