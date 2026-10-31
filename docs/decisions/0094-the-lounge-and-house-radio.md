# 0094 — The lounge: a pixel room and house radio in an idle voice channel

- Status: accepted
- Date: 2026-10-31
- Answers: [#4296](https://github.com/natrontech/wattroom/issues/4296)
- Extends: [0058](0058-the-room-dissolves-into-the-crew.md) (a voice channel is a place to hang out), [0015](0015-self-hosted-music-pool.md) (a third source on the deck), [0064](0064-the-roadside.md) (its verbs, off the road)
- Beside: [0092](0092-the-world-draws-flat.md) (the world's look; this is a picture beside it), [0093](0093-a-ride-is-the-riders.md) (a ride's audience is the voice channel)
- Decided by Dave, 2026-10-31: build it, with generated music first and curated music later.

## Context

ADR-0058 made a voice channel the place a crew spends its evenings, mostly in voice with the jukebox on. Off the bike the page has little to look at: the tiles, the deck and the chat. Riders who stay in the call while they work or study want what a lofi stream gives them (Lofi Girl, Anthropic's Claude FM): steady music and a calm, slowly moving picture.

Two of those parts are fixed by things outside WattRoom:

- **YouTube streams can't drive anything.** The player is a cross-origin iframe, so the page never hears it, and RMF forbids anything over the tile or any audio-only play (WATTROOM.md, Jukebox). A YouTube lofi stream can play on the deck today, and it stays exactly that.
- **Shipping music means licensing it.** Uploaded library tracks are the uploader's and their crew's (ADR-0015). Music the instance ships itself needs a license for every track, and "royalty free" libraries are often unclear about audio shipped inside an app.

The parts the app needs already exist: the hub's jukebox playhead on server time, library tracks that play audio-only with a BPM tag, decoded waveform peaks (#1425), presence and away reasons on the tick, and a free rider's live numbers in the channel (ADR-0059, ADR-0093).

## Decision

### The scene

A voice channel's page shows **the lounge** while no session runs there: a pixel-art room of 320 × 180 pixels.

- **It is a picture**, like the world, a camera frame or a video, not chrome (TARGETS G1). It has its own palette, a token family next to the world's, which may hold hues beyond the two accents. `--color-watt` appears in it only on a live number, and nothing in it glows except that number.
- **Drawn sharp**: scaled by a whole number with nearest-neighbour sampling, never stretched by a fraction. This keeps ADR-0092's rule against detail finer than a CSS pixel.
- **Paced and paused**: 15 fps, one canvas, stopped when a session starts in the channel, the tab is hidden or the page is left. It has a `/dev/perf` case and a `make perf` measurement before it ships.
- **What it shows**, all of it already known to everyone in the call:
  - The sofa holds everyone in the voice channel. Speaking shows as a note over the head, and an away rider leaves an object for the reason.
  - The bike holds a rider in the call who is riding. They pedal at their real cadence, with their live watts above them.
  - The record player is the deck: it turns while something plays, and a click opens the jukebox.
  - The window follows the viewer's own time of day.
- **Motion goes on things** (ADR-0079): the platter, the speaker cone, the sign, the cat. The camera never moves. Reduced motion holds one frame and keeps every sound.

### Its verbs

The lounge's verbs follow ADR-0064's rule: they paint, sound and inform, and never reach a ride. The lamp and the weather are **shared**: one rider flips them for everyone, as ephemeral voice channel state on the tick, kept nowhere (ADR-0022). Poking the cat and cheering a crewmate are local and quiet, as fire-and-forget taps are (errors.md).

### House radio

When the deck is empty, the lounge plays **house radio**: lofi generated in the browser.

- **One tune per 150 s slot**, derived from the crew id and the slot number: key, tempo (72–88 BPM), a progression of seventh and ninth chords, drum pattern, swing and a two-bar melody. It runs intro, groove, melody, breakdown and outro.
- **Placed on server time**, the clock the jukebox already chases, so every rider in the channel hears the same bar. Nothing crosses the wire and nothing is stored.
- **One more music source**: it plays through the mixer's music fader, ducks under voices, and stops when anything is queued. It is not a queue entry and is never logged in `track_plays`.
- **Synthesized only**: no samples and no third-party audio, so it needs no license.

The scene moves on the beat of whatever plays: house radio's own clock, or a library track's BPM tag and peaks on the shared playhead. A YouTube entry gives it no beat. The scene then idles beside the tile and never covers it.

## Amended 2026-10-31 (#4296)

Decided by Dave while the first version was built: house radio is **queued like a track**, and each rider can opt out.

- It is a jukebox entry (`radio` on the entry and the add command), queued from the jukebox's add row or from the lounge, and it holds the deck until someone skips it or queues something behind it and skips. It still never reaches `track_plays` or the just-played list.
- Each rider mutes it for their own device under the lounge picture; it stays on the deck for everyone else. A device that opted out builds no audio for it.
- It plays on every page of the voice channel, as a library track does, and the YouTube player ignores it.
- The record player's click queues house radio on an empty deck, in place of opening the jukebox.

"When the deck is empty, the lounge plays house radio", "stops when anything is queued" and "It is not a queue entry" above are superseded.

## Consequences

- An idle voice channel gets music and something to look at without a new service, new storage or a new sound license. The only protocol change is the shared lamp and weather.
- Generated music has a lower ceiling than music people made. **Revisit trigger**: riders turn the music fader down in idle channels, or ask for real music. The next step is then a curated house library of CC0 tracks with each license on file (HoliznaCC0's archive is the candidate), played through the same deck path as library tracks.
- Pixel art is a second visual language beside the flat low-poly world. It stays inside the lounge picture: no pixel art in chrome, on riding surfaces or in the world.
- The idle voice channel on a TV is still #3091's road flyover. Whether the lounge takes that slot is a later decision.
- WattRoom now designs for riders in the call who are off the bike.
