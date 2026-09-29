# 0084 — WattRoom shifts

- Status: accepted; settles [#3322](https://github.com/natrontech/wattroom/issues/3322) — Jan's request of 2026-09-28: virtual gears for Zwift Cog riders and for riders with real gears. Gears ship to riders without a freedom-to-operate opinion, and Jan accepts the residual US risk (2026-09-28; see "Release").
- Date: 2026-09-29 (decided 2026-09-28)
- Amends:
  - docs/RESEARCH.md §9 (its ban on app-side virtual shifting) and §11 (the controller handshake);
  - [ADR-0059](0059-a-voice-channel-rides-without-a-session.md): grade mode gains a second pair of controls.
- Beside:
  - [ADR-0007](0007-alpha-hardware-is-all-ftms.md): FTMS is the trainer protocol;
  - [ADR-0025](0025-one-sensor-one-screen.md): a rider's other screens and the trainer grant;
  - [ADR-0062](0062-the-horizon-may-be-a-road.md): the felt grade and the one write range;
  - [ADR-0074](0074-a-time-is-yours-when-your-watts-moved-your-dot.md): the Cog line, timing takes no gear, and "Don't make me shift" is untimeable;
  - [ADR-0077](0077-the-wind-is-shared.md) (#3232): the patent sentence, and how Cw is composed;
  - #3216: the ride keymap; #3217: the phone remote.
- Not legal advice. The claim readings below are an engineer's reading of public USPTO records. They are the engineering record of why this design stays outside the granted claims.

## Context

On 2026-09-28 Jan asked that riders with a Zwift Cog, and riders with real gears, be able to shift virtually in WattRoom. RESEARCH.md §9 said virtual shifting is patented (US11986700, US12465816) and told us not to build it, but nobody had read the claims. We read them on 2026-09-28 from the USPTO full text.

**US 11,986,700 B2, Zwift, "Virtual shifting for exercise devices"**
- Filed 2021-12-31, granted 2024-05-21, expires about 2042-11-24.
- Independent claims 1, 11 and 18 each need a simulated gear shift or braking made by "at least one rapid near-cessation of resistance", followed by the new resistance.
- A resistance per virtual gear is not claimed on its own.
- The published application (US 2023/0211208 A1, 2023-07-06) claimed "temporarily altering the resistance" without that limitation; our research and the ADR-0077 plan quoted that wording.
- Google Patents' events show no office action between docketing (2022-02-07) and the notice of allowance (2024-01-18). How the narrowing happened (preliminary amendment, interview or examiner's amendment) is in the file wrapper, and it bounds what a design-around may rely on.

**US 12,465,816 B2, Zwift, "Communications protocol for software driven exercise devices"**
- Filed 2023-06-13, granted 2025-11-11, expires about 2044-01-09.
- It claims a three-part link: an unacknowledged stream, a channel for messages that need a response, and a channel for the responses. That is the shape of Zwift's ZAP service.
- It may also read on FTMS itself: Indoor Bike Data notify, plus Control Point write and indicate. If so, that exposure exists for the trainer control WattRoom ships today, and gears add nothing to it. FTMS v1.0 (2017-02-14) predates the filing, but that is an invalidity argument, and a belief in invalidity is no defence to inducement (Commil). Whatever the answer, gears do not change it.

**Pending, and not enforceable until granted** (with one reach-back, below):
- **18/640,559** (US 2024/0261635 A1), a continuation of the '700.
  - Published claims: detect a state and alter the resistance; a virtual cassette; auto-shift triggers; a countdown; a smooth transition (dependent claims 6 and 13).
  - Non-final rejection 2026-03-11, so the six-month response limit was 2026-09-11. If it went unanswered the application is abandoned, but it can be revived (37 CFR 1.137).
- **18/334,110** (US 2024/0416182 A1).
  - Published claim 1: a gear-shifting device with its own communications interface, feeding a computer whose software generates a virtual world, which sends a resistance instruction to the trainer.
  - Published claim 5 names a remote control and a video game controller as such a device.
  - Non-final rejection 2026-04-21; the outer response date is 2026-10-21.
- **19/360,268** (US 2026/0041964 A1, published 2026-02-12), a continuation of the '816.
  - Its claim 1 is slightly broader than the granted one. It reaches gears only as far as the '816 does: through the link, not the shift.
- **19/234,077** (US 2026/0000975 A1, published 2026-01-01; EP4670807A1), controller pairing, priority 2024-06-26.
  - The input device sends the game client a bitmap of the inputs it supports.
  - OpenBikeControl works the other way round: the app sends the controller a list of button IDs.
- **The reach-back.** If one of these grants with claims substantially identical to its published ones, its owner can claim a reasonable royalty from publication against anyone who had actual notice of the published application (35 USC §154(d)). WattRoom has read them, so notice should be assumed. The rejections of 18/640,559 and 18/334,110 so far make an unchanged grant of either unlikely, not impossible.

**Europe and Switzerland**
- No Zwift virtual-shifting right is granted.
- None of the published pending EP claims covers app-side gears. The shifter-to-app-to-trainer application EP4478686 was withdrawn.
- EP4631586 is a pending divisional of EP4205825B1, and more divisionals can be filed while it is pending, within the parent's disclosure. EP4478753, the protocol family's EP member, and EP4670807A1, the controller-pairing application, are pending too. They stay on the watch.

**Why "this can never be patented" is not the lever.** The concept is old: ICON's 2011 filing already had virtual gears, speed from cadence and gear, and physics-based resistance. A claim to the bare concept should fall. A claim to a specific implementation can stand:
- A granted US claim is presumed valid (35 USC §282) until an IPR or a court says otherwise, and a court needs clear and convincing evidence (Microsoft v. i4i, 2011).
- A good-faith belief in invalidity is no defence to inducement (Commil v. Cisco, 2015).
- "I only practise the prior art" is no defence to literal infringement (Tate Access Floors v. Interface, Fed. Cir. 2002).
- The lever is to stay outside the claim elements. The hard rules under Decision do that, and Jan's release decision rests on them.

**Prior art:**
- ICON US 2013/0059698 (priority 2011).
- Wattbike Atom (2017).
- Tacx NEO Bike (2019), which already dropped tension on a shift.
- KICKR BIKE (2019).
- Wahoo US 2021/0060380 (published 2021-03-04).
- qdomyos-zwift's app-side gears (2021-06-16).

**Others ship it:**
- indieVelo, now TrainingPeaks Virtual (2023-08);
- GTBikeV (2023-12);
- MyWhoosh MyShift (2025-03);
- BikeControl.

We found no suit and no cease-and-desist from Zwift. That is not a licence.

**The shift lab (2026-09-28)** is a prototype outside the repo. It runs a cadence-holding rider through the shifter, the write policy, ftms.ts's queue, a simulated trainer and the pace model. It tests five trainer methods against the claim elements, the FTMS field limits and fairness.
- 37 tests pass.
- 18 of 18 deliberate mutations are caught.
- Its numbers are the defaults below.

## Decision

### Release: without a freedom-to-operate opinion

On 2026-09-28 Jan decided that gears ship to riders without a patent attorney's freedom-to-operate opinion. He accepts the residual US risk on the strength of the claim readings above and the hard rules below: it lies in the pending applications 18/640,559 and 18/334,110 and the protocol continuation 19/360,268, including a royalty reaching back to publication if one of them grants with its published claims substantially unchanged (35 USC §154(d)). Those applications are checked at the first release of each week, and a grant is read against these rules (see "What to re-check when a pending application grants").

### A gear is a multiplier on the road the trainer already simulates

A virtual gear is one number: k = virtual ratio ÷ real ratio. WattRoom already sends FTMS 0x11, which carries grade, Crr, Cw and wind. With a gear, every 0x11 carries:
- sin θ' = k · sin θ_felt
- Crr' · cos θ' = k · Crr · cos θ_felt
- Cw' = k³ · Cw · (1 − shelter)
- wind' = wind ÷ k

The trainer then resists with k·F(k·v) at its own flywheel speed v, which is exactly the felt road at gear speed. It keeps its own fast control loop, so resistance follows the flywheel between our 1 Hz samples.

**One composer** builds every SIM write (a road, a race, the free ride's grade, a sprint slope, the flat-road fallback), in this order:
1. The input.
   - A road's grade goes through ADR-0062's felt rule: difficulty, halved on descents, slewed.
   - A slope the rider set by hand (the free ride) or a sprint slope is already felt, and difficulty never touches it.
2. Shelter ([ADR-0077](0077-the-wind-is-shared.md)), only while "Feel the draft" is on.
3. The gear.
4. The clamp, to WattRoom's one write range: MaxTrainerGrade (+15 %, ADR-0062) and MinTrainerGrade (a default until hardware check P11), both in protocol/limits.go. It is the same for every trainer, because FTMS cannot report an indoor bike's grade range. A Cw beyond the UINT8 field folds into grade at the last flywheel speed.
5. One write.

The trainer's assumed mass stays at m/m_t = 1. Correcting it would change every rider's SIM feel by body weight, which is a decision of its own and has its own issue.

### Real gears keep working

k multiplies whatever real gear is engaged. When the rider moves the real derailleur, the flywheel speed changes at once and k stays put, so the virtual gear rides on top of the real one.

WattRoom reads the real ratio from the trainer's flywheel speed and cadence. That ratio does two jobs:
- it labels the gear;
- it sets every shift's k (k = table ratio ÷ real ratio).

A detection error therefore changes step sizes, never the resistance of the gear the rider is in. Only the drivetrain module reads the trainer's speed; the dot, timing and the bike computer never do.

Every ride starts at k = 1: the rider's real gear and today's resistance. A shift goes to the table neighbour of the gear shown, so the label always moves. A Cog rider is simply the case with one real gear.

### What a shift is, and never is

These are hard constraints, not defaults. Each of rules 1–4 keeps the design outside a granted claim or a published pending one, and the release decision rests on them.

1. **Every SIM write is the composed target road at the current gear.** A shift is one such write, sent at once. Nothing is written between the old gear and the new one: no dip, no flat, no switch between ERG and SIM.
   - Why: every independent claim of US 11,986,700 (1, 11 and 18) needs a simulated shift or braking made by "at least one rapid near-cessation of resistance". One composed write per shift leaves nothing in between to cease.
2. **WattRoom never pulses the trainer.**
   - A pulse is any write, or sequence of writes, that takes the trainer below the lower of the resistance before and after it, whatever triggers it: a shift, a brake, a surface or anything else.
   - The one sequence in the code with that shape is the ERG→SIM entry: 0 % for 500 ms, then the slope. It exists for the Kickr's ERG/SIM switching spike (RESEARCH.md:95, fw 1.4.8). It happens only when a slope begins after ERG, never on a shift.
   - A shift inside those 500 ms moves k only, and the timed write reads the gear when it fires. The entry step simulates neither a shift nor braking, and a 0 % road still carries rolling and air resistance. It stays on the re-check list.
   - A shift, a surface, a brake or any event announces itself by sound and on screen, and by a controller's own vibration where there is one.
   - Why: a dip on a shift or a brake is the literal element of the '700's independent claims.
3. **Shifting is manual.**
   - Nothing shifts on cadence, power, heart rate, place, pace or a plan, and nothing counts down to a shift.
   - Nothing eases between two gears. Easing Cw over half a second is the "smooth transition" of 18/640,559's published dependent claims 6 and 13, so it is ruled out, not a remedy.
   - Why: auto-shift triggers, a countdown and a smooth transition are 18/640,559's published dependents, and a countdown is also a dependent claim of the '700.
4. **No Zwift protocol.** WattRoom never speaks ZAP (Click, Play, Ride, or trainer-side shifting) and never sends Zwift-format gear commands.
   - Why: US 12,465,816 claims the shape of ZAP's three-part link, and 19/360,268 continues it.
5. **The gear never enters the numbers.**
   - Reported watts are never scaled by k.
   - The pace model, timing, scoring, XP and the tick take no gear.
   - The gear stays on the rider's device and is not stored with the ride.

### Where gears act

Gears act in SIM. One pair of controls, **Easier** and **Harder**, means one thing per mode (Jan, 2026-09-28):
- in SIM, a gear;
- in an ERG workout, bias ±1 %;
- in the free ride's watts mode, ±10 W;
- elsewhere, disabled with a one-line hint.

**Grade mode (amends ADR-0059).** The free ride's grade pair stays, because it sets the road. Easier/Harder join it below and set the gear. On a road (#3027) the road sets the grade, so only Easier/Harder remain.

**Don't make me shift.** The profile's singleSpeed setting is renamed "Don't make me shift". Wherever SIM would put the rider on a slope, ERG-by-road (#3025) holds the watts instead. A Cog rider no longer needs it. Rides on it are stored but untimeable (Jan, 2026-09-28): under ADR-0074's who-chose-the-watts rule, WattRoom chose the watts.

**Fallbacks.** Neither is built before a rider's trainer needs it.
- A trainer whose SIM ignores Crr and Cw (P2) gets one grade that makes the same force at the last flywheel speed.
- A trainer without usable SIM gets ERG-by-gear, computed from the trainer's speed, with a 50 W floor.

### Inputs

Every input feeds one shifter.
- **v1:**
  - the on-screen pair;
  - the keyboard. A browser cannot tell a laptop's own keyboard from a clicker, a foot switch or a gamepad in keyboard mode, so keys are one input;
  - the rider's phone (#3217), which sends taps and never holds. A lost release over a socket with Talk's 1 s keepalive made up to 5 phantom shifts in the lab; a tap makes none;
  - an OpenBikeControl controller over Web Bluetooth.
- **Later:** OpenBikeControl over the network in the desktop shell.
- Never a vendor protocol.

Each input is its own switch inside `gearsEnabled()`. 18/334,110's published claim 1 is a separate gear-shifting device with its own communications interface, and its claim 5 names a remote control and a video game controller. The phone and an OBC controller have that shape, and so do keys, because a clicker arrives as keys. The on-screen pair is the input least like it. If that application grants in that shape, the watch switches off the inputs it reaches, one switch each, without touching the rest.

### When the trainer grant moves

k lives on the screen that holds the trainer grant ([ADR-0025](0025-one-sensor-one-screen.md), #1853).
- A reconnect of that screen keeps k and re-issues the current state, recomputed rather than replayed.
- When the grant moves to another of the rider's screens, the new holder starts at k = 1 and says so: a cue, and "Gear back to your real gear" on the gear field.

Carrying k through the hub was rejected. It would add a rider-addressed field for a rare case, whereas the reset is heard and the rider shifts back.

### Riders get gears when the engineering is done

`gearsEnabled()` follows `canSimulate()`'s rule (`dev`, the dev sign-in door, or the synthetic identity) until two things hold:
- the gears hardware session, P1–P12 on a Kickr Core and a Kickr Core 2, has passed;
- the HUD, the keys and the ERG routing of Easier/Harder are in.

Then #3333 turns gears on for every rider. The phone and OBC arrive later, each on for everyone when it lands. Until then the dev gate is enough for CI and for the hardware session.

### What to re-check when a pending application grants

At the first release of each week (`make release`) the watch ([#3323](https://github.com/natrontech/wattroom/issues/3323)) checks the USPTO status of 18/640,559, 18/334,110, 19/360,268 and 19/234,077, any new continuation in their families and any revival (37 CFR 1.137). On the EP Register it checks EP4631586, any new divisional of EP4205825, EP4478753 and EP4670807. It stops for an application once that application is granted and read, refused, or abandoned beyond revival.

When one grants, its independent claims are read against the rules above and compared with its published claims, because the reach-back applies only if they are substantially identical. An issue then names which input or behaviour is switched off:
- **18/640,559.** Do the granted independent claims still need a near-cessation? If one claims a resistance per virtual gear on its own, or a virtual cassette, the method itself is in question. Auto-shift, a countdown and a smooth transition are already out under rule 3.
- **18/334,110.** Does the granted claim keep a separate gear-shifting device with its own communications interface, and a computer generating a virtual world? If so, the separate-device inputs go first: the phone and OBC, then keys as a whole. Does a free ride with no road (no "virtual world") fall outside it where a Ride Worlds road does not?
- **19/360,268.** Does the granted three-part link read on FTMS itself (Indoor Bike Data notify, Control Point write and indicate)? If so, it concerns all trainer control, not gears.
- **19/234,077 and EP4670807A1.** Does a granted claim reach a controller that never sends the app a bitmap of its inputs, where the app sends the controller its button IDs instead? If so, OBC is switched off.
- **Any claim that grants with near-cessation wording.** Two edge cases are read against it:
  - a downshift whose new level is itself near zero (a low gear on a felt descent, with the trainer at its minimum), followed by an upshift;
  - the ERG→SIM entry step: 0 % for 500 ms, then the slope (`$lib/ride/actuation.ts`, the entry's flat).
- **EP4631586, its divisionals, and EP4478753.** Does a granted claim cover app-side gears, or ZAP's link, in a state that includes CH?

## Consequences

- Cog riders ride grade and roads like everyone else. When gears reach riders, the ERG 2×FTP sprint flip (#41) and the one-gear copy (#3203) retire, except under "Don't make me shift".
- Riders with a cassette can shift virtually, really, or both. Nobody has to shift.
- Interface changes:
  - `Trainer.setSimulation` takes the four SIM parameters, and FtmsTrainer stops hard-coding Crr and Cw.
  - `TrainerSample` gains the trainer's speed, read only by the drivetrain.
  - ADR-0077's Cw becomes k³·Cw·(1 − shelter).
  - The sprint path's timer stops closing over the grade it armed.
- Shift lab numbers (defaults, to tune in alpha):
  - **Step size.** At 90 rpm near 200 W, one gear up is +10.2 % torque at felt 6 %, +13.4 % at 3 % and +27.0 % on the flat. A real bike at constant speed gives +9.07 %. Steady states match a real bike; only the flat transient is harsher.
  - **Writes.** A shift reaches a Kickr in one control-point round trip, 131 ms median (#10). In the lab the worst case was two round trips, 261 ms. Over the script, 27 shifts made 25 writes; the two inside the entry flat rode on its timed write. There were no mode changes on a shift.
  - **Clamps.** Up to 600 W, nothing clamps on a Cog, on 42×14 or on 53×11. On a 34×28 real gear, 95 of 726 cells clamp: tall virtual gears on a slow flywheel, P9's torque ceiling.
  - **Fairness.** A rider holding cadence makes different watts in different gears, which is the point. Within each ride the dot equals a replay of the recorded watts through the pace model, to rounding.
- The hardware session P1–P12 is half of the release gate (the HUD, the keys and the ERG routing are the other half), and it decides:
  - whether Crr and Cw are honoured, and the drag convention;
  - the trainer's assumed mass;
  - what FTMS 0x12 does;
  - whether a gen-1 Core renders descents, which sets MinTrainerGrade;
  - the per-sample noise of the ratio, and whether the ratio moves with grade. If it does, detection is off and the gear shows as ±n.
- Self-hosters get the same code and the same rules, and weigh their own risk: Jan's decision is the operator's decision for wattroom.ch, and AGPL §11 licenses only contributors' own patents.
- A grant that reaches an input or a behaviour switches it off through its own issue, and this ADR is amended to say so.

## Alternatives considered

- **Keep §9's ban and only widen singleSpeed** (ERG-by-road wherever a slope would go). Rejected by Jan on 2026-09-28. It survives as "Don't make me shift".
- **Wait for a freedom-to-operate opinion before riders get gears.** Rejected by Jan on 2026-09-28. The design stays outside the granted claims as they read, the remaining exposure lies in pending applications, enforceable only once granted and reaching back only if a grant keeps the published claims, and the watch reads each grant as it comes.
- **A shift "clunk" through the trainer.** Rejected: it is the literal element of every independent claim of US 11,986,700, and ux.md already announces state by sound and screen.
- **Trainer-side shifting over Zwift's protocol.** Rejected:
  - US 12,465,816 claims the shape of its link;
  - Click v2's daily unlock adds anti-circumvention exposure;
  - the protocol is closed and changes at will.
- **ERG-by-gear as the main method.** Kept as a fallback only. In the lab it was 55 % light in the first second of a cadence jump, and +69 % for a second after a real derailleur move. The trainer's own ERG ramp of 1.3–1.8 s (#10) comes on top.
- **A fixed grade offset per gear.** Rejected: it ignores speed, and its median steady error against the felt road was 13–19 %.
- **FTMS 0x12 (wheel circumference) as the gear.** Deferred to P5: it is exact only if the trainer runs its whole road model at the scaled speed.
- **Easing a shift over about half a second.** Not built; see rule 3.
- **Gears on outside the US now**, by IP geolocation. Rejected:
  - geolocation is leaky;
  - it means reading riders' locations, against privacy as architecture;
  - the operator would still know it has US riders.
- **Carrying k across a grant move.** Rejected; see above.
- **Holding to repeat on the phone.** Rejected; the phone sends taps.

## Sources

**Patents and applications**
- US 11,986,700 B2: https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/11986700 (claims read 2026-09-28)
- US 2023/0211208 A1: https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/20230211208
- US 12,465,816 B2: https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/12465816
- US 2024/0261635 A1 (18/640,559): https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/20240261635 (status as mirrored by https://patents.google.com/patent/US20240261635A1/en, 2026-09-28)
- US 2024/0416182 A1 (18/334,110): https://patents.google.com/patent/US20240416182A1/en
- US 2026/0041964 A1 (19/360,268): https://patents.google.com/patent/US20260041964A1/en
- US 2026/0000975 A1 (19/234,077): https://patents.google.com/patent/US20260000975A1/en
- EP4670807A1: https://patents.google.com/patent/EP4670807A1/en
- EP4478686A1 (withdrawn): https://patents.google.com/patent/EP4478686A1/en
- EP4478753A1: https://patents.google.com/patent/EP4478753A1/en
- EP4205825B1 and its divisional EP4631586: https://patents.google.com/patent/EP4205825B1/en

**Prior art**
- ICON US 2013/0059698 A1: https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/20130059698
- Wahoo US 2021/0060380 A1: https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/20210060380
- DC Rainmaker on the KICKR BIKE, Wattbike Atom and Tacx NEO Bike (2019-10): https://www.dcrainmaker.com/2019/10/wahookickrbike-wattbikeatom-tacxneobike.html
- qdomyos-zwift commit 35422aea (2021-06-16), read for behaviour and never copied: https://github.com/cagnulein/qdomyos-zwift/commit/35422aea

**Standards and shipped work**
- FTMS v1.0 (2017-02-14), §4.16.2.18–19
- Makinolo (2023-11-06): https://www.makinolo.com/blog/2023/11/06/virtual-gear-shifting-in-indoor-training/
- OpenBikeControl protocol (MIT): https://github.com/OpenBikeControl/openbikecontrol-protocol

**Law**
- 35 U.S.C. §282
- 35 U.S.C. §154(d)
- Microsoft Corp. v. i4i Ltd. P'ship, 564 U.S. 91 (2011)
- Commil USA, LLC v. Cisco Systems, Inc., 575 U.S. 632 (2015)
- Tate Access Floors, Inc. v. Interface Architectural Resources, Inc., 279 F.3d 1357 (Fed. Cir. 2002)
- 37 C.F.R. §1.137
- IPRG Art. 111: https://www.fedlex.admin.ch/eli/cc/1988/1776_1776_1776/de
