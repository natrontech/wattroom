# 0093: A ride is the rider's, and it outlives the page and the voice channel

- Status: accepted
- Date: 2026-10-29
- Answers: [#4259](https://github.com/natrontech/wattroom/issues/4259)
- Amends: [0046](0046-one-riding-surface.md) (the riding surface is a place the rider opens), [0058](0058-the-room-dissolves-into-the-crew.md) (a voice channel holds no ride) and [0059](0059-a-voice-channel-rides-without-a-session.md) (the free ride's audience follows the rider)

## Context

Jan rode alone while in a crew on 2026-10-28, and every click into a channel asked "End the ride?". In his words: "it really shouldnt matter where i started it maybe its its own thing ... and while riding you can swap channels".

A ride has two owners today, and each one guards its own way out.

| Ride | Owner | Guard |
| --- | --- | --- |
| A workout or a road alone | `/ride`'s page component; `/ramp`'s for the ramp test | `lib/ride/leave-guard.svelte.ts` cancels every navigation off the page, because leaving unmounts the ride |
| A free ride, your own workout, a session | the voice channel's connection (`channelConnection`) | `lib/channel/ride-guard.svelte.ts` asks before another voice channel opens, because joining one hangs this one up and the trainer lets go |

The connection already outlives the page: a free ride keeps recording while the rider reads a text channel ([#2885](https://github.com/natrontech/wattroom/issues/2885)). The page's ride does not, and neither outlives a change of voice channel. Neither lets the rider browse the crew while riding.

## Decision

**A ride belongs to the rider, one per device, and the app shell owns it.** No route and no channel creates or ends it.

1. **One home.** `lib/ride/` holds the device's one ride above the router, in a module-level effect root, as `channelConnection` holds the call. It owns the trainer while the ride runs, the player, the recording and its crash buffer, the flags, the ride's sounds and the save. The player is a free ride (watts, grade or a road), a workout, or a workout on a road. The ramp test is a workout ([0046](0046-one-riding-surface.md)) and is the same ride. Between rides the trainer stays in the solo slot (`soloTrainer()`), as today.
2. **Only End ride ends it.** A workout's last block ends it as the ride-alone lifecycle says. A closed tab or a crash is covered by the crash buffer, as today. The browser's unload guard stays while a ride runs.
3. **Navigation never ends a ride.** Both navigation guards go. `/ride`, `/ramp` and a voice channel's Training page draw the ride when one runs, and its setup only when none does. A second Start is never offered while a ride runs.
4. **The riding screen is a place.** The frame is the ride ([0020](0020-the-app-takes-discords-shape.md), `data-ride`) while a riding screen is open, not while a ride exists. Off it, the frame is a desk frame and the sidebar shows the ride dock.
5. **The ride dock.** In the sidebar, above the You footer and below the call (`VoiceStrip`): the ride's time, its live watts in `--color-watt`, the block and its target when a workout drives, and **Open** and **End**. It names where the ride shows: the voice channel's name, or "Riding alone". Open returns to the riding screen the rider last had open. End is the riding screen's End: it saves and opens the closing card there. The dock carries the ride's critical status (the trainer lost, no crash safety) as persistent status with its one button, and replaces the frame's off-place `ChannelStatus` for a ride. On a phone the drawer holds the same dock, and the top bar carries its short form: time and watts, one 44 px tap that opens the riding screen.
6. **A voice channel is an audience, not an owner.** The ride sends its live numbers only on the connection of the voice channel the rider is in (`channelConnection.current`), and only while it is. That audience is [0059](0059-a-voice-channel-rides-without-a-session.md)'s: whoever has that channel open. With no connection the ride is private. Opening another voice channel moves the connection ([0058](0058-the-room-dissolves-into-the-crew.md): one at a time) and the audience with it; the ride and the trainer carry on unbroken. Leaving the call keeps the ride, private. Heart rate follows the sharing control ([0008](0008-heart-rate-retention.md), #2804) wherever the audience is. The workout's name and steps reach nobody, as [0059](0059-a-voice-channel-rides-without-a-session.md)'s #3340 amendment says. A ride never sends to a channel the rider did not open, and a text channel or another crew's page is no audience.
7. **A session is the one thing a ride joins.** Joining hands the trainer's targets to the session's timeline, which the hub owns ([0046](0046-one-riding-surface.md)'s difference 3). Leaving the session, or its end, hands them back to the player the ride had before, or a free ride, and the ride runs on. Your own workout beside a session stays a spectator of it (#3340).
8. **The mode changes mid-ride.** Change workout (#4257) swaps the workout, takes it off, or puts a road under it. The free ride's mode switch stays.
9. **One saved ride.** End saves the ride once, naming every workout it rode (#4257) and its road, under #4262's rule: a WattRoom road never goes up as a `routeId`.
10. **The world opens and closes with the riding screen.** Closing the riding screen mid-ride closes the world and frees its GPU. The ride keeps the picture's moments, so a world reopened mid-ride carries on from them, and the ride's start clears the picture, not the world's mount. The world draws the picture when it closes, from the whole ride's moments, and a later close replaces it. The closing card offers one picture per ride: the one from the last time the rider saw the world ([#4263](https://github.com/natrontech/wattroom/issues/4263)).

## Consequences

- `/ride`'s page and the voice channel's connection stop owning rides. The connection keeps the call, the socket and the session's shared state, and reads the ride to send its numbers.
- The privacy line in `$lib/privacy-copy` stays true as written: "While you ride in a voice channel, whoever has it open sees your live watts and cadence". A ride started alone now shows in a voice channel the rider opens after, as a free ride started there always did, and the dock says so.
- A session ride is still saved by the session's record. Until that record can take part of a ride, joining a session saves the ride's part before it (SPEC's "joining one saves the free ride first") and leaving starts a new part. The trainer, the screen and the dock never stop. This is the one place a ride is still cut in two, and one saved ride across a session is not in #4259's boxes.
- #4259 ships it in four code steps, each with one owner per ride at every commit: the ride lifted into the shell; the guards removed, with the e2e the issue names; the dock, with a design check; switching voice channels.
- WATTROOM.md's Room UX and Privacy rows get a dated divergence.

## Alternatives

- **Keep both owners and soften the guards.** A guard that asks less still ends the ride on a yes, and the rider still cannot read the crew mid-ride.
- **The ride stays the page's, and the page stays mounted under the others.** The world and the riding screen would render hidden on every page: the GPU and CPU cost of [docs/PERFORMANCE.md](../PERFORMANCE.md) paid for nothing on screen.
- **The voice channel owns every ride, `/ride` included.** A rider alone would need a channel to ride in, and switching channels would still end the ride.
