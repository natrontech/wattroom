# ADR-0010: Room-first — WattRoom replaces the voice app, not just the trainer app

Date: 2026-08-30 · Status: accepted (#150), amended 2026-09-22 by
[ADR-0058](0058-the-room-dissolves-into-the-crew.md) (#2425): the place you idle in is a voice channel;
amended 2026-09-24 (#2702): a click on a voice channel in the sidebar joins it

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

## Amendment — the place you idle in is a voice channel (2026-09-22, #2425, [ADR-0058](0058-the-room-dissolves-into-the-crew.md))

The room dissolves into the crew. What this ADR called _the room_ — the place
you idle in, with voice as its default state — is a crew's **voice channel**;
the crew's conversation is its **text channels**. The decisions carry over with
the noun changed, and none of them loosens:

1. Voice is what a voice channel is for, and entering one still connects
   nothing — the #681 amendment above stands word for word, with _voice
   channel_ for _room_.
2. The sidebar is still the crew's radar: who is in which voice channel, what
   session is running where, and unread per text channel (#2444).
3. The bounded log of the #201 amendment is per **text channel**, at
   docs/SPEC.md's bound; a voice channel has no text of its own.
4. Unchanged.

## Amendment — a click on a voice channel joins it (2026-09-24, #2702)

The #681 amendment made joining explicit, and the explicit act was a second
click: open the channel, then press *Join voice*. Riders read the first click
as the decision — it is Discord's shape, and ADR-0020 put the app in it — so
the second was a chore rather than a safeguard. The safeguard #681 exists for
is that nobody lands on a hot mic by **arriving**; a rider who clicked the
channel's name in the sidebar did not arrive, they chose.

- **The sidebar row is the tap.** A plain click on a voice channel in the
  crew's column joins its voice, with the mic on (a handheld joins listening,
  #2142). Clicking the channel you already stand in joins it too.
- **Every other arrival still connects nothing**: a link, a bookmark, a typed
  address, a toast or notification, the session line under a channel (#2450),
  the return after a session ends (#2665), the row's context-menu *Open*, and
  a new-tab click. A reload is still the 60 s rejoin and nothing more. The
  click leaves a one-shot note in memory (`web/src/lib/channel/voice-intent.ts`)
  that the channel's page takes on mount and that goes stale in **10 s**, so a
  click whose page never mounted joins nothing later.
- **A switch carries the call.** Clicking another voice channel while in voice
  arrives with the mic as it was — muted stays muted — and with a camera that
  was **live** still live. A camera that was off stays off. This is a capture
  continuing, not one restoring: "the camera never auto-restores" above still
  holds, because a shut device is never opened.
- **Who is in a channel, spelled out.** An arrow beside a voice channel's row
  lists everyone in it, one per line. One channel is open at a time, which is
  what answers the reason the line of names was chosen (#438): a list per
  busy channel would multiply the column's height, one list adds one. The
  arrow never joins voice. Which channel was open is not remembered across a
  reload — the line of names is the resting state.

Point 1 of the ADR-0058 amendment below reads with this exception.
