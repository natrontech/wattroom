# Spec: Riding together: open rides, races, the roadside

Part of the product spec. [docs/SPEC.md](../SPEC.md) indexes every section and says which values change without an ADR.

## Open rides (defaults — tune in alpha; [ADR-0076](../decisions/0076-shared-roads-not-an-open-world.md))

| Parameter             | Value                                                                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Per crew              | at most **3** open rides starting in any rolling **7 days**, opened at most **28 days** ahead, inside the 3-month planning bound                       |
| Riders per ride       | **100**; the 101st is refused with `rate_limited` ("This ride is full")                                                                                |
| The pen               | opens **10 min** before the flag; the count-in is #3087's                                                                                              |
| Group ride, late join | lands at the bunch with #3108's drop-off, up to the plan's last **10 min**                                                                             |
| Race formats          | the pen closes at the flag; disconnect grace **30 s** (Races)                                                                                          |
| Stranger figures      | **40** visible on the high tier, **16** on the low; the rest are Skyline dots and counts in the peloton ring                                           |
| Coarse kit            | **12** jersey colourways and **6** bike silhouettes                                                                                                    |
| Ride-id map           | kept until **24 h** after the ride ends; reports kept **30 days**                                                                                      |
| Name audience         | refreshed every **60 s**                                                                                                                               |
| Leader calls          | **6** codes — welcome; climb ahead; stay together over the top; last 5 km; sprint at the sign; thanks for riding — at most **1** per **20 s** per ride |

## The roadside ([ADR-0064](../decisions/0064-the-roadside.md) — defaults, tune in alpha)

The **roadside** is everyone in a voice channel who is not riding a given
rider's session: a phone propped beside the bike, a desk in the lounge, a rider
a game has put out. It paints, sounds and informs; it never changes a rider's
resistance, nothing it does reaches a trainer, and it picks **when, never who**
([ADR-0064](../decisions/0064-the-roadside.md)).

- **Marks**: at most **24** per ride.
- **Sounds**: at most **12** roadside sounds a minute reach any one rider.
  The cowbell counts against it; a ring past the ceiling stays silent, and the
  cheer still floats up.
- **A Prime**: best 5 s W/kg inside the 15 s sprint window. **One** per
  spectator per ride; never within **5 min** of another sprint, never near a
  KOM, and never in the last **3 min**.
- **A stand** (where a spectator watches from): **300 m – 5 km** ahead of the
  bunch, moved at most once per **60 s**.
- **Paint**: **6** stamps per spectator, one per climb; at most **12** live on
  the road.
- **Backing a rider**: **one** per spectator per ride.
- **Weather**: in rounds of **5 min**.
- **Flashes**: at most one dim flash per **10 s**, and none under reduced
  motion.

