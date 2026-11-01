# Spec: Riding

Part of the product spec. [docs/SPEC.md](../SPEC.md) indexes every section and says which values change without an ADR.

## Ride guards

Numbers moved here from code after being ridden (#46). The cadence path was validated on a
Kickr Core on 2026-08-29: deliberate grind tripped the guard at 37 rpm under a held target,
the target released for 9.6 s (one tick under the 10 s window), and re-engaged at 158 W
once cadence recovered to 82 rpm. No false trips across any prior hardware session.

**Auto-pause** — the rider stopped, so their targets stop (clock does not rewind):

| Parameter                         | Value                                                                         |
| --------------------------------- | ----------------------------------------------------------------------------- |
| Stopped = cadence below           | 5 rpm                                                                         |
| …AND power below                  | 20 W (cadence alone unsafe — some trainers report none)                       |
| Pause after                       | 3 s stopped                                                                   |
| Resume countdown                  | 3 s (resuming must not be a jump-scare)                                       |
| Stopped this long → the ride ends | 10 min paused (default — tune in alpha), solo ride and ramp test only (#2622) |

**Pause** (#3217): a rider alone can pause from the phone remote. It stops the ride
clock, the score and the recorder's workout second, and releases the trainer target to
the flat road above, like an auto-pause that pedalling does not end. Resume counts back
in for 3 s and continues where the ride stopped. A paused ride ends itself after the same
10 min. A session is never paused by one rider: the remote shows Pause and Resume on a solo
ride only.

A solo ride that ends itself this way drops its trailing stopped run before it is saved or
exported: the rider had gone, and those seconds are not in its duration, normalised power or
`.fit`. A session is its coach's to end, so this never ends one.

**Spiral-of-death guard** — ERG piles on resistance as cadence dies; the guard breaks the loop:

| Parameter                    | Value                                           |
| ---------------------------- | ----------------------------------------------- |
| Trip: cadence below          | 50 rpm while an ERG target is held              |
| …for                         | 5 consecutive seconds                           |
| Fallback (no cadence source) | power below 50 % of target, same 5 s            |
| Release duration             | 10 s of no target, then re-engage automatically |

The power-collapse fallback is unit-tested but has never run on hardware: every trainer on
the team reports cadence (ADR-0007), so the cadence branch always wins. It stays for any
future trainer that reports none.

**No target is a flat road** (#2658): a release, auto-pause, and a voice channel with no session
running (before it, its count-in, between sessions) put the trainer in slope at 0 %, never
ERG 0 W — zero in ERG is a freewheel, and a
rider pedalling through a release felt nothing under their legs. Stop and leaving still write
ERG 0 W: nobody is riding the trainer then.

## Virtual gears (defaults — tune in alpha; ADR-0084)

When the ride is in SIM (a road, a race, the free ride's grade, a sprint slope), the rider shifts virtual gears with one pair of controls, **Easier** and **Harder**. A virtual gear multiplies whatever real gear is on the bike.

Every number below is a **default**, to be tuned in alpha from riders' reports, unless it is marked _physics_ (not tunable) or _rule_ (a hard constraint from ADR-0084). What the trainer does with them comes from published sources and the #10 Kickr Core's own samples (RESEARCH.md §11, "The road and gears numbers"; #3351, ADR-0088).

**The gear table**

- **Gears (default).** 24 gears, geometric from ratio **0.72** to **5.30**, one step = (5.30/0.72)^(1/23) ≈ **9.07 %**. The code computes the ratios; the display rounds them to 0.72 0.79 0.86 0.93 1.02 1.11 1.21 1.32 1.44 1.57 1.72 1.87 2.04 2.23 2.43 2.65 2.89 3.15 3.43 3.75 4.09 4.46 4.86 5.30.
- **Start (default).** Every ride starts at k = **1**, the rider's real gear and today's resistance. A Cog on 34×14 is gear 15.
- **A shift (default).** It goes to the table neighbour of the gear shown, so from a real ratio between two table gears the first step is between half a step and one and a half (**4.4–13.6 %**). With no real ratio known, k steps by **×1.0907**, bounded to **0.30 … 2.2**, and the gear shows as **±n**.

**Real gears**

- **Real ratio (default).** The median of trainer speed ÷ (cadence × **2.096 m**, a 700×23c wheel) over the last **9** samples at **60–110 rpm**.
  - A real shift is when that median sits **≥ 5 %** from the current ratio on **3** consecutive samples. k stays, and the gear shown re-anchors.
  - In the lab: no false re-labels in 10 h at 2.4 % per-sample noise or over the #10 Kickr Core's own samples, and a 42×14 → 42×17 move re-labels within 7 s.
  - The window is 9 by the hardware checklist's rule (P1: over 2 % per-sample noise, 9 samples), since the #10 Kickr Core's noise is **2.4 %**. Its cadence is estimated from the flywheel, and it lags after a sprint.
  - A Kickr reports speed at the circumference an app sent it with 0x12, and WattRoom sends none. A road wheel another app set (700×23–32c, 2096–2155 mm) reads within 3 % of the teeth ratio.
  - If the ratio moves with grade (a trainer that reports modelled speed), detection is off and the gear shows as ±n.
- **Who reads the trainer's speed (rule).** Only the drivetrain does. The dot, timing and the bike computer's speed never do.

**What goes to the trainer**

- **The transform (physics).** k = virtual ratio ÷ real ratio.
  - sin θ' = k · (m/m_t) · sin θ_felt
  - Crr' · cos θ' = k · (m/m_t) · Crr · cos θ_felt
  - Cw' = k³ · Cw · (1 − shelter)
  - wind' = wind ÷ k

  The base values are the trainer's road from "Route rides": Crr **0.004** and Cw **0.39 kg/m**, ρ·CdA. m/m_t is **1**: FTMS carries no mass, and a Kickr simulates the weight its maker's app gave it, so m_t is no constant WattRoom can know. #3332 closed on that: SIM does not scale by the rider's weight.

- **Input (rule).** A road's grade goes through the route-rides felt rule (#3020). A slope the rider set by hand (the free ride) and a sprint slope are felt as given.
- **Shelter (rule).** Cw carries (1 − shelter) only while "Feel the draft" is on (ADR-0077). The dot always gets the hub's shelter.
- **Write range (default + rule).** The grade written stays within **MinTrainerGrade (−10 %, the Kickr Core 2's published floor)** … **MaxTrainerGrade (+15 %, #3020)**. Both live in protocol/limits.go and are the same for every trainer. A Cw above **2.55 kg/m** (the UINT8 field) folds into grade at the last flywheel speed: its excess force, ½ × (Cw − 2.55) × v², over the reference rider's **83 kg**.
- **At the limit (default).** After **3 s** clamped, one persistent status line shows. It goes after **3 s** clear.
  - "Your trainer is at its limit in this gear — shift easier."
  - At the ceiling with a cassette: "Your trainer is at its limit in this gear — shift easier, or move your chain to a smaller cog."
- **Writes (rule).**
  - A shift writes one FTMS 0x11 at once, through the trainer queue, where a newer write supersedes a queued one.
  - A shift carries the current shelter. It is exempt from the felt-grade slew (1 %/s) and from the drafting Cw spacing.
  - A shift never changes mode, and nothing is written between the old gear and the new one.
  - Terrain writes happen when the composed bytes change.
  - Entering SIM from ERG writes 0 % for **500 ms** first. That is the only write that is not the target road. A shift inside it moves k only, and the timed write reads the gear when it fires.
  - A reconnect re-issues the current state, recomputed.
  - WattRoom never sends a pulse (ADR-0084 defines one).

**The shifter (default)**

- Debounce: **40 ms** per input source.
- Rate: at most one shift per **100 ms**. Up to **3** more presses queue, and opposite presses cancel out.
- Hold: a held control repeats after **400 ms**, then every **200 ms**.
- Ends: nothing moves, and one `block` cue plays per press. A held repeat plays none.
- A source that disconnects releases whatever it held. A window that loses focus releases every held key.
- There is no auto-shift, no countdown and no easing between gears (rule).

**Controls and feedback**

- **Easier / Harder (rule: Jan, 2026-09-28).**
  - In SIM: a gear.
  - In an ERG workout: bias **±1 %**, within **0.8–1.2** (#795).
  - In the free ride's watts mode: **±10 W**.
  - Anywhere else: disabled, with a one-line hint.
- **Grade mode (default; amends ADR-0059).** The grade pair (**0.5 %** steps, as today) and Easier / Harder sit in slot 1's control row, each `btn-lg`; the number the grade pair moves is slot 1's trainer chip, and the gear has one home, the RIDE page (TARGETS D17; #3669 settled the earlier "gear between them"). On a road the pair is Easier / Harder only.
- **Announce (default).**
  - `shift-up` and `shift-down` cues on the cues bus: two short ticks, rising or falling.
  - The gear field reads "Gear 15", or "+3" when no real ratio is known.
  - It is neon, never the watt accent, and never glows. It pulses once on a change, not at all under `prefers-reduced-motion`, and is aria-live polite.
- **Keys (default).**
  - Harder: `.` `+` `=` Numpad+. Easier: `,` `-` Numpad−. PgUp / PgDn are Harder / Easier.
  - No soundboard pad takes `.` `,` `+` `-` or `=` (rule, #3333): binding one is refused with "+ shifts gears while you ride. Pick another key." A pad bound to one before gears keeps it and fires on it outside a ride.
  - Ride keys (#3216): **1-4** camera (Chase, Heli, Side, Steady; in the world only), **H** clean view (3 s power, road line and Skyline; per device; the status stays while the trainer signal is lost), **M** the computer's MAP page (a hint where there is no road) and **O** snap (a hint until it exists), **?** the key sheet. Never Space, arrows or a key a soundboard pad is bound to; not while typing.
  - No modifier key. `event.repeat` is ignored, because the shifter does the repeating. Keydown and keyup are press and release.
- **The ride narrator (default, #3213; WCAG 4.1.3).** An sr-only `role=status` region says a block change, a climb opening (class, length, average grade), "N km to the top" at each whole kilometre left, and the summit, at most one line per **5 s**; a newer line replaces a waiting one. `role=alert` says the trainer signal lost (back is a polite line) and the **S** key: "km 12.4 of 51.7, 5.8 %, 6.0 km to the top, 258 W, zone 3" (on a road; not while typing, not with a modifier, and not when a soundboard pad is bound to S). Climbs are named by class; a climb's name waits for the privacy rule on place names (ADR-0063).
- **Phone (default).** Taps only, as a full-width pair. Each tap is answered with the gear, and whether it is at an end.
- **OpenBikeControl (default, #3335).** A "Shifter" card beside the sensors pairs a controller over Web Bluetooth. Shift Up and Increase Difficulty are Harder, Shift Down and Decrease Difficulty are Easier, held like a key (one press when a button sends both). Push to Talk is held; Camera View steps through 1-4; HUD Toggle, Map Toggle and Screenshot are H, M and O; Left and Right turn the computer's pages. WattRoom sends the controller exactly these IDs as App Information, without Gear Set: a gear moves to its table neighbour only. A shift buzzes once, an end twice (the warning pattern). A lost link lets go of every held button.
- **The trainer grant moves (default).** When another of the rider's screens takes the trainer, k restarts at 1 with a cue and "Gear back to your real gear". A reconnect keeps k.

**What the gear never touches (rule)**

- Reported watts are never multiplied by k.
- The pace model, timing, XP and the tick take no gear.
- The gear stays on the rider's device and is not stored with the ride.

**Fallbacks**

- **ERG-by-gear (default; only for a trainer without usable SIM).**
  - Target = (felt road force at speed k·v) × k·v, where v is the trainer's own speed.
  - Floor **50 W**. Never ERG 0 W (#2658).
  - Ceiling: the trainer's Supported Power Range (0x2AD8).
- **Don't make me shift (default).** The singleSpeed setting, renamed. Wherever SIM would put the rider on a slope, ERG-by-road holds FTP × clamp(0.60 + 0.03 × grade %, 0.50, 0.90), ± bias (#3025). Rides on it are stored but untimeable (rule: Jan, 2026-09-28; ADR-0074's who-chose-the-watts rule, since WattRoom chose the watts). A rider who had it on before gears keeps it, and the free ride says "Virtual gears are here: pick Grade to shift." once per device (#3333).

## The bike computer (defaults — tune in alpha; ADR-0071)

Slot 3's pages, in order: **RIDE** (default, and where every ride starts),
**CLIMB** (opens by itself from RIDE when a climb begins on a free or route
ride; a workout or a session keeps RIDE and offers it, [#3645](https://github.com/natrontech/wattroom/issues/3645)), **POWER**, **MAP**
(on a road only: the road from above as its turns draw it, climbs in the grade ramp, your dot; no north, no coordinates and no names, the tier a crew is sent, ADR-0063), **RACE** (later). ← / → or a tap on the panel turn them;
PgUp / PgDn are Harder / Easier, never a page.

**Legibility**, at the design distance — desk: **0.8 m** from a **14-inch**
laptop; TV: **3 m** from a **55-inch** set:

| Text              | At least      | TV       | Desk      | HUD      |
| ----------------- | ------------- | -------- | --------- | -------- |
| Watts             | **45 arcmin** | **12vh** | **76 px** | **12vh** |
| Time left         | **45 arcmin** | **9vh**  | **52 px** | **9vh**  |
| Secondary numbers | **22 arcmin** | **5vh**  | **24 px** | **5vh**  |
| "Next", words     | **16 arcmin** | **3vh**  | **14 px** | **3vh**  |
| Labels            | **16 arcmin** | **3vh**  | **11 px** | **3vh**  |

The desk column is the v2 mocks' proportions, under the arcmin floors (Jan,
2026-10-18, ADR-0087): a rider
who rides from further back uses TV mode.

**A phone** (below **768 px**, [#3676](https://github.com/natrontech/wattroom/issues/3676))
has its own design distance: **0.45 m**, a phone on the stem or in the hand,
at **0.156 mm** a CSS pixel and a cap height of **0.72 em**. That puts the
floors, as font sizes, at **52 px** for watts and time left (45 arcmin), **26 px** for
secondary numbers (22 arcmin) and **19 px** for words (16 arcmin). The phone
ships, as font sizes, watts at **104 px**, time left at **72 px**, secondary numbers at
**36 px** and words at **20 px** or more, since a full-width panel holds them. The watts stay the largest number on the screen and time
left the second.

Nothing on the TV is smaller than **2.9vh**. **The HUD's design distance**
is a **second screen 1.3 m away, a 24-inch monitor**, the `/hud` tab of
ADR-0041. A screen
height subtends the same angle there as a 55-inch TV does at 3 m, so a vh
reads the same, and the HUD takes the TV's column. It holds that in any
landscape window. The shell's own **320 × 152** window is the floor the block
never shrinks below ([#3678](https://github.com/natrontech/wattroom/issues/3678); 132 until the zone strip, [#4099](https://github.com/natrontech/wattroom/issues/4099)). Panels are at least **85 %**
opaque; a unit is at most half its number's size. The big watts figure is a
**3 s** average; scoring still reads every second.

## The ride's pictures (defaults — tune in alpha; [#4221](https://github.com/natrontech/wattroom/issues/4221), [#4263](https://github.com/natrontech/wattroom/issues/4263))

A closing card offers two pictures for Strava, and the rider saves either or both: the **poster**, drawn by the server from the saved ride, and the **world's**, drawn where the 3D world drew.

- The world draws its one picture as it closes, at the ride's best moment once it has moved for **30 s**: the highest summit crossed, **20 m** below its top; else the highest hairpin ridden through; else the steepest **100 m** ridden. The world is keyed by place (ADR-0081), so that metre is drawn again, in the light it was ridden in, with you alone on the road. While it draws, the closing card holds the button's place with “Drawing…”.
- The rider takes it when they choose, with the phone remote's **Photo**, the **O** key or a controller's snap button ([#4253](https://github.com/natrontech/wattroom/issues/4253)). The latest moment they took is the one drawn, in place of the best one.
- It is drawn off-screen at **1080 × 1350**, Strava's portrait, at one pixel per pixel; the live canvas is untouched.
- It has its own camera: **0.9 m** over the road, **5.8 m** from you up the road at a front three-quarter (**35°** or **60°** off your heading, on either side), a **40°** field of view. Of those four stands, uphill side first, it keeps the one whose frame's top sees the most sky past you rather than the slope. You stand on the third that leaves room ahead of you, about two fifths of the frame's height from the tyres to the helmet, and halfway between them **62 %** down the frame. The lens stands on the carriageway or its shoulder, where no dressing grows, so nothing stands between it and you.
- Its sky is the ride's at that light. Its peach band lies level across the frame, over the land the frame sees as well as the far ranges: at a summit or a hairpin the hillside past you often stands over the ranges, and the band clears it as it clears them. Land out of the frame, within **200 m** of the lens, or standing over **14.5°** lifts it nowhere, and hides it where it stands ([#4278](https://github.com/natrontech/wattroom/issues/4278)).
- Nothing painted is drawn in it: riders' name tags, signs and arches with their places, chalk, gates and the zone digit. No rider, crew or place name; the world's look only (ADR-0063).
- A JPEG at quality **0.9**, kept in the tab's memory only: never uploaded, never stored. A new ride lets the last one's go. It saves through the share sheet on a phone and as a download on a desk, as the poster does.

## Sync tolerances

- Metrics latency budget: pedal → every screen **< 500 ms**.
- Jukebox drift (revised per RESEARCH.md §10, retuned #286): **tiered**. Hard `seekTo(t, allowSeekAhead=true)` above **1.5 s**, then **hold still for a 1.2 s settle window and re-measure** (unbuffered seeks land on an earlier keyframe and read back stale while buffering — measuring through it turns one correction into a storm). Between **0.25 s** and 1.5 s, close it on the playback **rate at ±5 %**, which nobody can hear; below 0.25 s, play straight. Settled by doing on a live embed (2026-08-31): a 1.05× request reads back as 1.05, a 1.02× request rounds to 1 — the "rounds unsupported rates toward 1" caveat is real, but its floor is far finer than `getAvailablePlaybackRates()` advertises. An embed that rounds the nudge away loses nothing: its drift grows into the seek tier. All **(defaults — tune in alpha)**. Between corrections, dead-reckon position locally every 250 ms (OpenTogetherTube's proven design).
- Jukebox playhead arithmetic is on **server time, never the rider's wall clock** (#286): a client's clock is routinely seconds off, and adding `Date.now()` to a server anchor put that skew straight into the playhead — each rider chased a different target. Clients estimate the offset from `ServerTick.At` (**max of the last 8 samples** — the least-delayed tick is the truest, no ping/pong needed) and reset the window on every socket open **and whenever the tab returns to the foreground**: a backgrounded tab has its delivery batched, so every sample it takes reads late and the max-filter has no prompt sample left to prefer. A hidden tab therefore stops feeding the ring and keeps what it learned on screen (measured drifting ~2 s otherwise). Verified with three clients on one deck, wall clocks 6 s apart: **2 ms** of spread, against 6 s on the old arithmetic. Below **0.6 s** of measured drift the deck reads as in sync, and the panel says so — the rate tier exists to keep it there, so the badge is a claim the system actively defends rather than a threshold it merely observes.
- The server holds an **anchor, not a timeline**: it has no duration and cannot know a track ended. Clients report `ended` — and a client that finds the shared playhead already **past the track's duration** reports it too. Without that, a deck left playing to an empty channel runs its anchor off the end and the next rider inherits a position no player can reach (#286).
- Shared timeline: server-authoritative; clients render from tick timestamps, never local clocks.
- **A trainer that has sent nothing for 3 s is silent**, and the surface says so — the same number wherever a rider is riding (`SIGNAL_LOST_MS`, #2161). A trainer sends about once a second, so three missed samples is a dropout rather than a slow second; the fault is persistent dashboard status with one recovery button, never a toast (.claude/rules/errors.md). Group riding used to wait ten seconds for the same rider's own trainer while `/ride` and `/ramp` waited three.
