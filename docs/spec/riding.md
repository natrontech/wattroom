# Spec: Riding

Part of the product spec. [docs/SPEC.md](../SPEC.md) indexes every section and says which values change without an ADR.

## Ride guards

Numbers moved here from code after being ridden (#46). The cadence path was validated on a
Kickr Core on 2026-08-29: deliberate grind tripped the guard at 37 rpm under a held target,
the target released for 9.6 s (one tick under the 10 s window), and re-engaged at 158 W
once cadence recovered to 82 rpm. No false trips across any prior hardware session.

**Auto-pause** — the rider stopped, so their targets stop (clock does not rewind):

| Parameter               | Value                                                   |
| ----------------------- | ------------------------------------------------------- |
| Stopped = cadence below | 5 rpm                                                   |
| …AND power below        | 20 W (cadence alone unsafe — some trainers report none) |
| Pause after             | 3 s stopped                                             |
| Resume countdown        | 3 s (resuming must not be a jump-scare)                 |
| Stopped this long → the ride ends | 10 min paused (default — tune in alpha), solo ride and ramp test only (#2622) |

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

## Virtual gears (defaults — tune in alpha; [ADR-0084](../decisions/0084-wattroom-shifts.md))

When the ride is in SIM (a road, a race, the free ride's grade, a sprint slope), the rider shifts virtual gears with one pair of controls, **Easier** and **Harder**. A virtual gear multiplies whatever real gear is on the bike.

Every number below is a **default**, to be tuned in alpha and re-measured by the gears hardware session, unless it is marked *physics* (not tunable) or *rule* (a hard constraint from ADR-0084).

**The gear table**
- **Gears (default).** 24 gears, geometric from ratio **0.72** to **5.30**, one step = (5.30/0.72)^(1/23) ≈ **9.07 %**. The code computes the ratios; the display rounds them to 0.72 0.79 0.86 0.93 1.02 1.11 1.21 1.32 1.44 1.57 1.72 1.87 2.04 2.23 2.43 2.65 2.89 3.15 3.43 3.75 4.09 4.46 4.86 5.30.
- **Start (default).** Every ride starts at k = **1**, the rider's real gear and today's resistance. A Cog on 34×14 is gear 15.
- **A shift (default).** It goes to the table neighbour of the gear shown, so from a real ratio between two table gears the first step is between half a step and one and a half (**4.4–13.6 %**). With no real ratio known, k steps by **×1.0907**, bounded to **0.30 … 2.2**, and the gear shows as **±n**.

**Real gears**
- **Real ratio (default).** The median of trainer speed ÷ (cadence × **2.096 m**) over the last **7** samples at **60–110 rpm**.
  - A real shift is when that median sits **≥ 5 %** from the current ratio on **3** consecutive samples. k stays, and the gear shown re-anchors.
  - In the lab: no false re-labels in 10 h at 2 % per-sample noise, and a 42×14 → 42×17 move re-labels after 5 s.
  - If P1 measures per-sample noise above 2 %, the window becomes **9**.
  - If the ratio moves with grade (a trainer that reports modelled speed), detection is off and the gear shows as ±n.
- **Who reads the trainer's speed (rule).** Only the drivetrain does. The dot, timing and the bike computer's speed never do.

**What goes to the trainer**
- **The transform (physics).** k = virtual ratio ÷ real ratio.
  - sin θ' = k · (m/m_t) · sin θ_felt
  - Crr' · cos θ' = k · (m/m_t) · Crr · cos θ_felt
  - Cw' = k³ · Cw · (1 − shelter)
  - wind' = wind ÷ k

  The base values are Crr **0.004** and Cw **0.51 kg/m** (what ftms.ts sends today). m/m_t is **1** until its own issue decides otherwise.
- **Input (rule).** A road's grade goes through the route-rides felt rule (#3020). A slope the rider set by hand (the free ride) and a sprint slope are felt as given.
- **Shelter (rule).** Cw carries (1 − shelter) only while "Feel the draft" is on (ADR-0077). The dot always gets the hub's shelter.
- **Write range (default + rule).** The grade written stays within **MinTrainerGrade (−10 %, until P11)** … **MaxTrainerGrade (+15 %, #3020)**. Both live in protocol/limits.go and are the same for every trainer. A Cw above **2.55 kg/m** (the UINT8 field) folds into grade at the last flywheel speed.
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
- **Grade mode (default; amends ADR-0059).** The grade pair (**0.5 %** steps, as today) sits above. Easier / Harder sit below, full width, with the gear between them. Both are `btn-lg`. On a road the pair is Easier / Harder only.
- **Announce (default).**
  - `shift-up` and `shift-down` cues on the cues bus: two short ticks, rising or falling.
  - The gear field reads "Gear 15", or "+3" when no real ratio is known.
  - It is neon, never the watt accent, and never glows. It pulses once on a change, not at all under `prefers-reduced-motion`, and is aria-live polite.
- **Keys (default).**
  - Harder: `.` `+` `=` Numpad+. Easier: `,` `-` Numpad−. PgUp / PgDn are Harder / Easier.
  - No modifier key. `event.repeat` is ignored, because the shifter does the repeating. Keydown and keyup are press and release.
- **Phone (default).** Taps only, as a full-width pair. Each tap is answered with the gear, and whether it is at an end.
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
- **Don't make me shift (default).** The singleSpeed setting, renamed. Wherever SIM would put the rider on a slope, ERG-by-road holds FTP × clamp(0.60 + 0.03 × grade %, 0.50, 0.90), ± bias (#3025). Rides on it are stored but untimeable (rule: Jan, 2026-09-28; ADR-0074's who-chose-the-watts rule, since WattRoom chose the watts).

## The bike computer (defaults — tune in alpha; [ADR-0071](../decisions/0071-the-bike-computer-pages-slot-3.md))

Slot 3's pages, in order: **RIDE** (default, and where every ride starts),
**CLIMB** (opens by itself from RIDE when a climb begins on a free or route
ride; a workout or a session keeps RIDE and offers it, [#3645](https://github.com/natrontech/wattroom/issues/3645)), **POWER**, **MAP**
(on a road only), **RACE** (later). ← / → or a tap on the panel turn them;
PgUp / PgDn are Harder / Easier, never a page.

**Legibility**, at the design distance — desk: **0.8 m** from a **14-inch**
laptop; TV: **3 m** from a **55-inch** set:

| Text                  | At least      | TV       | Desk       | HUD      |
| --------------------- | ------------- | -------- | ---------- | -------- |
| Watts                 | **45 arcmin** | **12vh** | **104 px** | **12vh** |
| Time left             | **45 arcmin** | **9vh**  | **72 px**  | **9vh**  |
| Secondary numbers     | **22 arcmin** | **5vh**  | **36 px**  | **5vh**  |
| "Next", labels, words | **16 arcmin** | **3vh**  | **24 px**  | **3vh**  |

Nothing on the TV is smaller than **2.9vh**. **The HUD's design distance**
is a **second screen 1.3 m away, a 24-inch monitor**, the `/hud` tab of
[ADR-0041](../decisions/0041-the-hud-mirrors-the-riding-screen.md). A screen
height subtends the same angle there as a 55-inch TV does at 3 m, so a vh
reads the same, and the HUD takes the TV's column. It holds that in any
landscape window. The shell's own 320 × 132 window is the floor the block
never shrinks below ([#3678](https://github.com/natrontech/wattroom/issues/3678)). Panels are at least **85 %**
opaque; a unit is at most half its number's size. The big watts figure is a
**3 s** average; scoring still reads every second.

## Sync tolerances

- Metrics latency budget: pedal → every screen **< 500 ms**.
- Jukebox drift (revised per RESEARCH.md §10, retuned #286): **tiered**. Hard `seekTo(t, allowSeekAhead=true)` above **1.5 s**, then **hold still for a 1.2 s settle window and re-measure** (unbuffered seeks land on an earlier keyframe and read back stale while buffering — measuring through it turns one correction into a storm). Between **0.25 s** and 1.5 s, close it on the playback **rate at ±5 %**, which nobody can hear; below 0.25 s, play straight. Settled by doing on a live embed (2026-08-31): a 1.05× request reads back as 1.05, a 1.02× request rounds to 1 — the "rounds unsupported rates toward 1" caveat is real, but its floor is far finer than `getAvailablePlaybackRates()` advertises. An embed that rounds the nudge away loses nothing: its drift grows into the seek tier. All **(defaults — tune in alpha)**. Between corrections, dead-reckon position locally every 250 ms (OpenTogetherTube's proven design).
- Jukebox playhead arithmetic is on **server time, never the rider's wall clock** (#286): a client's clock is routinely seconds off, and adding `Date.now()` to a server anchor put that skew straight into the playhead — each rider chased a different target. Clients estimate the offset from `ServerTick.At` (**max of the last 8 samples** — the least-delayed tick is the truest, no ping/pong needed) and reset the window on every socket open **and whenever the tab returns to the foreground**: a backgrounded tab has its delivery batched, so every sample it takes reads late and the max-filter has no prompt sample left to prefer. A hidden tab therefore stops feeding the ring and keeps what it learned on screen (measured drifting ~2 s otherwise). Verified with three clients on one deck, wall clocks 6 s apart: **2 ms** of spread, against 6 s on the old arithmetic. Below **0.6 s** of measured drift the deck reads as in sync, and the panel says so — the rate tier exists to keep it there, so the badge is a claim the system actively defends rather than a threshold it merely observes.
- The server holds an **anchor, not a timeline**: it has no duration and cannot know a track ended. Clients report `ended` — and a client that finds the shared playhead already **past the track's duration** reports it too. Without that, a deck left playing to an empty channel runs its anchor off the end and the next rider inherits a position no player can reach (#286).
- Shared timeline: server-authoritative; clients render from tick timestamps, never local clocks.
- **A trainer that has sent nothing for 3 s is silent**, and the surface says so — the same number wherever a rider is riding (`SIGNAL_LOST_MS`, #2161). A trainer sends about once a second, so three missed samples is a dropout rather than a slow second; the fault is persistent dashboard status with one recovery button, never a toast (.claude/rules/errors.md). Group riding used to wait ten seconds for the same rider's own trainer while `/ride` and `/ramp` waited three.
