# 0043 — Voice goes out clean: no noise suppression, full-band Opus

- Status: accepted
- Date: 2026-09-09
- Amends: SPEC.md "Room audio defaults" (the mic constraints were marked "defaults — tune in alpha"; this is the tune)
- Answers: [#1340](https://github.com/natrontech/wattroom/issues/1340), raised by rider reports that voice "sounds like noise reduction and stuff"

## Context

Since #151 the mic has been captured with Chrome's three processors on —
`echoCancellation`, `noiseSuppression`, `autoGainControl` — and published
with livekit-client's defaults: Opus at 48 kbps with DTX. RESEARCH.md §12
recorded LiveKit's own advice to leave the browser's suppressor on.

Riders hear the result as processed: a voice with its air taken out, a fan
that comes and goes with every sentence, and a "breathing" between them. The
suppressor is a spectral gate tuned for a call centre; DTX turns the gate's
digital silence into comfort-noise transitions; and a transmit graph left at
the output device's rate resamples the mic twice on the way to the encoder.

WattRoom is "Discord for indoor cycling". The bar is a voice in the room, not
a phone line.

## Decision

**The voice is sent as captured, gated, and nothing else.**

- `noiseSuppression: false`. The gate (SPEC "Room audio defaults") is what
  keeps the fan out of the room between sentences; while a rider talks, the
  room hears the rider, fan and all.
- `echoCancellation` stays on. It is the only thing between a rider on
  speakers and the room hearing itself back, and it is transparent on
  headphones.
- `autoGainControl` stays on, for the reasons #555 recorded: the speaking
  ring, the ducking and every stored gate threshold are calibrated against
  it.
- The published track is Opus **mono, full-band, 96 kbps** (the SDK's
  `musicHighQuality` preset), **DTX off**, RED on. A rider's uplink has
  96 kbps to spare; a self-hosted LiveKit has no cap that needs raising.
- The transmit `AudioContext` is created at **48 kHz**, Opus's rate.

## Consequences

- Fan noise is audible under speech. That is the trade, and it is the one
  riders asked for. A rider whose fan drowns them has the gate threshold and
  push-to-talk, both already in the voice settings.
- Upstream is ~96 kbps per rider whenever the mic is open, gated or not.
  Trivial on any home uplink; noted here so nobody later "optimises" DTX
  back on without reading why it went.
- The upgrade path RESEARCH.md §12 named — an RNNoise/DTLN track processor
  on the local mic — stays open. If it is ever wanted, it is a rider-side
  choice behind the 95 % rule, not a default.
