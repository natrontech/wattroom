# ADR-0011: Two audio profiles — voice is processed, music never is

Date: 2026-08-31 · Status: accepted (#152)

## Context

The capture chain is speech-optimised on purpose: `noiseSuppression`,
`echoCancellation` and `autoGainControl` on the mic track, the gate riding a
gain stage, DTX/RED negotiated for lossy home networks (#151, #165). That
chain audibly destroys anything musical — suppression eats sustained tones,
AGC pumps against dynamics.

Today the only LiveKit-published audio is voice, so nothing breaks. But the
moment any rider-shared audio ships (screenshare with sound, a local track),
routing it through the voice chain would be discovered as a bug mid-ride.
#152 asks for the split to be decided before that day, not during it.

## Decision

Every published audio track is exactly one of two profiles, chosen by what
the track carries — never per rider, never a setting (the 95% rule):

- **Voice** (the mic): processing ON (`noiseSuppression`,
  `echoCancellation`, `autoGainControl`), mono, Opus default bitrate, DTX +
  RED kept. The gate drives a gain stage, never track mute. Unchanged.
- **Music** (any future shared audio — screenshare sound, local tracks):
  processing OFF (all three constraints false), stereo, ≥128 kbps Opus,
  DTX off (silence suppression pumps against quiet passages). Music ducks
  under voice using the SPEC ducking ramp, same as the jukebox.

Client-side, every audible source hangs off the one mixer
(`web/src/lib/sound/mixer.svelte.ts`) — a new music path gets a mixer
channel, it does not set its own volume.

## Consequences

- Screenshare audio (or any music path) is a small, pre-decided change: a
  second `createLocalTrack` call with the music constraints, a mixer
  channel, done. No mid-ride discovery.
- The jukebox is unaffected — it never transits LiveKit (YouTube embed /
  Spotify Jam are locked by WATTROOM.md).
- Still open in #152 and deliberately NOT decided here: Opus
  bitrate/RED confirmation needs the crew AV pass on a real ride
  (docs/LAUNCH.md) — numbers may be tuned there without reopening this ADR;
  the two-profile split stands regardless.
