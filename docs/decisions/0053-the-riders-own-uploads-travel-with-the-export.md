# ADR-0053 — The rider's own uploads travel with the export; only memory keeps one out

- Status: accepted
- Date: 2026-09-16

## Context

The account export claims Art. 15's scope — a copy of the personal data we
process, not a description of it — and it has been built category by category
since [#1550](https://github.com/natrontech/wattroom/issues/1550), each one a
JSON file with the rows behind a screen the rider already sees.

Files were the exception, and one good reason became a habit.
[ADR-0015](0015-self-hosted-music-pool.md) settled that the music
pool's MP3s stay out: *"metadata is; files are re-uploadable"*, with the
copyright fence — no share links to audio files — behind it.
[#2081](https://github.com/natrontech/wattroom/pull/2081) applied that to
`tracks.json` correctly. Then everything else a rider uploads inherited the
same answer without anyone deciding it should: their avatar, the soundboard
clips they trimmed, the pictures they pasted into a room and sent in a DM.
None of those is somebody else's recording, so the fence does not reach them —
and `chat.json` and `messages.json` had been exporting an image **id** with
nothing in the archive that resolved it, which is the silent omission
[#1089](https://github.com/natrontech/wattroom/issues/1089) was about wearing a
different hat.

The real constraint is a different one. The zip is built whole in memory on
purpose ([#1990](https://github.com/natrontech/wattroom/issues/1990)): a header
already on the wire turns a later failure into a 200 with a short archive, on
the one route where "everything we hold" being short IS the failure.

## Decision

**The rider's own uploads belong in the archive. What keeps any of them out is
memory, never taste.**

A file the rider made or chose — their avatar, their soundboard clips — travels
as a file. A file whose total size per rider has no ceiling waits, and its row
travels meanwhile so nothing in the archive names a file it does not describe.
Concretely, as of #2090:

| upload | rows | bytes | why |
| --- | --- | --- | --- |
| avatar | `avatar.json` | `uploads/avatar.*` | one per rider, bounded by the upload limit |
| soundboard clips | `soundboard.json` | `uploads/soundboard/<id>.mp3` | bounded: docs/SPEC.md caps a rider at 100 MB |
| room pictures | `images.json` | — | no per-rider ceiling |
| DM pictures the rider sent | `images.json` | — | no per-rider ceiling |

Somebody else's upload is not the rider's: a picture a peer sent them is on a
line `messages.json` carries whole, and the picture is the peer's.

The music pool keeps ADR-0015's answer, which is about a third party's
recording and is unchanged by this.

## Consequences

- The question for the next upload feature is settled before it is built, and
  it is a question about size rather than about principle: *is the total a
  rider can hold bounded?* Bounded means the bytes ship with the export.
- Room and DM pictures ship the day the archive stops being built whole in
  memory. That is the revisit trigger, and it is #1990's to pull.
- A rider's export gets bigger — up to about 100 MB of clips for a rider who
  fills their board, on a route already limited to one build in flight per
  account ([#1554](https://github.com/natrontech/wattroom/issues/1554)). Read
  one clip at a time, the way ride samples are, so the working set stays one
  file rather than the library.
- `manifest.json` counts the uploads it wrote, so a clip that failed to read is
  visible rather than silent — the same promise the category list makes.
- The deletion side is unchanged: every one of these tables is `on delete
  cascade` from `users`, so a purge still takes them structurally.
