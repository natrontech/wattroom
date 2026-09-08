# 0041 — The HUD mirrors the riding screen, and floats only while WattRoom is behind

- Status: accepted
- Date: 2026-09-08
- Constrained by: [0025](0025-one-sensor-one-screen.md) — one sensor, one screen — and WATTROOM.md's YouTube RMF rule that nothing is ever overlaid on the player
- Extends: [0037](0037-a-desktop-shell-for-what-the-browser-cannot-reach.md) — the shell's bridge grows one key
- Answers: the HUD box of [#296](https://github.com/natrontech/wattroom/issues/296)

## Context

#296 asked for a frameless, always-on-top window with the rider's watts,
target and time — for the rider who alt-tabbed to a film mid-interval — and
stopped on one question: where does a second window get live watts? In a
solo ride the trainer belongs to the ride window and nothing else can see it.
In a room, a second connection is a second claim on the same sensor, which
ADR-0025 exists to refuse. And WATTROOM.md forbids a HUD over the jukebox's
player: YouTube's terms, not ours.

## Decision

**The HUD is a mirror, fed over a `BroadcastChannel`.** The riding screen —
`RidingScreen` for a solo ride, the room's training page for a room — publishes
the rider's own watts, target, seconds left and a label once a second on the
same-origin channel `wattroom.hud`. `/hud` subscribes and draws them, and
says _waiting for a ride_ after two missed ticks. It reads no sensor, joins no
room, and holds no claim: ADR-0025 is untouched because there is still one
screen holding the trainer. It works in a plain browser with two tabs, which
was the question that settled the choice.

**The shell opens it when a ride starts and closes it when the ride ends**,
driven by the layout's own "riding" derivation through one new bridge key,
`window.wattroom.hud(on)`. No toggle: the 95 % rule says a rider who leaves
the window mid-interval wants the numbers to follow. The HUD's own close
button sends `hud(false)`, and it stays closed until the next ride starts.

**It floats only while WattRoom is not the front window.** The main window's
focus hides it and blur shows it. In front, the riding screen has the numbers
and a HUD would only cover them — or the player. That one rule keeps the RMF
constraint honest without a second layout.

## Consequences

- The HUD is a route, so it ships with the web app; the shell only decides
  when a window exists and when it is visible.
- A browser tab at `/hud` beside the riding tab is a free second screen on a
  second monitor. Nothing was built for that; it falls out.
- The feed carries four numbers and a label. Anything richer — cadence bands,
  the interval graph — is a widening of the same channel, not a new mechanism.
