# 0079 — Motion announces, the camera stays still — and one World control

- Status: accepted; settles [#3206](https://github.com/natrontech/wattroom/issues/3206)
- Date: 2026-09-29
- Beside: [0066](0066-the-world-is-the-ride-view.md) (the world is the ride view), [0072](0072-light-in-the-world.md) (light and flashes), [0064](0064-the-roadside.md) (the roadside's flash limit), [0005](0005-synthwave-visual-identity.md) (what glows)
- Decided by Jan, 2026-09-29: one per-device World control; reduced motion opens on Flat with a one-tap steady camera; no separate power-saving switch ([#3198](https://github.com/natrontech/wattroom/issues/3198))

## Context

There was no rule for motion, and four places gave four answers to one
question. ADR-0066's first draft fell back to the Skyline under reduced motion;
#3087 wanted a still world frame; the Ride Worlds synthesis kept the world with
reduced parameters; #3198 asked for a separate power-saving switch that stills
continuous motion.

Meanwhile the planned "juice" sat on the camera: a +10° FOV kick in 0.5 s in
the dev rig, speed lines, a six-second finish orbit. Those are the moves the
Xbox Accessibility Guidelines (XAG 117) ask games to avoid or make switchable,
and they land on a rider at 160 bpm, three metres from the screen, for an
hour.

## Decision

### The camera is a tripod on a rail

- **Damped follow only**: first order or critically damped, never
  underdamped.
- **No shake, bob, roll, overshoot, motion blur or speed lines** on a riding
  screen.
- **FOV at most +4°** over its base, easing with a **2 s half-life**.
- A shot change is a **cut** or a **300 ms fog-dip**.
- Cinematic moves only **before the start** and on **spectator-only** views.

### Juice goes on things, never on the screen

- **Juice goes on models** — flags, the crowd, bells, salutes, confetti thrown
  from spectators' hands — and on **HUD chips**. Never on the whole screen.
- **Live numbers snap.** Bars settle through `transform` over `--dur-live`.
  **Only results roll**, and only once.
- **One stage moment at a time**, through the moments queue
  ([#3210](https://github.com/natrontech/wattroom/issues/3210)). Every motion
  declares a cue and a hit time.
- **Honest motion**: a cue exists only where its model exists. No draft wake
  without draft physics.

### One World control

One **per-device** control, under Settings › Appearance › Advanced, answers
how much the world moves:

| Mode   | What it is                                           |
| ------ | ---------------------------------------------------- |
| Full   | the world as designed                                |
| Steady | the heli camera only, a fixed FOV, cuts, no particles |
| Light  | the lowest 3D tier                                   |
| Flat   | the Skyline                                          |

- **Reduced motion opens on Flat**, with one tap — "Show the world (steady
  camera)" — to Steady.
- **Reduced motion keeps every sound**; each motion becomes a held stamp.
- There is **no separate power-saving switch** (#3198): the 2D app's continuous
  motion keeps following the OS reduced-motion setting, as it does today.
- **Clean view (H)** stays a key, not a setting.

### The flash budget

- **WCAG 2.3.1** is the hard limit.
- At most **one luminance flash per 10 s** over **25 %** of a 10° field.
- **Never blink** `--color-z6`, `--color-z7`, `--color-danger` or
  `--color-watt`.

The numbers and the motion tokens are in docs/SPEC.md's "Motion" section;
the rules for everyday UI are in `.claude/rules/ux.md`'s Motion section.

## Consequences

- One question — how much should this move? — has one answer on every surface,
  and one place a rider changes it.
- The dev rig's +10° FOV kick, speed lines and finish orbit are gone from the
  riding screen; a finish orbit may run on a spectator view.
- Every new animation names its cue and its hit time, and goes through the
  moments queue if it takes the stage.
- Implementation: the motion vocabulary
  ([#3207](https://github.com/natrontech/wattroom/issues/3207)), the moments
  queue ([#3210](https://github.com/natrontech/wattroom/issues/3210)), the
  still world frame ([#3087](https://github.com/natrontech/wattroom/issues/3087)).
