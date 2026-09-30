
# Design targets

This file says what every rider-visible change is held to. Each surface has:
- an id, which is also its capture's file name;
- the target images it is compared with;
- the canon that outranks those images;
- a must-match list that a reviewer walks item by item.

`docs/design/DESIGN-CHECK.md` is the procedure. The captures come from `make design-shots` (`web/e2e/design-shots.spec.ts`).

## Where the targets come from

The images live in `docs/design/targets/`. They were rendered on 2026-09-30 from our own mockups in `docs/design/mockups/`, and `make design-targets` re-renders them. Jan has seen and chosen every one.

The v2 mock's route starts in an invented village, Stollmatt, and says nothing of how far its start is from km 0 (G10). Its traces stop about a kilometre short of the start on the way out and a little further on the way back, and nothing on its maps is centred on the start: the ring sits between the cut ends and km 0 on the first kept point. The real place it first named was replaced, and the traces trimmed, before these files entered the repository; v2's erg, ride, routes, summary, collections and phone were re-rendered for it.

- `v2-*.png`, “Ride Worlds Play”: ride, erg, routes, summary, garage, collections, phone.
- `v3-*.png`, “Ride Worlds Shared Roads”: roads, events, modes, race, rider, motion, roadside, shop.
- `shop-*.png`, “Velowerkstatt”: catalogue, locker, makers.
- `world-*.jpg`, the realism-lab and world renders:
  - `world-realism-tier3`, the recommended real-ground look;
  - `world-bluehour-hairpin`, the stylised tier;
  - `world-ghost`;
  - `world-kom`.

## How to read a target

- **Only the framed mock is the bar.** A v2 or v3 target is a whole page:
  - above the framed mock: an eyebrow, a title and a paragraph;
  - below it: notes and an “Open for Jan” box.
  The notes are reasoning, and canon has since answered the open questions.
