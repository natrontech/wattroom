# ADR-0010: Room-first — WattRoom replaces the voice app, not just the trainer app

Date: 2026-08-30 · Status: accepted (#150)

## Context

WATTROOM.md frames the product as "Discord for indoor cycling": a training
app that borrows Discord's shape. The 2026-08-30 issue wave (#146–#152)
makes a stronger claim — the crew will reach for WattRoom *instead of*
Discord/TeamSpeak, so nobody keeps a second app open on ride night.

Those are different products at the edges. "Discord *for* cycling" means
the room exists to host sessions; between sessions it can be dead. "Instead
of Discord" means the room is a place you idle in: voice is the default
state, presence matters when nobody is pedalling, and the social surface
(chat, friends, pings) has to stand on its own.

Every issue in the wave argues from one of these premises. Without deciding,
each gets litigated separately.

## Decision

**Room-first, ride-night-scoped.** WattRoom aims to be the only app open on
ride night — before, during, and after the session — but does not chase
all-day ambient presence in the alpha:

1. **Voice is the room's default state**, not a session feature. Joining a
   room offers voice immediately (it already does); the quality bar is
   Discord's (#151 state, #152 tuning).
2. **The sidebar is the crew's radar** (#149): who's in voice, what's live,
   what's planned — visible without entering a room.
3. **Text chat is ephemeral and room-scoped** (#146): warm-up/cool-down and
   spectator talk, cleared with the session's natural rhythm — consistent
   with "AV is never recorded". Durable chat is out; that's where Discord
   genuinely stays better, on purpose.
4. **Friends/global presence (#147) stays deferred** until the crew
   outgrows one room. It is the first feature with presence outside a room
   and needs its own privacy ADR when it comes; nothing in 1–3 depends on
   it.

Not skinning: ADR-0005's identity stays; two accents, glow for live data
only.

## Consequences

- #149 (sidebar) and #146 (ephemeral chat) become buildable without
  re-arguing premises; #147 stays parked with a named unblock condition.
- The bar for voice reliability rises to "primary channel": regressions in
  join/ducking/state are launch-blockers, not polish.
- WATTROOM.md's one-line positioning gains the qualifier "the only app open
  on ride night" — an edit, not a rewrite.

## Rejected

- **Full Discord replacement** (all-day idle presence, DMs, servers-of-rooms):
  a different product with different infrastructure economics; revisit only
  if riders ask for it unprompted.
- **Training-app-only** (voice as accessory): contradicts how the crew
  already behaves — the wave exists because voice IS the draw.

## Amendment — chat keeps a bounded history (2026-08-31, #201)

"Ephemeral means ephemeral" lasted one day of real use: a rider who steps
away mid-evening comes back to an empty panel, and a reaction has nothing
to attach to. Chat becomes a **bounded room log**:

- The last **500 messages per room** persist; older ones are pruned on
  write. The room's deletion takes its chat with it, and a deleted account
  takes its messages (both cascade).
- Joining a room loads the backlog; the live path still rides the tick.
- Messages gain identity, which is what reactions attach to — the room's
  six-emoji vocabulary, one toggle per rider per emoji per message.
- Still room-scoped, still never leaves the room, still no cross-room
  surface. What changed is duration, not visibility.

## Amendment — voice is one tap away, not on by default (2026-09-05, #681)

Decision 1 says "joining a room offers voice immediately". What shipped, and
what two audits independently judged the better product, is narrower:
**entering a room never connects you to voice.** The room is the default
place, voice its primary channel — but the channel opens on a tap, never on
arrival. A hot mic and a live camera the moment you open a door is exactly
what people refuse.

The rule, so nobody rebuilds auto-connect from the founding line:

- **Joining is explicit.** The sidebar's *Join voice* button (or the rail's
  "voice is busy" link, which lands you in the channel because the rider
  clicked something that said so — #251) is the way in. Nothing joins on
  route change, on account load or on the roster changing.
- **A refresh is not a leave.** A tab that was in voice walks straight back
  in if it reloads within **60 s** of its last heartbeat
  (`REJOIN_WINDOW_MS`, `web/src/lib/room/rejoin.ts`, #480), with the mic
  exactly as the rider left it — muted comes back muted. Hanging up tears
  the note up, so leave-then-reload stays out; a mic held by another tab
  vetoes the rejoin (#293: one microphone on the machine, and it is in use).
- **The camera never auto-restores.** Not on rejoin, not on anything. A
  capture device that was shut stays shut until the rider opens it.

The numbers live in [SPEC.md](../SPEC.md) "Room audio defaults" beside the
gate figures; this file records why. WATTROOM.md still reads "always-on" —
ADR-0001 locks that document and #656 is deciding how a founding line
records a divergence, so the pitch changes there in whatever form #656
concludes. Until then this amendment is the canonical statement.
