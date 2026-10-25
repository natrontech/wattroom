# 0089 — One rider, one voice: a second device is a controller

- Status: accepted
- Date: 2026-10-25
- Answers: [#4164](https://github.com/natrontech/wattroom/issues/4164)
- Amends: [0058](0058-the-room-dissolves-into-the-crew.md) (who is in a voice channel) and [0025](0025-one-sensor-one-screen.md) (the claim gains a kind)

## Context

Jan rode a crew session on his Mac, holding the trainer and in voice, and opened the same channel on his iPhone to use it as a remote (#3217). The phone could join voice too. LiveKit gives every tab its own participant, and the client's only arbitration was newest-wins between tabs (`av-claim.svelte.ts`): the phone took the mic from the Mac, played the call out of a second speaker beside the first, and the Mac's Talk had nothing left to open. In his words, it must be "device aware, and when doubling then not possible, or switching around".

[0025](0025-one-sensor-one-screen.md) already solved the same shape for the trainer: per rider, per kind, one holding screen, first claim wins, the answer addressed to that rider only. Its #1853 amendment showed that half a claim is a bug: the screen without the grant must also stop acting.

## Decision

**A rider is one presence in a voice channel, however many devices they open.** One of their screens carries voice and camera; every other screen of theirs that opens the same channel, or its session, is a **controller**.

- **Voice is a claim, kind `voice`**, held the way [0025](0025-one-sensor-one-screen.md) holds a sensor: per rider, per channel, keyed by tab, released when the holding tab leaves voice or its last socket closes. A screen claims before it asks for a call token, so a refused screen never joins the call.
- **First claim wins.** The screen that joined voice first carries it; on a ride that is the one holding the trainer, since it was in voice to ride. A second claim is refused with `voice_conflict`, and the client turns that refusal into the controller view.
- **A controller has no microphone, no camera and no audio out.** It does not join the call at all, so there is never a second participant or an echo. It keeps the socket, the session's view and the phone remote ([#3217](https://github.com/natrontech/wattroom/issues/3217)).
- **Switching is one tap, from either screen.** "Use this device for voice" claims with `take`: the hub moves the claim, the screen that had it leaves the call, and the tapping screen joins. Doubling is never possible, and switching is never more than that tap.
- **The answer stays off the tick**, in `SensorPairing`: `held` names `voice` on the carrying tab and `elsewhere.voice` names its device word everywhere else. Who carries a rider's voice is nobody else's business.

## Consequences

- The newest-wins hand-off between tabs (`av-claim.svelte.ts`) becomes a fallback for an older client that never claims. Two current clients cannot both reach the call.
- An older client on a second device still joins as it did, so a rollback, or a mixed fleet, doubles as before and breaks nothing new. The protocol fields are optional.
- The claim is channel-scoped, as [0025](0025-one-sensor-one-screen.md)'s is. A phone in another voice channel of the crew is in another call, which [0058](0058-the-room-dissolves-into-the-crew.md) already lets one rider leave by joining the next.
- A carrying screen whose socket dies keeps the claim until the hub reaps the socket: seconds. Its reload reclaims by tab and is granted.
- WATTROOM.md's phone-as-spectator stays: the controller is a spectator that can also press the remote.

## Alternatives

- **Newest wins, as the mic did.** A phone that just woke up would take the call from the screen being ridden, which is the steal [0025](0025-one-sensor-one-screen.md) ruled out for the trainer.
- **Both join, the second muted.** A muted participant still plays the call out of its speaker: the echo stays.
- **Refuse at the token endpoint.** The hub learns who is in the call from LiveKit's webhooks, seconds late, so two devices joining together would both pass. The socket answers first.