What v0 ships (#3022):

- **The cowbell.** Every deck carries the fixed `bell-ring` key after the
  rider's own four cheers, whatever their reaction set holds. It is a cheer —
  the same **one a second** per rider — that rings the cowbell cue instead of
  the cheer's blip: the TR-808's, two square voices at **540 Hz** and
  **800 Hz** through one bandpass at **880 Hz**, **0.3 s** long. **Once a
  tick**, however many rang it, and within the sound ceiling above.
- **A bottle** goes to a rider **riding the session** in the voice channel you
  share, and to nobody else; the hub refuses the rest and says why. **One per
  sender and rider every 10 s** — the poke's cooldown, on a key of its own, so
  a bottle never spends the poke. It is never a DM line. The rider's screen
  **holds it until their next recovery valley**: the ride asks nothing harder
  than **Z1** (≤ 55 % FTP, the zones above) or nothing at all — paused,
  stopped, off the ride — and no sprint is on. What the ride asks is the
  block's prescription, so the spiral release's ten seconds at 0 W are not a
  valley. A running game asks what its mode does: a ramp's or the relay's own
  target, Floor is Lava's called zone, Watt Golf's hole (60–110 %, so never a
  valley), a Sprint Roulette window from its klaxon; a Points Race, whose
  sprints come unannounced, and any mode the screen does not know are never a
  valley while they run. A rider a game has put out is asked only their own
  easy spin. Then it is announced like a poke: the cue, and a line in the
  timeline mid-ride. Held in memory, so a reload lets go of a bottle not yet
  taken.
- **Eliminated riders** — Backyard Ramp and Floor is Lava put riders out one
  at a time — are told they are at the roadside, with the deck, for as long as
  the game runs.
- **Phones hear the first tap.** The cue bus opens on the tap that lifts (a
  touch's press is not a gesture a browser lets sound start in), and a tap on
  the deck opens it from inside the tap.
- **One gauge**, for the service rather than about anybody:
  `wattroom_room_spectators`, the sockets in voice channels whose session is
  running, held by someone not riding it. Unlabelled, beside
  `wattroom_room_riding` — WATTROOM.md rules out product analytics.

## Races ([ADR-0067](../decisions/0067-racing-on-a-road.md) — defaults, tune in alpha)

- **Physics**: a rider's speed is the reference rider's (Route rides) at their **W/kg × 75 kg**, plus an **8 kg** bike, on the grade.
- **Race FTP**: the profile FTP, or the FTP suggestion (Stats formulas) when it is higher, frozen at the flag.
- **Race weight**: frozen at the flag. A weight changed within **14 days**, or a weight or FTP from the default source, rides unranked.
- **Weight confirmation**: once every **90 days**, one tap through the FTP prompt, never a gate; a weight not confirmed within 90 days rides unranked.
- **Results**: per Category D–A on the closing card only; a lone rider reads "rode alone in C". A restart voids the race. On an open ride each rider sees only their own placing.
- **Start**: a **10 s** countdown, then a **3-minute** neutral zone at **0 %**, then the km-0 klaxon.
- **Riders**: a race starts with at least **2**; points need at least **3**. Disconnect grace **30 s**.
- **Tick**: **4 Hz** once the leader's ETA to the finish is **30 s** or less.
- **Category par** (W/kg): **D 2.2**, **C 2.85**, **B 3.6**, **A 4.3**. The pacer rides the same par (ADR-0068).
- **Shelter**: the open field of [ADR-0077](../decisions/0077-the-wind-is-shared.md); results stay per Category.
- **Critical power**: its lines are #3262's.
- **Team-car radio**: closed phrases only — neutral zone, km 0, race held, race back on, **10**, **5**, **2** and **1 km** and **500 m** to the line, over the line — at most one every **20 s**, the most pressing first. It never says a number the RACE page shows.

| Format     | Parameters                                                                                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Devil      | starts **45 s** ahead at **95 %** of par; a spectator's tug moves it **±1** point per **20 s**, within **88–102 %**, frozen while a rider is within **300 m** |
| Last Light | **10**, **20** or **30 min**, default **20**; the fog closes from **3 km** to **150 m** over the final **60 s**                                               |
| Wheelrace  | par time **15–45 min**, default **30**; hard close at par **+15 %**                                                                                           |
| The Col    | the summit café waits at most **5 min**                                                                                                                       |

**The crowd on a climb**: density ρ(d) = ρmax · (1 − d/1500)², with ρmax
**0.6/m** on class I and HC climbs and **0.25/m** on III–IV; at most **400**
figures in the crowd (**120** on the low tier).

## Drafting (defaults — tune in alpha; [ADR-0077](../decisions/0077-the-wind-is-shared.md))

Only in races and in free rides on a road, and always computed by the hub. The
numbers follow Blocken (2018, 2025), Spoelstra (2021) and Zwift's PD4.1.1
tests; the 50 % cap is a rule.

| Parameter         | Value                                                                                                                                                                       |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shelter behind    | **35 %** up to a **1.0 m** wheel gap, fading linearly to **0** at **6 m**                                                                                                   |
| Shelter in a line | **35 / 45 / 50 %** for second, third and later wheels; capped at **50 %** (rule)                                                                                            |
| Adjacent lane     | **× 0.5**                                                                                                                                                                   |
| Front rider       | **−3 %** drag with a wheel within **1 m** behind                                                                                                                            |
| Lanes             | **3 / 4 / 5** lanes for up to **6 / 12 / more** riders, plus the passing lane; minimum gap **0.3 m**; one lane change per **2 s**                                           |
| Easing            | shelter eased with τ **2 s**                                                                                                                                                |
| Groups            | split at a **2 s** gap                                                                                                                                                      |
| Attack            | at least **+1.0 W/kg** over the group mean, with no shelter, for at least **3 s**                                                                                           |
| Timing            | an effort above **5 %** mean shelter is untimeable (rule; Road times)                                                                                                       |
| Trainer           | Cw = **0.51** × (1 − shelter) × k³ (Virtual gears), eased, written on a change of at least **5** points and at least **2 s** apart; a gear shift is exempt from the spacing |
| No Cw             | a trainer that ignores Cw gets an equal grade offset                                                                                                                        |

## Riding a road together (defaults — tune in alpha; [ADR-0065](../decisions/0065-riding-a-road-together.md))

The bunch's one position advances once per whole second, never on a sprint
window's 4 Hz ticks. Its pace:

| The plan is                             | The bunch moves at                                                                                                                                                                                                                                   |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| an ERG workout, or a workout on a route | the reference rider (Route rides) at the block's prescribed %FTP                                                                                                                                                                                     |
| a sprint block                          | the reference rider at **150 %** FTP                                                                                                                                                                                                                 |
| paused                                  | **0**                                                                                                                                                                                                                                                |
| a road step                             | the live mean %FTP of the pedalling riders, each capped at **150 %**                                                                                                                                                                                 |
| a game on a road                        | what its mode asks of everyone, capped at **150 %**: Team Relay's front rider while they pedal (#3030); Backyard and Collective Ramp at the round's line; Floor is Lava at the middle of the called zone (#3114). Any other mode rides the live mean |

A rider's bias never moves the bunch.

| Parameter         | Value                                                                                                                                                                                                                                              |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Offset decay      | τ **20 s**                                                                                                                                                                                                                                         |
| Offset clamp      | **−10 … +25 m** while pedalling                                                                                                                                                                                                                    |
| Resting           | a rider silent past **10 s** (the virtual-speed rule) coasts back to **−40 m** and is marked Resting                                                                                                                                               |
| Team-car tow back | **20 s**; only in bunch rides and ERG sessions — never in a race, a game or a timeable effort; a towed rider gives no shelter                                                                                                                      |
| Formation         | rows of Drafting's lanes, filled in the order riders joined, centred on the bunch's metre (#3098)                                                                                                                                                  |
| Front row         | rotates every **120 s** of elapsed time                                                                                                                                                                                                            |
| Lanes             | a critically damped spring with a **0.6 s** half-life (#3098)                                                                                                                                                                                      |
| Client snap       | within **25 m** of their place a rider eases there over **5 s**; further, they dither out (**200 ms**) and back in (**300 ms**) there, never sliding through others (#3098); relaxes to **0 %** grade at **1 %/s** after **5 s** of dead reckoning |
| Late join         | a **3 s** drop-off                                                                                                                                                                                                                                 |
| KOM sprints       | open **300 m** before the top of a class **III** climb or harder; at most one per **5 min**, **6** per ride                                                                                                                                        |
| Terrain Match     | **250 m** step; penalty weight **0.3**; suggestion floor **0.2**                                                                                                                                                                                   |

## Crew Tour (defaults — tune in alpha; [ADR-0080](../decisions/0080-a-crews-season-is-a-tour.md))

- **Tour metres**: the reference rider's distance (Route rides) at the ride's %FTP profile, on the flat; zero-watt seconds pay nothing.
- **Per ride**: at most **60 km** of tour metres.
- **Per member per week**: at most **150 km**.
- **A stage**: the route's own length; at most **12** stages in a Tour.
- **The col of the month's crew count**: opted-in riders only, no Strava-origin routes, hidden below **3**.