- **Structure is the bar.** Compare proportion, grouping, alignment, hierarchy, what sits where, and what is absent. A size the mock happens to draw is not the bar; sizes come from docs/SPEC.md. **A pixel number written into a must-match item is the bar, within ±4 px.**
- **Ignore the mock's data.** The Gurnigel loop, Mia and 258 W are illustrations. The capture rides other data, so compare structure.
- **Targets are drawn dark.** Desk surfaces are compared on a dark capture, and a light capture must hold the same layout. Riding surfaces are always dark.
- **Owner tags.**
  - `[key]` after an item names the `design/<key>` issue that delivers it.
  - `[#n]` names an existing issue.
  - An untagged item holds today and is guarded against regression.
  - A PR is held to three things: the items its own issue owns, the global rules, and no regression anywhere else.
  - A global-rule break that BEFORE shows identically on the same surface, and that an open issue owns, is listed under OPEN-ELSEWHERE with that issue and not graded (#3705). Anything the PR adds or makes worse is a regression and blocks, the never-justifiable list included.
- **Check tags.** An item without a check tag is checked on the image. The other tags say where the answer is:
  - `[probe:<key>]`: the measurement JSON that the capture run writes beside each image;
  - `[test:<file>]`: a test in the repository that asserts it;
  - `[multi:<capture>]`: a named second capture, such as a frame sequence, a second rider, another scheme or a reduced-motion run.
  When a motion or state item's source is missing, the reviewer marks it CANNOT-TELL. It never guesses from a single still.

## Precedence and standing deviations

Canon beats the target, and the target beats today's app. Canon is WATTROOM.md, `docs/decisions`, `docs/SPEC.md` and `.claude/rules`. The deviations below are settled: a reviewer never flags them, and an implementer never copies the mock where it breaks one.

- **D1. Sizes are SPEC's “The bike computer”.**
  - Desk: watts ≥ 104 px, time left ≥ 72 px, secondary numbers ≥ 36 px, words and labels ≥ 24 px.
  - TV: 12 / 9 / 5 / 3 vh, and nothing under 2.9vh.
  - The mocks' 11–21 px labels sit under that floor. Where a mock's proportions cannot hold SPEC's sizes, the panel grows, never into the keep-clear corridor.
  - SPEC has no phone row and no HUD row yet. design/ride-phone and design/ride-hud each propose one in their PR, derived from ADR-0071's arcminutes at a design distance they state. Until then, their items are relative (“the largest number on the screen”).
- **D2. Slot 3's pages are ADR-0071's closed set:** RIDE, CLIMB, POWER, MAP (on a road), and later RACE. v2-erg's “Workout” tab is not a page. v2-ride's separate climb card is the CLIMB page.
- **D3. A capable phone may draw the world.** ADR-0066 keys this on capability, never on width, which supersedes v2-phone's “never renders 3D”.
- **D4. The world's look comes from the realism renders.** The v2/v3 mocks draw the prototype clay rider on a near-black road. The world is held to `world-*.jpg`, ADR-0072 and ADR-0073; v2/v3 stay the bar for layout.
- **D5. No stars at the start.** world-bluehour-hairpin shows stars in a peach sky, but ADR-0072 wins: stars appear only as the zenith darkens.
- **D6. The sidebar gains no sub-rows, cards, badges or icon strips** (ADR-0020, and Jan's recorded taste).
  - v2's Library / Routes and History / Progression / Collections sub-rows become tabs at the top of the content. Progression is retired.
  - The garage adds exactly one row: Garage.
  - Every such tab strip is one component, `SectionTabs`. Whichever issue needs it first extracts it from Settings' strip.
- **D7. The primary button is the kit's `btn-primary`, an ink fill.** The mocks fill primaries with neon, but neon is structure and never a filled call to action. Flipping this changes the one utility, not a call site.
- **D8. The wallet counts Batzen (ADR-0069), never kJ** as v2-summary does. The Batzen mark is an outlined round mark with a “B”. It is never shop-catalogue's filled gold coin, which reads as watt.
- **D9. Parts of the shop mocks never ship:**
  - shop-catalogue's hero banner, whose numbers are not SPEC's;
  - shop-locker's dev pills (the triangle count and “no conflicts”);
  - v3-shop's “Saved looks — five”, since SPEC has no count;
  - v2-garage's two kit colours, since #3162 says three.
- **D10. v3-events draws a Wheelrace:** four pens D–A and a predicted-finish chart. Those belong to #3172. An open ride shows one pen.
- **D11. #3274's two doors to the crew lounge stay.** v3-modes draws a one-line link instead.
- **D12. A moment card (a sprint armed or live) sits top-centre, above the corridor**, as v2-ride draws it. It does not go in the right column, where `docks.ts` puts it today.
- **D13. On a road workout (ADR-0062), +1 min and Skip block are hidden**, with a one-line hint, because the road decides where a block ends. No mock draws that state.
- **D14. PgUp and PgDn are Harder and Easier, never a page** (ADR-0071, SPEC). The mocks' “← → · PgUp PgDn” hint is not copied. The computer shows ← and → only, and any key hint on a riding surface lists only keys that are bound (#3216's keymap). #3661 is the same mistake.
- **D15. The computer's page control is the current page's name between a ← and a → button, with position dots.** This holds on every layout: world, flat, TV and phone. v3-race's row of every page name does not fit SPEC's 24 px words in a column ≤ 30 % wide. The whole panel stays a tap target (ADR-0071).
- **D16. NEXT reads describeBlock's text for the next block, on every surface.** Spellings quoted in mocks and issues (“Sprint · 15 s”, “Sprint for 15 s”) are illustrations; `describeBlock` in `lib/workout/block.ts` is the one source.
- **D17. Every number has one home** (the table below). This overrides v2-ride's RIDE page (ride time, energy, grade) and v2-erg's separate W/kg field.

## One home per number (riding surfaces)

| Number | Its one home |
|---|---|
| 3 s power | the bike computer's head, in watt, the largest number on the screen |
| W/kg | beside the 3 s power, in the head |
| the live zone | under the 3 s power, as digit and name (“Z3 Tempo”) at label size; never colour alone (#3213) |
| target track, “Block · n % on target” | under the head, only while a target is asked |
| time left, block, target, elapsed of total | slot 1, in a workout |
| km x of y, grade, next climb | slot 1's road line, on any ride with a road |
| elapsed, m climbed | slot 1's chip row, on a free ride |
| how the trainer rides it | slot 1's trainer chip: “SIM · you feel y %”, “Watts · n W”, or “ERG: the road is scenery” |
| speed | RIDE page, on a road |
| cadence; heart with its zone dot | RIDE page |
| gear | RIDE page, where gears are on (neon, as rider state) |
| vs best / vs last | RIDE page, with a ghost |
| execution; 10 s, 30 s, block average, NormPower, intensity, work, load | POWER page. POWER drops its own 3 s field while the head shows it. |

So the RIDE page holds:
- on a workout with no road: Cadence and Heart;
- on a workout on a road: Speed, Cadence and Heart;
- on a free ride on a road: Speed, Cadence, Heart and Gear, plus vs best / vs last when there is a ghost.

## Global rules: checked on every capture

**G1. The cave.**
- From the count-in to End ride, the whole frame (content and sidebar) uses the dark family (surface OKLCH L ≤ 0.30). This holds whatever the OS scheme or the theme toggle says. [probe:cave]
- TV mode, the spectator's Watch view and `/hud` are cave too.
- The setup before a ride, and the closing card or road-end card after it, are desk surfaces and follow the rider's scheme (ADR-0005, amendments #113 and #331).

**G2. What may glow, and which accent means what.**
- `--color-watt` marks live data and is the only thing that glows. On a riding surface it marks exactly three things, and nothing else — no crew-row number, no target, no second power figure: [probe:wattCount]
  - the 3 s power;
  - your position marker on the horizon: the Skyline dot, or the interval graph's cursor;
  - your trail in the world.
- `--color-neon` is structure and prescription: frames, hairlines, selected borders, the grade and record ramps, rider state (the gear) and targets. It never carries a measured reading and never glows.
- Zone tokens carry zone readings and nothing else. A line or fill in a zone colour shows the zone actually ridden there, never a fixed zone used as decoration.
- Desk surfaces glow nothing.
- Records (history, collections, class chips, progress bars) use the neon ramp.
- `danger` is its own token.
- z6, z7, danger and watt never blink.

**G3. Panels over the world.**
- **One kit, the `ride-panel` utility:** surface at 86 % opacity (floor 85 %, ADR-0071), a 1 px neon hairline at about 38 % alpha, 12 px radius, no backdrop blur and no shadow. A panel never sits inside another. [probe:panels]
- **Spacing.** Panels sit 16 px in from the canvas edges and 12–16 px apart. Panels in one column share an edge.
- **Size.** Each panel is its content's size: no empty band taller than 24 px, nothing scrolls, nothing is clipped. [probe:panels]
- **The keep-clear corridor** (x 30–70 %, y 22.5–77.5 % of the canvas; `CORRIDOR` in `lib/session/docks.ts`) holds no panel, chip or text. [probe:panels] A panel stays out of it in one of three ways:
  - it is ≤ 30 % of the canvas wide and sits against a side edge;
  - it ends above y 22.5 %;
  - it starts below y 77.5 %.
- **The world** fills its canvas edge to edge.
- **The jukebox seat** (top right, `JUKEBOX_SEAT`) has nothing drawn over it, per YouTube's terms. On a ride with no jukebox, the seat area stays empty and nothing grows into it, so the layout does not jump when a jukebox joins.
- **Ride-critical status** (trainer silent or lost, reconnecting, the socket dropped; errors.md and SPEC's `SIGNAL_LOST_MS`) is one persistent line at the top of slot 1, with at most one ≥ 44 px recovery button. It is never a toast and never in the corridor.

**G4. Legibility at the design distance.**
- The desk is 0.8 m from a 14-inch laptop; the TV is 3 m from a 55-inch set. Sizes are D1's, and a unit is at most half its number.
- Riding surfaces label with `ride-label` (≥ 24 px on the desk, ≥ 3vh on the TV). The kit's `eyebrow` (10 px) is for desk pages only.
- Numerals are `font-display` (Chakra Petch), tabular. Distance reads “x of y”.
- Every word on a riding surface is a label or a number, with one exception: a status or recovery line that canon requires. That covers G3's ride-critical status, ADR-0062's hint for a hidden control, and the Flat-road reason from `REASONS` in `lib/world/ride-view.ts`. Such a line is one line, at label size, with at most one ≥ 44 px button.
- The watts is one figure, the 3 s power, never repeated (D17).

**G5. Phone width is 375 × 812.**
- The page body scrolls down, never sideways. Measure `[data-testid=page-body]`, never the document. [probe:overflowX]
- Never put a pixel width on an SVG that is also measured.
- The primary work comes first in the stacking order.
- Tap targets: 24 px on a browse surface; 44 px (`btn-lg`, `icon-btn-lg`) for anything touched while pedalling. [probe:minTarget]
- The last item clears the floating navigation button and the browser chrome.

**G6. Motion (ADR-0079, SPEC “Motion”).**
- The camera is a tripod on a rail: no shake, bob, roll, overshoot, motion blur or speed lines. The field of view rises at most +4°. [probe:camera.fov]
- Live numbers snap, except the watts numeral's 250 ms transform glide (#3200).
- Bars settle through `transform` over `--dur-live`.
- Only results roll, and only once.
- One stage moment plays at a time.
- Durations and easings are tokens.
- Under reduced motion:
  - the world opens on Flat, with one “Show the world (steady camera)” tap;
  - every motion becomes a held stamp;
  - sounds stay.
- In a still capture, something caught mid-transition is a defect only if it shows in two captures.

**G7. The page frame (desk pages in the app layout).**
- Pages fill the content column (`page`: 16 px gutters on a phone, 32 px from `sm`), with no max-width, and are never centred. A section that would stretch too far goes multi-column at `xl`.
- `/hud` and the TV centre their block by design.
- Every section's left edge sits on the title's.
- Use the kit: one `page-title`, `eyebrow` for section labels, `panel`, `btn-*` and `input`, never a retyped class string.
- Every page has four states:
  - loading: a skeleton in the content's shape;
  - error: with a retry;
  - empty: teaches in one line, plus the button that creates the first one;
  - content.

**G8. Words and actions.**
- Use the SPEC glossary: crew, text channel, voice channel, session. Never “room”.
- No copy says a feature is coming (“arrives with”, “is coming”). A control whose precondition is absent is disabled with a one-line hint, or hidden (ux.md, capability gating). A hint never names a future release.
- A destructive action comes last, after a separator, in the danger token.
- An object with more than one action has a right-click or long-press menu. The menu is never the only way to an action.

**G9. Nothing that is not there.**
- No stand-in rider, bot or placeholder data appears on a real surface (ADR-0079).
- A world is drawn only on a ride that has a road (ADR-0066).

**G10. Privacy is visible.**
- No surface, poster or card shows a place name, route start or effort that its viewer may not see (ADR-0063, SPEC “A route's place”). Efforts marked at save within 1,000 m of a ride's ends, or hidden near a zone, are drawn nowhere public.
- Capture fixtures sit in the open South Atlantic (#3054).
- No mockup or target carries a real start place.

## Flows

A frame can pass while the screens still do not connect. Flows are sequence captures [multi:flow-*]: each step is a capture, and the checks are about continuity.

- **F1: a road, ridden.** Workouts → a route card's Ride → `/ride?road=` → 65 s → End ride → the road-end card → the route page shows the ride under Your rides. [route-row] [ride-free-road-surface] [route-page]
- **F2: a workout, ridden.** `/ride` → Workout → 65 s → End ride → the closing card → See your ride → the ride page, wearing the closing card's header and tiles. [ride-preride] [closing-card] [ride-page]
- **F3: first run.** A fresh dev account → Home's set-up card → `/ride` → pair the simulated trainer → the first ride → the closing card → Home shows it under Recent rides. [home] [ride-preride] [closing-card]

Every step of every flow must match these:
1. No step shows a disabled promise (G8) or a dead end.
2. The road or workout keeps one name, and one vocabulary, across every step.
3. One ride shows the same tiles wherever it is summarised.
4. Every Back, Done or back link lands on the screen the rider came from.

## Surfaces

The capture recipes are the design-shots spec's.

Every surface id below is also in `docs/design/surface-map.json`, which maps the files a change touches to the surfaces it draws: `node web/scripts/design-surfaces.mjs` prints them for a branch, and `web/scripts/design-surfaces.test.mjs` keeps the map and this file in step. A new surface gets a section here and a row there in the same change.

- The desk is 1440 × 900.
- “Phone” means 375 × 812 with touch.
- “World on” means the device's World control at Full: the `wattroom.world-slot.v1` flag until #3214 replaces it. Every world surface also asserts that the world mounted and did not fall back; otherwise the shot is FAILED. [probe:world]

### A. Riding surfaces (the cave)

#### ride-road-world

**Capture:** world on, `/ride?w=openers&road=<hairpin>&from=0`, simulated trainer, 14 s in. Shot at 1440 × 900 and 1920 × 1080.

**Targets:**
- v2-ride: layout and panel kit. The mock's CSS is `--hud: rgba(10,1,24,.86)` and `--hud-line: rgba(139,43,255,.38)`, with a 12 px radius and 16 px insets.
- v2-erg: slot 1 and the computer in a workout.
- v3-motion: its count-in frame is the slot map.
- v3-race: the computer's panel, with D15 applied.
- World look: world-realism-tier3, world-kom, world-bluehour-hairpin.

**Canon:**
- ADR-0046 (amendments #3062, #3063), ADR-0066, 0071, 0072, 0073 and 0079.
- SPEC: “The bike computer”, “The world”, “Motion”.

**Must match: layout**
1. The PR records its box table in this section before the layout is built: every panel's x, y, w and h at 1440 × 900 and at 1920 × 1080, with the SPEC size each one holds. [ride-surface]
2. The world canvas fills the riding column edge to edge, with no dark margin. [ride-surface]
3. Every panel is the `ride-panel` kit (G3), and none is nested. [ride-surface] [probe:panels]
4. Insets and edges.
   - Insets are 16 px and gaps are 12–16 px.
   - The computer and the Skyline share one left edge, and so does slot 1 when it sits in the left column.
   - The seat, the crew panel and the Skyline share one right edge.
   [ride-surface]
5. Panels are content-sized: nothing is clipped or scrolls, and no empty band exceeds 24 px. Cadence, heart and the bias trim are visible and reachable. [ride-surface] [probe:panels]
6. Slot 1 is one panel at the top left, outside the corridor.
   - Its shape is whichever the box table shows holding SPEC's sizes: a wide band that ends above y 22.5 %, or a column ≤ 30 % wide above the computer.
   - It opens with a `ride-label` eyebrow: mode · workout or road · riders.
   - Then v2-erg's work panel:
     - time left ≥ 72 px, with “Block n of m · name”, “Target W · range” and “elapsed of total”;
     - the interval strip with its cursor;
     - NEXT (D16) with the 3-2-1 chips;
     - the trainer chip.
   - On a road, the road line “km x of y · grade % · <climb> in z km” appears once, here.
   [ride-surface]
7. The ride's controls are one row inside slot 1.
   - ⚑, TV, +1 min and Skip block are ≥ 44 × 44 px icon buttons with accessible names and tooltips.
   - End ride is the one text button.
   - +1 min and Skip block show only where the rider owns the clock (D13).
   - There is no separate controls panel.
   [ride-surface] [probe:minTarget]
8. Persistent status (G3) is one line at the top of slot 1, with its one recovery button. It never covers the corridor. [ride-surface] [multi:ride-status]
9. The bike computer is one panel at the bottom left, ≤ 30 % wide, directly above the Skyline. From the top:
   - the page control (D15): ← name →, with dots, the arrows ≥ 44 px;
   - the head: the 3 s power in watt (≥ 104 px), W/kg beside it, and the live zone as digit and name under it;
   - while a target is asked: the target track (low · target · high, with a needle) and “Block · n % on target”;
   - the page's fields, per the one-home table, in a grid under a hairline.
   [ride-surface]
10. The only watt marks are the three G2 lists: one power figure, your Skyline dot and your trail. [ride-surface] [probe:wattCount]
11. The Skyline runs the full width along the bottom and is taller than 56 px.
    - The ridden part is ink or muted, never a fixed zone. The road ahead is neon.
    - Your dot sits wholly inside the panel.
    - On a workout, the block band runs beneath the line (v2-erg).
    - Place labels sit above the line where the road has named places [#3134]. The hairpin fixture has none, so that part is OPEN-ELSEWHERE.
    [ride-surface]
12. The corridor is clear. Your figure sits in `RIDER_BOX` (docks.ts: x 40–60 %, y 55–82 %; its foot reaches below the corridor by design), unobstructed. [ride-surface] [#3215] [probe:panels]
13. A moment card sits top-centre, between slot 1 and the seat, above the corridor. Its border is watt while live (D12). [ride-surface] [multi:ride-session-road]
14. No key hint names PgUp or PgDn (D14). [ride-surface]
15. The cave covers the frame, sidebar included. [ride-cave]

**Must match: world**

16. The world's road is this ride's road.
    - The hairpins climb ahead. There is no flat valley straight and no church village.
    - At “km 0.0 of 7.1”, your figure stands at the start.
    - Your figure's km matches the Skyline dot.
    [3663-world-is-your-ride] [probe:world]
17. A solo ride holds one figure, yours, with one ring. There are no bots. [3663-world-is-your-ride]
18. The sky.
    - Its top third is cool blue-lavender, with blue the highest channel, darkening upward.
    - A thin peach band sits on the horizon: OKLCH hue 58–60°, at least 40° from every dark identity's watt, and no taller than about a tenth of the visible sky.
    - Nothing is brown-mauve or pink.
    - There are no stars at the start.
    [3085-ride-light]
19. There is no warm key light and no cast shadow. Shading is soft and cool, from the sky. [3085-ride-light]
20. Distant ridges are opaque, paler and bluer with distance. There are no translucent pink layers and no white stripes. [3085-ride-light]
21. The road.
    - The near asphalt is a cool dark grey, about rgb 30–40 / 32–42 / 45–60 (tier3 samples 33,36,53), with fine grain, and never black. [probe:asphaltRgb]
    - Off-white edge lines and a dashed centre line are painted flat.
    - A lighter gravel shoulder runs outside the edge line, then a green-grey verge.
    - White posts with a black band stand in a steady rhythm to the vanishing point.
    - The grain holds still under the moving camera. [multi:world-drift]
    - Snow poles belong to #3184.
    [world-road-surface]
22. Conifer stands frame the road within 10–30 m, and their crowns cross the horizon line. [multi:world-60s] [world-forest]
23. Your figure is ADR-0073's, on a drop-bar road bike with spoked wheels: kit, helmet and glasses, and no face. Every kit passes the wardrobe's colour guard (`lib/world/placement/safety.ts`, `wattHueBandDeg` in catalogue.json). [world-figure]
24. Framing.
    - The figure fills 20–30 % of the canvas height. [probe:figure.bboxH]
    - The horizon sits about 40–45 % from the top.
    - The field of view never rises more than 4° over its base. [probe:camera.fov] [multi:world-drift]
    [3211-camera]
25. One thin, flat ring lies under your wheels, in your live zone colour, with no halo. Its band width is the one that SPEC “The world” records. [probe:ring.bandM] [3086-names-ring]
26. Your trail is the only glowing or additive element. It is a thin line about a wheel wide, fading out within a short fixed length behind you. It is never a wedge or a fill. [3663-world-is-your-ride]
27. On real ground, the frame carries the map and height credits. [#3133]

#### ride-workout-world

**Capture:** world on, `/ride?w=openers`, with no road. This is a negative check.

**Canon:** ADR-0066.

**Must match**
1. No world canvas mounts, and the capture has ride-workout-flat's layout. [3663-world-is-your-ride] [probe:world]
2. No figure, ring, trail or synthetic pass appears anywhere. [3663-world-is-your-ride]
3. There is no Flat-road line, because nothing fell back. [3663-world-is-your-ride]
4. The cave covers the frame.

#### ride-workout-flat

**Capture:** world off, `/ride?w=openers`, 14 s in. A second frame shows the watts at four digits: the spec drives the simulated trainer past 1,000 W.

**Targets:** v2-erg (the work panel and the computer), and v2-ride's “Flat road” inset.

**Must match**
1. Every slot is a `ride-panel`, and nothing floats unframed. [ride-flat]
2. Slot 1 is one full-width panel.
   - Left: time left ≥ 72 px, with the block, the target, and elapsed of total.
   - Right: the interval strip with its cursor, then NEXT (D16), the 3-2-1 chips and the ERG chip, all on one line.
   [ride-flat]
3. The controls are one row inside slot 1, as ride-road-world item 7, flush with the panel's inner right edge. [ride-flat]
4. The head follows ride-road-world item 9: one watts figure ≥ 104 px, W/kg beside it, the zone as digit and name, and the track while a target is asked. [ride-flat]
5. The RIDE page's fields follow the one-home table (a workout with no road: Cadence, Heart). They sit in the same panel as the head, with no gap wider than about 48 px, and the page control (D15) sits in that panel's header row. [ride-flat]
6. The bias trim sits inside that panel, and each of its buttons is ≥ 44 px. [ride-flat]
7. The interval graph is a full-width panel along the bottom, ≥ 112 px tall. Its FTP label is at `ride-label` size, or it is dropped. [ride-flat]
8. The numbers panel takes the free height, and no band between panels exceeds 16 px. [ride-flat]
9. At four digits, the numeral stays inside its panel and covers no other text. [multi:four-digit] [ride-flat]
10. Persistent status follows G3. [multi:ride-status] [ride-flat]
11. The cave covers the frame.

#### ride-skyline-fallback

**Capture:** world on, a road ride forced onto the Skyline; then again under `reducedMotion: 'reduce'`.

**Target:** v2-ride's “Flat road” inset.

**Must match**
1. ride-workout-flat's items hold, with the Skyline in the horizon panel at full width and the dot inside it. [ride-flat]
2. The Flat-road line is `REASONS`' line for the reason (`lib/world/ride-view.ts`), not new copy.
   - It sits at the top of slot 1, at `ride-label` size.
   - “Try 3D again” appears where `REASONS` offers a retry.
   - Wording changes go through #3212.
   [ride-flat]
3. Under reduced motion, the line is `REASONS.motion`'s, with one “Show the world (steady camera)” button that sets Steady (ADR-0079). [#3214] [multi:reduced-motion]

#### ride-status

**Capture:** ride-road-world and ride-workout-flat, with the simulated trainer silenced past `SIGNAL_LOST_MS`.

**Canon:** errors.md; SPEC “Sync tolerances”.

**Must match**
1. The fault is one persistent line at the top of slot 1, with one ≥ 44 px recovery button. It is not a toast, and nothing enters the corridor. [ride-surface] [ride-flat]
2. The numbers read as stale (“—”), and nothing stale keeps its watt or its glow.

#### ride-countin

**Capture:** world on, `/ride?w=openers&road=<hairpin>`, captured during the count-in.

**Target:** v3-motion, the count-in frame.

**Must match**
1. The cave holds from the count-in's first frame. [ride-cave]
2. The slots are already in their places, as v3-motion draws them. During the count-in, the one digit is the only thing in the corridor. The dock-in motion belongs to #3087. [ride-surface]

#### ride-free-road

**Capture:** world off, `/ride?road=<hairpin>`, 14 s in, with the OS scheme set to light.

**Targets:** v2-ride; v3-modes for the feel line.

**Canon:** ADR-0005, ADR-0046 (parity), ADR-0062, ADR-0084.

**Must match**
1. The cave holds from the first stroke to End ride, with the OS in light mode. [ride-cave] [probe:cave]
2. The screen is the flat riding surface, in `ride-panel`s, filling the column. There is no centred block. [ride-free-road-surface]
3. Slot 1 is the road line, in this order:
   - “FREE RIDE · <road>”;
   - “km x of y · grade · <next climb> in z km”, at display size;
   - the trainer chip: “SIM · you feel y %” or “Watts · n W”;
   - “elapsed · m climbed”.
   [ride-free-road-surface]
4. The road name, gear, grade and watts each appear once (D17). [ride-free-road-surface]
5. There is no 0–300 W track and no “no target — spin easy”. [ride-free-road-surface]
6. The RIDE page follows the one-home table: Speed, Cadence, Heart, Gear where gears are on, and vs best / vs last when there is a ghost. [ride-free-road-surface]
7. Road | Watts, Easier and Harder are ≥ 44 px, in slot 1's row beside ⚑, TV and End ride. [ride-free-road-surface]
8. There is no teaching sentence (G4) and no hint naming keys that are not bound (D14). [ride-free-road-surface]
9. At 1440 × 900 the Skyline is on screen, full width, with the dot inside it. [ride-free-road-surface]
10. Carrying on next time is offered on the road-end card, not while riding. [ride-free-road-surface]

#### ride-free-road-world

**Capture:** world on, `/ride?road=<hairpin>`, 14 s in.

**Targets:** v2-ride; v3-roads (the in-ride frame); world-realism-tier3.

**Must match**
1. The world draws in slot 2, so the capture differs from ride-free-road. [ride-free-road-surface] [probe:world]
2. ride-road-world's layout items 2–15 hold, with ride-free-road's road line as slot 1. [ride-surface] [ride-free-road-surface]
3. ride-road-world's world items 16–27 hold, under their own tags.
4. Easier and Harder stay reachable at ≥ 44 px while the world shows. [ride-free-road-surface]

#### ride-free-road-ghost

**Capture:** as ride-free-road-world, after a seeded earlier effort on the same road. The ghost issue adds this surface.

**Targets:** v3-roads, world-ghost.

**Canon:** ADR-0068; SPEC “Road segments and ghosts”.

**Must match**
1. A ghost is your figure in your own kit, drawn see-through, and it reads clearly lighter than a live rider. [3245-ghosts]
2. A ghost has no name tag, ring, shadow, trail or glow. At most three show, and they are drawn in one instanced draw. [probe:renderer.draws] [3245-ghosts]
3. No ghost appears in an ERG workout, a session, a bunch, a race, a game or a tow. [test:ghost placement] [3245-ghosts]
4. A faded live rider (#3227) is never drawn like a ghost. [multi:ride-session-road] [3245-ghosts]

#### ride-road-end

**Capture:** ride-free-road, then End ride.

**Must match**
1. This is a desk surface: it follows the rider's scheme, and the frame leaves the cave. [ride-cave]
2. “Carry on from km x next time” is offered here, as one button. [ride-free-road-surface]
3. The road's name links to its route page (F1). [route-page]

#### ride-session-road

**Capture:** two dev riders (Designer and a second rider whose name is letters only) in one crew's voice channel, riding a session on the hairpin road with the world on, a sprint armed and the jukebox seated. The mixer is muted.

**Targets:** v2-ride (the bunch panel, the moment card, the seat); v2-erg.

**Must match**
1. The crew panel sits under the seat in the right column, about 18 % wide. Its rows are ≥ 44 px, your row is tinted neon at about 16 %, and no crew number is in watt. [ride-surface]
2. The moment card sits top-centre; its border is watt while live. [ride-surface]
3. The seat is clear, with the now-playing line directly under it at the seat's width. [ride-surface]
4. Name tags:
   - small dark pills with a hairline, only over the two nearest riders and anyone speaking;
   - they merge when they would overlap;
   - never in the lower half of the corridor.
   [3086-names-ring]
5. A crewmate's ring shows only where you may see their numbers (ADR-0059). [3086-names-ring]

#### ride-session-flat

**Capture:** as ride-session-road, but on a session with no road.

**Must match**
1. ride-workout-flat's items hold in the session's Training place. [ride-flat]
2. The crew's rows are ≥ 44 px, and no crew number is in watt (G2). [ride-flat]

#### ride-channel-free

**Capture:** the voice channel's free ride (`lib/ride/FreeRide.svelte`), world off.

**Must match**
1. ride-free-road's items 2–9 hold if the channel's free ride shares the road ride's component; otherwise the follow-up issue that design/ride-free-road-surface files owns them. [ride-free-road-surface]
2. The cave covers the frame.

#### ride-ramp

**Capture:** `/ramp`, simulated trainer, 14 s in.

**Canon:** ADR-0046 (it is a riding surface).

**Must match**
1. The riding panel kit and the one-home table hold: ride-workout-flat items 1–8. [ride-flat]
2. The cave covers the frame.

#### ride-tv

**Capture:** world on, `/ride?w=openers` (no road, so the flat TV), TV pressed, 1920 × 1080. The TV with a world belongs to #3091.

**Targets:** v2-erg, and v2-ride for the kit.

**Canon:** SPEC's TV sizes; ADR-0046.

**Must match**
1. The 3 s power is the one watts figure, ≥ 12vh, in watt. The numbers row carries cadence and heart, not power. [ride-tv]
2. Nothing is under 2.9vh, including the exit hint, the scale's 0 / 300 and the FTP label. [ride-tv] [test:tv-legibility.test.ts]
3. The exit control is ≥ 44 px, sits in the top row beside the title and clock, and overlaps nothing. [ride-tv]
4. The top half has no empty region wider than a quarter of the screen. [ride-tv]
5. Time left is ≥ 9vh. NEXT is describeBlock's text (D16), never “0 W”. [ride-tv]
6. The zone reads as digit and name inside the numbers panel, in its row. [ride-tv]
7. Secondary numbers are ≥ 5vh, and a unit is at most half its number. [ride-tv]
8. Every block is a `ride-panel`, one level deep. The page control follows D15. [ride-tv]
9. The interval graph is a full-width panel along the bottom, clear of every control. [ride-tv]
10. The cave covers the frame, and there is no sidebar.

#### ride-watch

**Capture:** the crew session's Watch view (`/crew/<id>/s/<session>/watch`) while a second dev rider rides; desk and phone.

**Must match**
1. The cave covers the frame (G1).
2. Only the followed rider's trail and dot glow (ADR-0072), and nothing else is in watt.
3. At 375 nothing scrolls sideways.

#### phone-ride

**Capture:** phone, world on, `/ride?w=openers`.

**Target:** v2-phone, the third phone (“Riding”), with D3 applied.

**Must match**
1. The surface is one column of full-width `ride-panel`s in ADR-0046's slot order, with 16 px gutters and about 10 px between panels. Nothing docks over anything. [ride-phone]
2. Slot 1 is uncut: “Block n of m · name”, time left, “Target W · range” and NEXT (D16). [ride-phone]
3. The head is centred. The 3 s power, in watt, is the largest number on the screen, and time left is the second largest. W/kg and the zone sit on one line under the power, and there is no other watts figure. The sizes follow the phone row the PR adds to SPEC (D1). [ride-phone]
4. The horizon runs full width. [ride-phone]
5. Controls are full-width rows of equal buttons, ≥ 44 px tall. No label wraps, and the ⚑ is visible without scrolling inside a panel. [ride-phone]
6. With no road, there is no world. [3663-world-is-your-ride]
7. The floating navigation button covers no panel, and the page scrolls down only. [ride-phone] [probe:overflowX]
8. The cave covers the frame.

#### phone-ride-road

**Capture:** phone, world on, `/ride?road=<hairpin>`.

**Must match**
1. Slot 1 is the road line, with the trainer chip. [ride-phone]
2. On a capable phone, the world is a band in slot 2's place, between slot 1 and the numbers, with nothing over it. [ride-phone] [probe:world]
3. On a climb, the CLIMB page panel shows:
   - “CLIMB n OF m”;
   - the class chip;
   - to the top, left and average;
   - the grade-ramp profile with your dot.
   [ride-phone] [#3645]
4. The Skyline runs full width. [ride-phone]

#### hud, hud-shell

**Capture:** `/hud` in a second page while a road free ride runs:
- `hud-shell` at 320 × 132, the desktop shell's window;
- `hud` at 1440 × 900, ADR-0041's second-screen tab.

**Target:** v2-phone's Team-car card, as the language for a compact numbers card.

**Canon:** ADR-0041.

**Must match**
1. At 320 × 132 nothing changes. The shell shows:
   - the label row, with the clock at its right;
   - the watts in watt, with the target beside it when there is one;
   - on a road, the grade line and the next-2 km bars;
   - nothing clipped.
2. In a large window the same block scales as one centred unit. The watts is the largest element, about a quarter of the window's height, and words follow the HUD row the PR adds to SPEC (D1). [ride-hud]
3. On a road ride, the label reads “FREE RIDE · <road>”. [ride-hud]
4. Only the watts glows. The grade bars use the Skyline's grade ramp.
5. The cave's surface fills the window. The waiting and signed-out states scale the same way. [ride-hud]

#### ride-preride (a desk surface)

**Capture:** world off, `/ride`, with and without a remembered road, in both schemes.

**Target:** v3-modes, the “/ride, alone” column.

**Canon:** ADR-0062; ADR-0020's amendment, “Pages fill the column”.

**Must match**
1. The first thing under the title is two tiles, “Free ride” | “Workout”.
   - Each shows its name at display size, with one line under it: “You drive the trainer. Hold a grade, or hold your watts.” / “The plan drives it. Last: <workout>.”
   - The chosen tile has the neon border.
   [ride-preride]
2. In the same card:
   - the eyebrow ROAD, then the road's name;
   - “your last road”, when it is the remembered one;
   - the buttons “Change” and “No road”.
   [ride-preride]
3. With a road chosen:
   - the ways to ride it are chips on one line, showing only those that exist, with one selected in neon;
   - then “Feel: road x %, you feel y %”.
   [ride-preride]
4. With Workout chosen, the workout's name, duration and interval preview show. [ride-preride]
5. Content starts at the top left and runs the column's width, with no centred block. [ride-preride]
6. “Start the ride” is the primary button, ≥ 44 px. It stays disabled, with its one-line reason, until a trainer is paired.
7. Tiles, chips and buttons are ≥ 44 px tall. [ride-preride]
8. The page follows the rider's scheme. In dark, its cards are surface-raised with a hairline.
9. Solo games are one line in the card. [ride-preride]

#### ride-roadpick

**Capture:** `/ride` with “Change” opened, with the hairpin and the rolling route seeded.

**Target:** v2-routes, the rail rows.

**Must match**
1. Every road is the shared route row: name, class chips, stat line and story line. The name links to the route page. [route-row]
2. The empty state is one line, “Your roads ride here — import a GPX, TCX or FIT.”, plus an “Import a route” button. [route-row]

### B. The world's look

#### dev-world

**Capture:** `/dev/world`, 9 s in, 1440 × 900. Superseded by world-start and world-end once design/world-moment lands.

**Targets:** world-bluehour-hairpin, world-realism-tier3, world-kom; v2-ride for the names.

**Must match**
1. The “Alpine blue hour” look is ADR-0072's ride light, as in ride-road-world items 18–20. The colours are an app.css token family, so the gallery shows what a rider sees. [3085-ride-light]
2. The road is as in ride-road-world item 21. Orange snow poles belong to #3184. [world-road-surface]
3. Forest stands grow close to the road, with no single cones on bare meadow. Houses sit in small clusters. [world-forest]
4. The dev crew rides as ADR-0073 figures in distinct kits. [world-figure]
5. Names show over the two nearest riders and anyone speaking. Rings are thin and flat. [3086-names-ring]

#### world-start, world-end

**Capture:** `/dev/world?m=<metre>&p=0|1&cam=chase&look=bluehour&chrome=0`, at 1440 × 900 and 1280 × 720.

**Must match**
1. Two loads of the same URL give an identical frame. [world-moment] [multi:world-start-twice]
2. With `chrome=0`, no dev chrome shows. [world-moment]
3. At p=0 there are no stars. At p=1, stars show only in the dark upper sky, never in the peach band, and the light is visibly darker. [3085-ride-light]

### C. Roads library (desk)

#### workouts, phone-workouts

**Capture:** `/workouts` with the hairpin and the rolling route seeded. The whole page body, desk and phone, in both schemes.

**Targets:** v2-routes, v3-roads (“Your roads”), v2-collections (the rhythm).

**Must match**
1. The title and subline sit at the top left. The search box:
   - has its own row, at most about 420 px wide;
   - reads “Find a workout or a route”;
   - filters routes too.
   [workouts-page]
2. Every shelf opens with one header row: the eyebrow at the left, and the shelf's doors at the right on the same baseline (`btn-ghost btn-xs`, ≥ 28 px). [workouts-page]
3. Each door appears once. On an empty shelf the doors live only in the empty state. [workouts-page]
4. An empty state is one line plus its button, with no “Nothing yet.” [workouts-page]
5. Sections are 32 px apart; each eyebrow sits 8 px above its content. [workouts-page]
6. Route cards use the workout cards' grid, panel, radius and frame. [route-row]
7. A route card's name is display face, bold, 16 px, and truncates.
   - Class chips (Roman numerals) sit at its right, the hardest filled neon.
   - An owner-only route carries the lock chip “Only you”.
   [route-row]
8. The card's second line reads “7.1 km · 571 m · 1 climb”, muted. [route-row]
9. The third line is one of: “Not ridden yet”, “Ridden 3× · last 29 Sep”, or “Left off at km 21.3”. [route-row]
10. The card's actions:
    - Ride (`btn-primary btn-xs`) at the bottom right, reading “Carry on” when there is somewhere to carry on;
    - the rest of the card opens the route page;
    - the context menu offers Ride it and Open, then a separator, then Delete in the danger token.
    [route-row]
11. On a phone the order is: title, search, Your workouts, Your routes, Measure, Curated. Nothing scrolls sideways. [workouts-page]

#### route, phone-route

**Capture:** `/workouts/routes/<id>` for the hairpin and for the rolling route (≥ 2 classed climbs, a descent and a flat). The whole page body, desk and phone, in both schemes.

**Targets:** v2-routes (the How column); v3-roads (the stat row, your times); v2-summary (the climbs table).

**Canon:** ADR-0063; SPEC's route, place and segment sections.

**Must match**
1. The header:
   - “← Workouts” in xs muted text, over the name as `page-title`;
   - one stat row in the display face: km, m climbed, classed climbs, and loop or point to point.
   [route-page]
2. At ≥ 1024 px there are two columns. The road is on the left; a How column of about 300 px is on the right, top-aligned with the first drawing. [route-page]
3. At 1440 × 900, the title, stats, shape, profile, How and the primary button show without scrolling. [route-page]
4. How is a stack of hairline rows, each with an icon, a label and one line. The selected row has a 1 px neon border.
   - “Ride it” [route-page]
   - “Workout on it” [route-workout-on]
   - “Plan it for a crew” [route-plan-crew]
   A row exists only once its flow works; there is never a disabled promise.
5. Which-stretch chips are ≥ 28 px, with the selected chip in a neon border.
   - Whole road.
   - From km X, only when there is somewhere to carry on.
   - One climb, only when the road has a classed climb.
   [route-page]
6. There is exactly one primary: `btn-primary btn-lg`, the column's full width, enabled. Ride it opens `/ride?road=<id>&from=<m>`. [route-page]
7. “arrives with” appears nowhere. [#3660]
8. On an owner-only route, the title carries “Only you”, and Plan it for a crew is absent. [route-plan-crew]
9. The shape sits in a fixed-height panel, about 280 px on the desk and 220 px on a phone.
   - The line is neon, 2.5–3 px, with classed climbs overpainted in the grade ramp.
   - It has a start dot, a finish ring, and circled km ticks.
   - “Only you see this map” sits inside the panel's bottom-left corner.
   [road-drawing]
10. The profile is a panel.
    - Its area is filled step by step with `--color-grade-1…5`.
    - A Roman class badge (neon fill, on-neon text) sits above each climb's top.
    - km run along the bottom; the top and bottom heights sit at the right.
    - The legend reads 0 · 3 · 6 · 9 · 12 %+.
    - There is no translucent rectangle.
    [road-drawing]
11. The climbs are one table: class chip, length and average %, gain, “top at km”, and your best or “—”.
    - Numerals are right-aligned, and each climb is listed once.
    - Climb names come from #3136; the fixture's climbs carry generated names until then.
    [route-page]
12. Your rides: Best and Last lines, each with a date and each linked to its ride. With no rides, one teaching line. [route-page]
13. Rename (at most about 480 px), the privacy line (once) and Delete (`btn-danger`) come last, under one divider. [route-page]
14. The phone order is: back link, title, stats, primary, How, stretch, profile, shape, climbs, rides, rename, privacy, Delete. The drawings are `width="100%"`, and the table scrolls in its own box. [route-page] [road-drawing]
15. There is no watt, glow, shadow or blur anywhere.

#### import-idle, import, import-saved

**Capture:** `/workouts/import` idle; then after the hairpin GPX is read; then after Save. Desk and phone.

**Targets:** v2-routes (the dashed drop card, idle only); v2-summary (stat tiles).

**Must match**
1. The header reads “Import a workout or a route”, with a subline naming .zwo and .erg, and .gpx, .tcx and .fit. With `?as=route` it reads “Import a route”. [importer]
2. The dashed border shows only while idle, or while dragging (then neon dashed on `bg-neon/5`). Once a file is loaded, the preview is a solid panel. [importer]
3. The panel's first row has a file icon, the file name in mono xs, and “Choose another file” as a ghost button at the right. [importer]
4. The name is an object title, with the route page's stat row. The shape and profile are the shared drawings, and the shape fills its panel. [importer] [road-drawing]
5. “At your pace” and “At the reference pace” are two stat tiles. “What we fixed” shows only when something was fixed. [importer]
6. The action row:
   - “Save to my routes” (`btn-primary btn-lg`);
   - “Ride it now” (`btn-secondary btn-lg`), enabled;
   - “Plan it for a crew”, which links to the session picker once design/route-plan-crew lands and is absent until then.
   [importer]
7. After Save, a banner reads “<name> is on your routes.”, with Open it and Ride it, plus “Import another file”. Nothing says a feature “is coming”. [importer]
8. The privacy line appears once. On a phone the actions stack full width, primary first. [importer]

#### routes

**Capture:** `/workouts/routes` and `?r=<id>`, at 1440, 1280, 1024 and 375 px wide.

**Target:** v2-routes, the whole frame except its sidebar (D6).

**Must match**
1. `SectionTabs` “Workouts · Routes” sits at the top left of the content. The sidebar is unchanged. [routes-view]
2. “Routes” is the `page-title`. Source tabs show only where they have data. “Import a route” is a `btn-secondary` at the top right. [routes-view]
3. Filter chips for distance, ascent, and time at your pace. [routes-view]
4. At ≥ 1280 px, three columns:
   - a rail of about 240 px made of route rows, with the selected row in a neon border;
   - the road, drawn with the shared drawings;
   - the How column.
   [routes-view]
5. The selection lives in `?r=`. The route page's back link reads “← Routes”. [routes-view]
6. The rail ends with a dashed card, “Drop a GPX, TCX or FIT”, and the privacy line. [routes-view]
7. At 1024–1279 px, the rail and the road, with How under the road. At 375, the rail only. [routes-view]
8. All four states render, and the empty state teaches in one line. [routes-view]

### D. After the ride (desk)

#### closing-card, closing-card-road, closing-card-session

**Capture:** a simulated ride of ≥ 65 s, then End ride. Taken as a workout ride, as a road ride, and as a two-rider session. Desk and phone, in both schemes, plus once with reduced motion.

**Targets:** v2-summary (layout); v3-motion (the end state).

**Must match**
1. The card spans the content column, with no max-width and no centred box. [closing-card]
2. The header is `RecapHeader`:
   - an eyebrow reading “<WEEKDAY> · <RIDE KIND> · SOLO|<CREW>”;
   - the title below it, about 26 px bold, in the display face;
   - no logo.
   [closing-card]
3. The actions sit on the header row, right-aligned. Secondary actions come first; Done is last and is the only filled button. Each is ≥ 44 px. [closing-card]
4. At 1440 × 900, the header, the actions and the first tile row show without scrolling. [closing-card]
5. At ≥ 1280 px, two columns with a 16 px gap and aligned tops.
   - Left, 470 px: the trace over the zone bar, or on a road, the map over the profile.
   - Right: everything else.
   [closing-card]
6. The tiles are `RecapTiles`, 3 × 2, about 58 px tall, each with an eyebrow label, a 24 px display-face value and a smaller muted unit.
   - The labels and their order match the ride page's.
   - A missing value drops its tile; it never shows 0.
   [closing-card]
7. Section labels are eyebrows with no icons. The trace uses zone tokens, with a dashed neon FTP line. There is no watt and no glow. [closing-card]
8. A medal never pushes the actions or the tiles below the fold. [closing-card]
9. On a road ride:
   - the map shows the ridden trace in zones, with climb labels such as “III · 11:06”;
   - the profile is about 120 px tall, with the climbs labelled;
   - the climbs table has CLIMB, CLASS, TIME, W/KG, VAM, TRY and VS BEST;
   - “BEST −0:18” appears in the ok token only where SPEC's PB-highlight rule allows (≥ 35 m of gain, at most 3 per ride).
   [3141-road-recap]
10. The right column keeps a place for the crew climb board [#3147] and for photos [#3230]. [3141-road-recap]
11. On the rider's own card only, a wallet panel at the bottom right shows:
    - WALLET, with the outlined Batzen mark;
    - “+48 Batzen · now 1,284”;
    - the wish line, over a 6 px neon bar;
    - “<n> Batzen to go, about <n> rides like this one”.
    [3158-wallet-panel]
12. On a session's card, the same frame grows a roster section, and no other rider's number is in watt (ADR-0046). [closing-card]
13. On a phone the card is one column: header, actions, tiles, the left column's content, then the rest. Under reduced motion, the finished card appears at once. [closing-card] [multi:reduced-motion]

#### ride-detail

**Capture:** `/history/<seeded id>`, desk and phone.

**Target:** v2-summary.

**Must match**
1. The header is the closing card's `RecapHeader`. [ride-page]
2. The actions are one row: Share, “Download the poster”, Export, then a separator, then Delete last in danger. Delete is also the last item in the context menu. [ride-page]
3. The same `RecapTiles` sit directly under the header. The road section reuses the closing card's grid. [ride-page] [#3140]
4. On a phone the page is one column, and the actions wrap with Delete last. [ride-page]

#### poster

**Capture:** `/api/rides/<id>/card.png` for a road ride, 1080 × 1080.

**Target:** v2-summary's profile.

**Must match**
1. The profile fills the middle band, in zone ink.
2. Each timed climb has a summit tick labelled “<class> <name> · <time>”.
   - Labels never overlap; when two would, the later one drops its name.
   - Climb names are #3136's.
   [poster-climbs]
3. km ticks every 10 km, and a small height credit at the bottom. [poster-climbs]
4. No effort that was marked at save or hidden near a zone is labelled, and no place name its audience may not see appears (G10). [poster-climbs] [test:internal/og]
5. The poster is its own dark picture in both schemes, and nothing on it glows.

#### history, history-rides

**Capture:** `/history` with no ride, and with one seeded ride. The whole page body, desk and phone.

**Target:** v2-collections (the header; the tabs follow D6).

**Must match**
1. “Rides” is the `page-title`, with its subline. Directly under it, `SectionTabs` reads “Rides · Collections”, left-aligned with the title. [collections]
2. The sidebar keeps one Rides row, lit on both tabs.
3. The empty state is a dashed box across the full width, with one line plus “Ride solo”.
4. On a phone the tab strip fits on one line.

#### collections

**Capture:** the Collections tab after one seeded road ride, desk and phone.

**Target:** v2-collections.

**Must match**
1. The header: the `page-title`, a lock icon, and “Only you see these numbers”. [collections]
2. Three equal cards:
   - EVEREST LADDER: Everest 8,849 m, Stratosphere 50,000 m and Kármán line 100,000 m, each as “<done> of <target> m” over a 6 px bar [collections];
   - CLIMBS BY CLASS: HC and I–IV [collections];
   - REGIONS AND CONSISTENCY: Cantons “n of 26” and Eddington “E = n” [3145-explorer].
3. The explorer map takes 2/3 of the width.
   - z14 tiles, with ridden tiles in neon at about 60 %.
   - The largest square is outlined, and the ridden line is ink.
   - A caption box at the top left, and the tile credit at the bottom right.
   - Only what was ridden is drawn.
   [3145-explorer]
4. The col book has eight columns of stamps, each with the height, the name and “3× · best 44:36”.
   - The latest stamp is foil.
   - A pass not yet ridden is dashed at 50 %.
   [3143-col-book]
5. Everything uses the neon ramp: no zones, no watt, no glow. The word “Everesting” never appears. [collections]
6. Before the first road ride, each card is one teaching line. On a phone the cards stack, the map scrolls in its own box, and the col book has two columns. [collections]

### E. Home, settings and the landing page (desk)

#### home, phone-home

**Capture:** `/home` for Designer, in one crew with two sessions planned this week. Desk and phone, in both schemes.

**Targets:** v3-events (the week list); v2-summary (the tiles). There is no Home mock, so this list is the bar.

**Must match**
1. The page fills the column, and every section starts on the title's left edge (x = 272 at 1440 px). [home]
2. The order is:
   - greeting;
   - one action row;
   - the set-up card, only while steps remain, with the Crew Tour (#3279) beside it where shown;
   - four tiles;
   - This week.
   The desktop-app notice comes last. [home]
3. At 1440 × 900, the This week heading and its first row show without scrolling. [home]
4. “Start a crew” appears once in the main column, and the action row has exactly one filled button. [home]
5. At ≥ 1024 px, four equal tiles: an eyebrow, a value at 24–28 px in the display face, and a muted unit on the value's baseline. No neon or watt units, and nothing glows. [home]
6. At ≥ 1280 px, two equal columns: This week on the left; Around right now above Recent rides on the right. [home]
7. The week list:
   - day headers are eyebrows, and today's reads “<DAY> · TODAY”;
   - the time sits in a fixed column of about 56 px;
   - each row has a kind eyebrow, a title, a muted meta line and a right-aligned count;
   - past rows are dimmed;
   - a session running now shows an ok-token dot and “· RIDING NOW”;
   - rows are ≥ 44 px, and the whole row is the link.
   [home-week]
8. With nothing this week, the next planned session shows under NEXT. With nothing at all, one teaching line and a link to a crew's Schedule. [home-week]
9. On a phone the tiles go 2 × 2 and the columns stack. The action buttons are ≥ 44 px, and nothing scrolls sideways. [home]

#### appearance, appearance-advanced

**Capture:** `/settings/appearance`, the whole page body; again with Advanced open; again under reduced motion. Desk and phone, in both schemes.

**Target:** none drawn. The bar is ADR-0079's table and the Settings kit.

**Must match**
1. One fixed-width label column, so every row's first control starts at the same x. [appearance]
2. The theme eyebrow reads “THEME · LIGHT” or “THEME · DARK”. “White” appears nowhere. [appearance]
3. Every single-choice row uses one selected style (`btn-primary`) and one unselected style (`btn-secondary`), each ≥ 28 px. [appearance]
4. The theme cards are two equal columns, each with a 64 × 44 swatch. The chosen card has an ink border. [appearance]
5. The ROAD row is gone. A collapsed “Advanced” at the panel's foot holds World: Full · Steady · Light · Flat, each with ADR-0079's line. [3214-world-control]
6. Under reduced motion, Flat is chosen, with one “Show the world (steady camera)” button. [3214-world-control] [multi:reduced-motion]
7. Hints are one muted line: right of the row at ≥ 1024 px, below it on a phone. Nothing scrolls sideways. [appearance]

#### landing

**Capture:** `/` signed out, desk and phone, in both schemes.

**Must match**
1. The landing hero (`lib/brand/LandingHero.svelte`) renders as today, or with ADR-0073's figure. It is never broken or empty after the clay-rider modules go. [world-figure]

### F. Garage (desk)

#### garage-shop

**Capture:** `/garage`, Shop tab, after the dev-only Batzen grant. Desk and phone, in both schemes.

**Targets:** shop-catalogue, v3-shop, v2-garage. D6–D9 apply.

**Must match**
1. One sidebar row, Garage, after Friends, lit on every tab. Nothing else is added to the sidebar. [garage-frame]
2. The header:
   - the `page-title`;
   - “Looks only. Nothing here makes you faster.” on the same baseline;
   - the wallet, right-aligned: the outlined Batzen mark (about 28 px), the balance at about 24 px tabular, “Batzen” small beside it, and “about N of your rides” muted under it.
   [garage-frame]
3. `SectionTabs`: “Shop · Locker · Makers”, with Makers only when #3254's flag is on. A search field sits right-aligned on the same row. [garage-frame] [garage-shop]
4. The rail is 200–235 px wide:
   - “All · Buy · Earn · Free”;
   - the BIKE and RIDER groups, with muted counts;
   - the chosen slot as a filled row.
   [garage-shop]
5. Above the grid: the slot's name and “<n> items · <min>–<max> Batzen”. [garage-shop]
6. Four equal columns with 16 px gaps. Each card has:
   - a thumbnail taking 55–60 % of the card, on the paper preview ground;
   - an era chip at the bottom left, and STARTER at the top right;
   - the name, and a spec of at most two lines;
   - a hairline;
   - a price row, with “Try on” as a secondary button.
   [garage-shop]
7. Item states:
   - an owned item reads “Owned”, or “In your garage from day one” for a starter;
   - a worn item shows WEARING;
   - an earned-only item has a how-to-earn line and no price;
   - a crew item reads “Free for members”;
   - an item the rider cannot afford shows “about N rides”, and its buy button is disabled with that hint.
   [garage-shop]
8. No hero banner, no watt and no glow. All four states render. [garage-frame] [garage-shop]
9. On a phone the rail becomes a chip row and the grid has two columns. Nothing scrolls sideways. [garage-shop]

#### garage-locker

**Targets:** shop-locker, v2-garage, v3-shop.

**Must match**
1. “The locker” is centred over the stage. The figure stands on its bike on a dark stage with one lit ellipse, with no glow and no bloom. [3157-locker]
2. The slot lists: 17 rider rows on the left and 22 bike rows on the right, each about 36 px.
   - Each row has a 20 px numbered neon disc, the slot eyebrow, the item name, and “price”, “free” or “earned”.
   - The discs on the figure match rows 1–39, and no two overlap by more than half a disc.
   [3157-locker]
3. The look switch, “Golden hour · Diorama · Ride look”, sits at the stage's top left. [3157-locker]
4. The try-on bar reads “Trying: <item>”, with “Put it back” and “Wear it”. “Wear it” is disabled with a hint when the rider cannot afford the item. [3157-locker]
5. The summary pills show slots filled, Batzen bought, and “earned, never sold”. There are no dev pills, and no watts, W/kg or weight. [3157-locker]
6. Without WebGL2, under reduced motion, or on a phone: a 2D SVG figure with the same callouts and no spin. [3157-locker] [multi:no-webgl]
7. Two cards side by side: “Earning, only you see this” and “The Swiss calendar, back every year”. [locker-earning]
8. The crew kit panel, shown only to a crew's owner or admins:
   - a preview about 170 px wide;
   - template pills;
   - three rows of 34 px swatches;
   - the crew's own icon as the only emblem, with no upload and no text.
   [3162-crew-kit] [multi:second-rider]

#### garage-makers

**Capture:** with #3254's flag on.

**Target:** shop-makers.

**Must match**
1. Four equal columns, with gaps of about 18 px. [3255-makers]
2. Each maker card:
   - a banner about 128 px tall in the maker's colour, with a round badge, the wordmark and an era chip;
   - a paper body: an italic etymology line, a 2–3 line story, the discipline, three thumbnails, a hairline, and “<n> items · <min>–<max> Batzen · <n> earned”.
   [3255-makers]
3. Badges are round or oval, never shields. No cross, and no “Swiss made”. Wordmarks use the bundled OFL fonts. [3255-makers]
4. A card opens the Shop filtered to that maker. On a phone the grid is one column. [3255-makers]

### G. Open rides (desk)

#### open-rides

**Target:** v3-events, with D10 applied.

**Canon:** ADR-0076; SPEC “Open rides”.

**Must match**
1. At ≥ 1280 px, two panes split by a hairline: This week (about 480 px) and the selected ride. [3307-open-rides]
2. Filter pills: “All · Open rides · Races · My crews”. The chosen pill has a neon border and a tint. [3307-open-rides]
3. Each row has:
   - the time, 15 px in the display face, in a fixed column;
   - a kind eyebrow, with an ok-token dot for RIDING NOW;
   - the title and a meta line;
   - an outlined count pill, “<n> crews · <n> alone”.
   [3307-open-rides]
4. The right pane has:
   - the eyebrow “OPEN RIDE · HOSTED BY <crew> · <DAY TIME>”;
   - the title at 22 px;
   - the countdown at about 44 px, in ink, not watt.
   [3307-open-rides]
5. Readiness chips; the pinned disclosure directly above the actions; “Enter the pen” as `btn-primary btn-lg`. [3307-open-rides]
6. Only the rider's own people are named; strangers are counts. On a phone the list shows first, and a ride opens as its own page. [3307-open-rides]
