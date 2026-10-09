# Design targets

What every rider-visible change is held to. Per surface: an id (its capture's file name), target images, the canon that outranks them, and must-match items a reviewer walks one by one. Procedure: `docs/design/DESIGN-CHECK.md`. Captures: `make design-shots` (`web/e2e/design-shots.spec.ts`).

## Where the targets come from

`docs/design/targets/`, rendered 2026-09-30 from `docs/design/mockups/` by `make design-targets`; Jan chose each. v2's route starts in an invented village; its traces stop short of the start and no map is centred on it (G10).

- `v2-*.png` “Ride Worlds Play”: ride, erg, routes, summary, garage, collections, phone.
- `v3-*.png` “Ride Worlds Shared Roads”: roads, events, modes, race, rider, motion, roadside, shop.
- `shop-*.png` “Velowerkstatt”: catalogue, locker, makers.
- `world-*.jpg`: `world-realism-tier3` (recommended real-ground look), `world-bluehour-hairpin` (stylised tier), `world-ghost`, `world-kom`.

## How to read a target

- Only the framed mock is the bar. A v2/v3 page's eyebrow, title and paragraph above it, and notes and “Open for Jan” box below, are reasoning canon has since answered.
- Structure is the bar: proportion, grouping, alignment, hierarchy, what sits where, what is absent. Sizes come from docs/SPEC.md, not the mock; a pixel number in a must-match item is the bar, ±4 px.
- Ignore the mock's data (its loop, Mia, 258 W). Capture data is the fixtures' (`web/e2e/road-gpx.ts`, seeded by `web/e2e/design/seed.ts`):
  - `<hairpin>` “Design switchbacks”: 1 km approach at 3 %, then eight legs at 8.8 % joined by seven hairpins; the app reads 7.1 km · 571 m, one class II climb, first hairpin ~1.7 km in.
  - `<rolling>` “Design swells”: 7.5 km · 237 m, two class IV climbs.
  - An item quoting a fixture's number takes it from a capture, never memory; a fixture change updates those items in the same PR.
- Targets are drawn dark: desk surfaces compare on a dark capture, a light capture holds the same layout; riding surfaces are always dark.
- Owner tags: `[key]` = the `design/<key>` issue that delivers it; `[#n]` = an existing issue; untagged = holds today, guarded against regression. A PR is held to its own issue's items, the global rules, and no regression elsewhere. A global-rule failure is _inherited_, not counted against a PR only passing through the surface, when main fails it the same way and an open issue owns the fix (DESIGN-CHECK §8).
- Check tags: none = the image; `[probe:<key>]` = the measurement JSON the capture run writes beside each image; `[test:<file>]` = a repository test asserting it; `[multi:<capture>]` = a named second capture (frame sequence, second rider, other scheme, reduced-motion run). A motion or state item whose source is missing is CANNOT-TELL, never guessed from one still.

## Precedence and standing deviations

Canon (WATTROOM.md, `docs/decisions`, `docs/SPEC.md`, `.claude/rules`) beats the target; the target beats today's app. Settled: a reviewer never flags these, an implementer never copies the mock where it breaks one.

|     | Settled                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Sizes are SPEC's “The bike computer”. Desk: watts ≥ 104 px, time left ≥ 72 px, secondary numbers ≥ 36 px, words and labels ≥ 24 px. TV: 12 / 9 / 5 / 3 vh, nothing under 2.9vh. The mocks' 11–21 px labels are under that floor; where a mock's proportions cannot hold SPEC's sizes the panel grows, never into the keep-clear corridor. No SPEC phone row yet: design/ride-phone proposes one in its PR, from ADR-0071's arcminutes at a design distance it states; until then its items are relative (“the largest number on the screen”). The HUD's row is SPEC's HUD column (#3678). |
| D2  | Slot 3's pages are ADR-0071's closed set: RIDE, CLIMB, POWER, MAP (on a road), later RACE. v2-erg's “Workout” tab is not a page; v2-ride's separate climb card is the CLIMB page.                                                                                                                                                                                                                                                                                                                                                                                                         |
| D3  | A capable phone may draw the world: ADR-0066 keys on capability, never width (supersedes v2-phone's “never renders 3D”).                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| D4  | The world's look is `world-*.jpg`, ADR-0072, ADR-0073, not the v2/v3 prototype clay rider on a near-black road; v2/v3 stay the bar for layout.                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| D5  | No stars at the start (ADR-0072: only as the zenith darkens), despite world-bluehour-hairpin's stars in a peach sky.                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| D6  | The sidebar gains no sub-rows, cards, badges or icon strips (ADR-0020, Jan's recorded taste). v2's Library / Routes and History / Progression / Collections sub-rows become tabs atop the content; Progression is retired. The garage adds exactly one row: Garage. Every such tab strip is one component, `SectionTabs`, extracted from Settings' strip by whichever issue needs it first.                                                                                                                                                                                               |
| D7  | The primary button is the kit's `btn-primary`, an ink fill, not the mocks' neon fill. Flipping it changes the one utility, not a call site.                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| D8  | The wallet counts Batzen (ADR-0069), never kJ as v2-summary does. The Batzen mark: an outlined round mark with a “B”, never shop-catalogue's filled gold coin.                                                                                                                                                                                                                                                                                                                                                                                                                            |
| D9  | Never ships: shop-catalogue's hero banner (numbers not SPEC's); shop-locker's dev pills (triangle count, “no conflicts”); v3-shop's “Saved looks — five” (SPEC has no count); v2-garage's two kit colours (#3162 says three).                                                                                                                                                                                                                                                                                                                                                             |
| D10 | v3-events' Wheelrace (four pens D–A, a predicted-finish chart) belongs to #3172; an open ride shows one pen.                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| D11 | #3274's two doors to the crew lounge stay; v3-modes draws a one-line link instead.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| D12 | A moment card (a sprint armed or live) sits top-centre above the corridor, as v2-ride draws it, while about 300 px (its narrowest at SPEC's 24 px words) stay free between slot 1 and the jukebox seat; otherwise at the top of the right column, directly under the seat, at most 30 % wide. A measured fit, not a breakpoint (Jan, 2026-10-06, #3668). Never in the corridor.                                                                                                                                                                                                           |
| D13 | On a road workout (ADR-0062) +1 min and Skip block are hidden, with a one-line hint: the road decides where a block ends. No mock draws it.                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| D14 | PgUp and PgDn are Harder and Easier, never a page (ADR-0071, SPEC). The mocks' “← → · PgUp PgDn” hint is not copied: the computer shows ← and → only; a key hint on a riding surface lists only bound keys (#3216's keymap). #3661 is the same mistake.                                                                                                                                                                                                                                                                                                                                   |
| D15 | The computer's page control is the current page's name between a ← and a → button, with position dots, on every layout: world, flat, TV, phone; never v3-race's row of every page name, which does not fit SPEC's 24 px words in a column ≤ 30 % wide. The whole panel stays a tap target (ADR-0071).                                                                                                                                                                                                                                                                                     |
| D16 | NEXT reads describeBlock's text for the next block, on every surface; `describeBlock` in `lib/workout/block.ts` is the one source. Spellings in mocks and issues (“Sprint · 15 s”, “Sprint for 15 s”) are illustrations.                                                                                                                                                                                                                                                                                                                                                                  |
| D17 | Every number has one home (table below), overriding v2-ride's RIDE page (ride time, energy, grade) and v2-erg's separate W/kg field.                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

## One home per number (riding surfaces)

| Number                                                                 | Its one home                                                                                  |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 3 s power                                                              | the bike computer's head, in watt, the largest number on the screen                           |
| W/kg                                                                   | beside the 3 s power, in the head                                                             |
| the live zone                                                          | under the 3 s power, as digit and name (“Z3 Tempo”) at label size; never colour alone (#3213) |
| target track, “Block · n % on target”                                  | under the head, only while a target is asked                                                  |
| time left, block, target, elapsed of total                             | slot 1, in a workout                                                                          |
| km x of y, grade, next climb                                           | slot 1's road line, on any ride with a road                                                   |
| to the top, ascent left, average left                                  | the CLIMB page, while a classed climb is near (#3645)                                         |
| elapsed, m climbed                                                     | slot 1's chip row, on a free ride                                                             |
| how the trainer rides it                                               | slot 1's trainer chip: “SIM · you feel y %”, “Watts · n W”, or “ERG: the road is scenery”     |
| speed                                                                  | RIDE page, on a road                                                                          |
| cadence; heart with its zone dot                                       | RIDE page                                                                                     |
| gear                                                                   | RIDE page, where gears are on (neon, as rider state)                                          |
| vs best / vs last                                                      | RIDE page, with a ghost                                                                       |
| execution; 10 s, 30 s, block average, NormPower, intensity, work, load | POWER page, which drops its own 3 s field while the head shows it                             |

So the RIDE page holds: a workout with no road, Cadence and Heart; a workout on a road, Speed, Cadence and Heart; a free ride on a road, Speed, Cadence, Heart and Gear, plus vs best / vs last with a ghost.

## Global rules: checked on every capture

|     | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | **The cave.** From the count-in to End ride the whole frame, content and sidebar, uses the dark family (surface OKLCH L ≤ 0.30), whatever the OS scheme or theme toggle says [probe:cave]. TV mode, the spectator's Watch view and `/hud` are cave too, and so is a spectator's voice channel stage during a session (the roadside deck): a riding surface, labelled per G4, since a rider a game put out uses it on the bike (Jan, 2026-10-07, #3029). The setup before a ride, and the closing or road-end card after it, are desk surfaces following the rider's scheme (ADR-0005, amendments #113, #331).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| G2  | **Glow and accents.** `--color-watt` marks live data and alone glows. On a riding surface it marks exactly three things, nothing else (no crew-row number, no target, no second power figure): the 3 s power; your position marker on the horizon (the Skyline dot or the interval graph's cursor); your trail in the world [probe:wattCount]; and, while a sprint's window is open, the moment card's border (D12; Jan, 2026-10-07). `--color-neon` is structure and prescription (frames, hairlines, selected borders, grade and record ramps, rider state such as the gear, targets, a model's outputs such as a race's gap to par and place, #3174), never a measured reading, never glowing. Zone tokens carry zone readings only: a zone-coloured line or fill shows the zone actually ridden there, never a fixed zone as decoration. The one exception is the plan: the interval graph's prescribed blocks take their zone's colour, docs/spec/stats.md's ramp (Jan, 2026-10-07). Desk surfaces glow nothing. Records (history, collections, class chips, progress bars) use the neon ramp. `danger` is its own token. z6, z7, danger and watt never blink.                                                                                      |
| G3  | **Panels over the world.** One kit, the `ride-panel` utility: surface at 86 % opacity (floor 85 %, ADR-0071), 1 px neon hairline at ~38 % alpha, 12 px radius, no backdrop blur, no shadow; never nested [probe:panels]. Panels 16 px in from the canvas edges, 12–16 px apart; panels in one column share an edge. Each panel its content's size: no empty band > 24 px, nothing scrolls or clips [probe:panels]. The keep-clear corridor (x 30–70 %, y 22.5–77.5 % of the canvas; `CORRIDOR` in `lib/session/docks.ts`) holds no panel, chip or text wherever a world is drawn in the canvas (world surfaces; TV and the HUD over the world; ADR-0066, ADR-0071); a flat surface uses its whole column [probe:panels]. A panel over the world is ≤ 30 % of the canvas wide against a side edge, ends above y 22.5 %, or starts below y 77.5 %. The world fills its canvas edge to edge. The jukebox seat (top right, `JUKEBOX_SEAT`) has nothing over it; with no jukebox it stays empty and nothing grows into it. Ride-critical status (trainer silent or lost, reconnecting, socket dropped; errors.md, SPEC's `SIGNAL_LOST_MS`) is one persistent line atop slot 1 with at most one ≥ 44 px recovery button; never a toast, never in the corridor. |
| G4  | **Legibility at the design distance.** Desk 0.8 m from a 14-inch laptop; TV 3 m from a 55-inch set. Sizes are D1's; a unit ≤ half its number. Riding surfaces label with `ride-label` (≥ 24 px desk, ≥ 3vh TV); the kit's `eyebrow` (10 px) is for desk pages only. Numerals `font-display` (Chakra Petch), tabular; distance reads “x of y”. Every word on a riding surface is a label or a number, except a status or recovery line canon requires (G3's ride-critical status, ADR-0062's hint for a hidden control, the Flat-road reason from `REASONS` in `lib/world/ride-view.ts`, the team-car radio's closed phrases in SPEC “Races”): one line, label size, at most one ≥ 44 px button. The watts is one figure, the 3 s power, never repeated (D17).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| G5  | **Phone width is 375 × 812.** The page body scrolls down, never sideways; measure `[data-testid=page-body]`, never the document [probe:overflowX]. No pixel width on an SVG that is also measured. Primary work first in the stacking order. Tap targets 24 px on a browse surface, 44 px (`btn-lg`, `icon-btn-lg`) for anything touched while pedalling [probe:minTarget]. The last item clears the floating navigation button and the browser chrome.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| G6  | **Motion** (ADR-0079, SPEC “Motion”). The camera is a tripod on a rail: no shake, bob, roll, overshoot, motion blur or speed lines; field of view rises ≤ +4° [probe:camera.fov]. Live numbers snap, except the watts numeral's 250 ms transform glide (#3200). Bars settle through `transform` over `--dur-live`. Only results roll, only once. One stage moment at a time. Durations and easings are tokens. Reduced motion: the world opens on Flat with one “Show the world (steady camera)” tap; every motion a held stamp; sounds stay. In a still capture, something mid-transition is a defect only if it shows in two captures.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| G7  | **The page frame** (desk pages in the app layout). Pages fill the content column (`page`: 16 px gutters on a phone, 32 px from `sm`), no max-width, never centred; a section that would stretch too far goes multi-column at `xl`. `/hud` and the TV centre their block by design. Every section's left edge on the title's. The kit: one `page-title`, `eyebrow` for section labels, `panel`, `btn-*`, `input`; never a retyped class string. Four states: loading (a skeleton in the content's shape); error, with a retry; empty (teaches in one line, plus the button that creates the first one); content.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| G8  | **Words and actions.** The SPEC glossary: crew, text channel, voice channel, session; never “room”. No copy says a feature is coming (“arrives with”, “is coming”): a control whose precondition is absent is disabled with a one-line hint, or hidden (ux.md, capability gating); a hint never names a future release. A destructive action comes last, after a separator, in the danger token. An object with more than one action has a right-click or long-press menu, never the only way to an action.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| G9  | **Nothing that is not there.** No stand-in rider, bot or placeholder data on a real surface (ADR-0079). A world is drawn only on a ride with a road (ADR-0066).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| G10 | **Privacy is visible.** No surface, poster or card shows a place name, route start or effort its viewer may not see (ADR-0063, SPEC “A route's place”); efforts marked at save within 1,000 m of a ride's ends, or hidden near a zone, are drawn nowhere public. Capture fixtures sit in the open South Atlantic (#3054). No mockup or target carries a real start place.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

## Flows

Sequence captures [multi:flow-*], one per step, checked for continuity: a frame can pass while the screens do not connect.

- **F1, a road ridden:** Workouts → a route card's Ride → `/ride?road=` → 65 s → End ride → road-end card → the route page shows the ride under Your rides. [route-row] [ride-free-road-surface] [route-page]
- **F2, a workout ridden:** `/ride` → Workout → 65 s → End ride → closing card → See your ride → the ride page, wearing the closing card's header and tiles. [ride-preride] [closing-card] [ride-page]
- **F3, first run:** fresh dev account → Home's set-up card → `/ride` → pair the simulated trainer → first ride → closing card → Home shows it under Recent rides. [home] [ride-preride] [closing-card]

Every step of every flow:

1. No disabled promise (G8), no dead end.
2. The road or workout keeps one name and one vocabulary across every step.
3. One ride shows the same tiles wherever it is summarised.
4. Every Back, Done or back link lands on the screen the rider came from. The one exception is a card that ends a ride (the closing card, the road-end card). Its ride is over and saved, so it is never returned to: the screen it leads to keeps its own back link to its section, for example the route page's “← Workouts” (#3680).

## Surfaces

Capture recipes are the design-shots spec's. Every id below is in `docs/design/surface-map.json`, which maps changed files to the surfaces they draw (`node web/scripts/design-surfaces.mjs` prints a branch's; `web/scripts/design-surfaces.test.mjs` keeps map and file in step). A new surface gets a section here and a row there in one change. A section is a Capture, Target(s) and Canon line, then its numbered must-match items.

Desk: 1440 × 900. Phone: 375 × 812 with touch. World on: the device's World control at Full (the `wattroom.world-slot.v1` flag until #3214 replaces it); every world surface asserts the world mounted and did not fall back, or the shot is FAILED [probe:world].

### A. Riding surfaces (the cave)

#### ride-road-world

Capture: world on, `/ride?w=openers&road=<hairpin>&from=0`, simulated trainer, 14 s in; 1440 × 900 and 1920 × 1080. Targets: v2-ride, layout and panel kit (its CSS `--hud: rgba(10,1,24,.86)`, `--hud-line: rgba(139,43,255,.38)`, 12 px radius, 16 px insets); v2-erg, slot 1 and the computer in a workout; v3-motion's count-in frame, the slot map; v3-race, the computer's panel, with D15; world look: world-realism-tier3, world-kom, world-bluehour-hairpin. Canon: ADR-0046 (amendments #3062, #3063), 0066, 0071, 0072, 0073, 0079; SPEC “The bike computer”, “The world”, “Motion”.

Box table (#3668), measured in the app's fonts at SPEC's sizes. Every panel is its content's size, so w and h are the most each takes. A session's canvas is the solo ride's: while it rides in the world the people column folds into its sheet (Jan, 2026-10-07). A window shorter than the table holds (a canvas under 860 px, such as 1280 × 720; 820 until #3645's CLIMB page, Jan 2026-10-07) rides flat with "Flat road — this window is too short for the world" and draws the world again when it grows (Jan, 2026-10-07).

1440 × 900: canvas 1200 × 900 beside the 240 px sidebar; corridor x 360–840, y 202.5–697.5; seat x 888–1184, y 16–268.

| Panel                | x        | y     | w       | h     | Holds                                                                                                                                                                                                                        |
| -------------------- | -------- | ----- | ------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| slot 1, band         | 16       | 16    | ≤ 860   | ≤ 186 | eyebrow or status line 24 with the controls 44; time left 72 beside block · target · elapsed of total at 24; the interval strip 40 over NEXT 24 with its 3-2-1 chips; the trainer chip and road line 24. Ends above y 202.5. |
| moment card          | right 16 | 280   | 300–344 | ≤ 160 | under the seat, its right edge the seat's: top-centre, between slot 1 and the seat, 300 px are not free; at most 30 % wide (D12)                                                                                             |
| bike computer        | 16       | ≥ 255 | ≤ 344   | ≤ 553 | page control 44, the 3 s power 104 with W/kg 36 beside, zone 24, target track and its band 24, block on target 36, fields 24 / 36 (CLIMB's in two columns), bias trim 44. Ends 12 px above the Skyline.                      |
| crew panel (session) | right 16 | 280   | ≈ 240   | ≤ 520 | rows 44, under the seat and any moment card                                                                                                                                                                                  |
| Skyline              | 16       | 820   | 1168    | 64    | the dot wholly inside                                                                                                                                                                                                        |

1920 × 1080: canvas 1680 × 1080; corridor x 504–1176, y 243–837; seat x 1243–1664, y 16–318.

| Panel                | x        | y     | w     | h     | Holds                                                     |
| -------------------- | -------- | ----- | ----- | ----- | --------------------------------------------------------- |
| slot 1, band         | 16       | 16    | ≤ 860 | ≤ 186 | as at 1440; ends at y ≤ 202, 41 px above the corridor     |
| moment card          | ≥ 888    | 16    | ≥ 300 | ≤ 186 | top-centre: about 340 px free between slot 1 and the seat |
| bike computer        | 16       | ≥ 435 | ≤ 344 | ≤ 553 | as at 1440                                                |
| crew panel (session) | right 16 | 330   | ≈ 240 | ≤ 650 | rows 44                                                   |
| Skyline              | 16       | 1000  | 1648  | 64    |                                                           |

Layout:

1. The PR records its box table here before the layout is built: every panel's x, y, w, h at 1440 × 900 and 1920 × 1080, with the SPEC size each holds. [ride-surface]
2. World canvas fills the riding column edge to edge, no dark margin. [ride-surface]
3. Every panel the `ride-panel` kit (G3), none nested. [ride-surface] [probe:panels]
4. Insets 16 px, gaps 12–16 px. Computer, Skyline, and slot 1 when in the left column, share a left edge; seat, crew panel and Skyline share a right edge. [ride-surface]
5. Panels content-sized: nothing clipped or scrolling, no empty band > 24 px. Cadence, heart and bias trim visible and reachable. [ride-surface] [probe:panels]
6. Slot 1: one panel top left, outside the corridor, shaped as the box table shows holding SPEC's sizes (a wide band ending above y 22.5 %, or a column ≤ 30 % wide above the computer). It opens with a `ride-label` eyebrow, mode · workout or road · riders; then v2-erg's work panel: time left ≥ 72 px with “Block n of m · name”, “Target W · range”, “elapsed of total”; interval strip with cursor; NEXT (D16) with the 3-2-1 chips; the trainer chip. On a road, the road line “km x of y · grade % · <next climb> in z km” once, here. [ride-surface]
7. Controls one row inside slot 1, no separate panel: ⚑, TV, +1 min, Skip block as ≥ 44 × 44 px icon buttons with accessible names and tooltips; End ride the one text button; +1 min and Skip block only where the rider owns the clock (D13). [ride-surface] [probe:minTarget] [test:web/src/lib/ride/riding-screen-world.test.ts]
8. Persistent status (G3): one line atop slot 1 with its one recovery button, never covering the corridor. [ride-surface] [multi:ride-status]
9. Bike computer: one panel bottom left, ≤ 30 % wide, directly above the Skyline. Top down: page control (D15), ← name → with dots, arrows ≥ 44 px; head: 3 s power in watt (≥ 104 px), W/kg beside, live zone as digit and name under; while a target is asked, target track (low · target · high, a needle) and “Block · n % on target”; the page's fields per the one-home table, a grid under a hairline. [ride-surface]
10. Only watt marks: G2's three, one power figure, your Skyline dot, your trail. [ride-surface] [probe:wattCount]
11. Skyline full width along the bottom, > 56 px tall: ridden part ink or muted, never a fixed zone; road ahead neon; your dot wholly inside the panel; on a workout the block band beneath the line (v2-erg); place labels above the line where the road has named places [#3134] (none on the hairpin fixture: OPEN-ELSEWHERE). [ride-surface]
12. Corridor clear; your figure unobstructed in `RIDER_BOX` (docks.ts: x 40–60 %, y 55–82 %; its foot reaches below the corridor by design). [ride-surface] [#3215] [probe:panels]
13. A moment card top-centre between slot 1 and the seat, above the corridor; border watt while live (D12). [ride-surface] [multi:ride-session-road]
14. No key hint names PgUp or PgDn (D14). [ride-surface]
15. Cave covers the frame, sidebar included. [ride-cave]

World:

16. The world's road is this ride's: ahead, the fixture's approach, a straight at 3 % toward the face of the switchback stack (no flat valley straight, no church village); distance “0.1 of 7.1”, your figure at the approach's start; your figure's km matches the Skyline dot; from km 2.3, on the second leg, the hairpins climb ahead, the second hairpin and the stack above it in view [multi:world-hairpins]. [3663-world-is-your-ride] [probe:world]
17. A solo ride holds one figure, yours, one ring; no bots. [3663-world-is-your-ride]
18. Sky: top third cool blue-lavender, blue the highest channel, darkening upward; a thin peach band on the horizon, OKLCH hue 58–60°, ≥ 40° from every dark identity's watt, no taller than ~a tenth of the visible sky; nothing brown-mauve or pink; no stars at the start. [3085-ride-light]
19. No warm key light, no cast shadow; shading soft and cool, from the sky. [3085-ride-light]
20. Distant ridges opaque, paler and bluer with distance; no translucent pink layers, no white stripes. [3085-ride-light]
21. Road: near asphalt cool dark grey, ~rgb 30–40 / 32–42 / 45–60 (tier3 samples 33,36,53), fine grain, never black [probe:asphaltRgb]; off-white edge lines and dashed centre line painted flat; a lighter gravel shoulder outside the edge line, then a green-grey verge; white posts with a black band in a steady rhythm to the vanishing point; grain still under the moving camera [multi:world-drift]; snow poles belong to #3184. [world-road-surface]
22. Forest: across a 60 s sequence most frames show conifer stands within 10–30 m of the road on one side at least [multi:world-60s]; crowns cross the horizon line; trees in groups of varied height, never evenly spaced single cones; a meadow a clearing with a forest edge behind it; houses in small clusters near the road, judged where a hamlet is in sight [multi:world-hamlet]; no tree or building on the road, its shoulder or the corridor, the chase camera's sightline along the road (`ground.clearOf`) [test:web/src/lib/world/props/props.test.ts]. [world-forest]
23. Your figure is ADR-0073's, on a drop-bar road bike with spoked wheels: kit, helmet, glasses, no face. Every kit passes the wardrobe's colour guard (`lib/world/placement/safety.ts`, `wattHueBandDeg` in catalogue.json). [world-figure]
24. Framing: figure 20–30 % of canvas height [probe:figure.bboxH]; horizon ~40–45 % from the top; field of view never > 4° over its base [probe:camera.fov] [multi:world-drift]. [3211-camera]
25. One thin flat ring under your wheels, in your live zone colour, no halo; band width as SPEC “The world” records. [probe:ring.bandM] [test:web/src/lib/world/ride-scene.test.ts] [3086-names-ring]
26. Your trail the only glowing or additive element: a thin line ~a wheel wide, fading out within a short fixed length behind you; never a wedge or fill. [3663-world-is-your-ride]
27. On real ground the frame carries the map and height credits. [#3133]

Pages:

28. Turned to CLIMB on the climb: ← CLIMB with the class chip → and dots (D15) over the head; under the hairline To top · Ascent · Avg left in two columns, each label on one line at 24 px; on the other pages the same chip beside the page's name, taking no row; while a target is asked no profile, as the Skyline below draws the climb and your dot; the panel between slot 1 and the Skyline, whole. [#3645] [multi:ride-road-world-climb]

#### ride-workout-world

Capture: world on, `/ride?w=openers`, no road: a negative check. Canon: ADR-0066.

1. No world canvas mounts; the capture has ride-workout-flat's layout. [3663-world-is-your-ride] [probe:world]
2. No figure, ring, trail or synthetic pass anywhere. [3663-world-is-your-ride]
3. No Flat-road line: nothing fell back. [3663-world-is-your-ride]
4. Cave covers the frame.

#### ride-workout-flat

Capture: world off, `/ride?w=openers`, 14 s in; a second frame at four-digit watts (the spec drives the simulated trainer past 1,000 W). Targets: v2-erg (work panel, computer); v2-ride's “Flat road” inset.

1. Every slot a `ride-panel`; nothing floats unframed. [ride-flat]
2. Slot 1 one full-width panel. Left: time left ≥ 72 px with block, target, elapsed of total. Right: interval strip with cursor, then NEXT (D16), the 3-2-1 chips and the ERG chip, all on one line. [ride-flat]
3. Controls one row inside slot 1, as ride-road-world item 7, flush with the panel's inner right edge. [ride-flat]
4. Head as ride-road-world item 9: one watts figure ≥ 104 px, W/kg beside, zone as digit and name, the track while a target is asked. [ride-flat]
5. RIDE page fields per the one-home table (workout, no road: Cadence, Heart), in the head's panel, no gap wider than ~48 px; page control (D15) in that panel's header row. [ride-flat]
6. Bias trim inside that panel, each button ≥ 44 px. [ride-flat]
7. Interval graph: full-width panel along the bottom, ≥ 112 px tall; its FTP label at `ride-label` size, or dropped. [ride-flat]
8. Numbers panel takes the free height; no band between panels > 16 px. [ride-flat]
9. At four digits the numeral stays inside its panel, covering no other text. [multi:four-digit] [ride-flat]
10. Persistent status per G3. [multi:ride-status] [ride-flat]
11. Cave covers the frame.

#### ride-skyline-fallback

Capture: world on, a road ride forced onto the Skyline; again under `reducedMotion: 'reduce'`. Target: v2-ride's “Flat road” inset.

1. ride-workout-flat's items hold, the Skyline in the horizon panel at full width, the dot inside. [ride-flat]
2. The Flat-road line is `REASONS`' line for the reason (`lib/world/ride-view.ts`), not new copy: atop slot 1 at `ride-label` size; “Try 3D again” where `REASONS` offers a retry; wording changes go through #3212. [ride-flat]
3. Reduced motion: `REASONS.motion`'s line, with one “Show the world (steady camera)” button that sets Steady (ADR-0079). [#3214] [multi:reduced-motion]

#### ride-status

Capture: ride-road-world and ride-workout-flat, simulated trainer silenced past `SIGNAL_LOST_MS`. Canon: errors.md; SPEC “Sync tolerances”.

1. The fault: one persistent line atop slot 1, one ≥ 44 px recovery button; not a toast; over the world nothing enters the corridor (G3). [ride-surface] [ride-flat]
2. Numbers read stale (“—”); nothing stale keeps its watt or glow.

#### ride-countin

Capture: world on, OS scheme light, `/ride?w=openers&road=<hairpin>`: `ride-countin-first` as the count-in appears, `ride-countin` a second in. Target: v3-motion's count-in frame.

1. Cave from the count-in's first frame. [ride-cave]
2. Slots already in their places, as v3-motion draws them; during the count-in the one digit is the only thing in the corridor. The dock-in motion belongs to #3087. [ride-surface]

#### ride-free-road

Capture: world off, `/ride?road=<hairpin>`, 14 s in, OS scheme light. Targets: v2-ride; v3-modes for the feel line. Canon: ADR-0005, ADR-0046 (parity), ADR-0062, ADR-0084.

1. Cave from the first stroke to End ride, with the OS in light mode. [ride-cave] [probe:cave]
2. The flat riding surface, `ride-panel`s filling the column; no centred block. [ride-free-road-surface]
3. Slot 1 is the road line, in order: “FREE RIDE · <road>”; “km x of y · grade · <next climb> in z km” at display size; trainer chip, “SIM · you feel y %” or “Watts · n W”; “elapsed · m climbed”. [ride-free-road-surface]
4. Road name, gear, grade and watts each once (D17). [ride-free-road-surface]
5. No 0–300 W track, no “no target — spin easy”. [ride-free-road-surface]
6. RIDE page per the one-home table: Speed, Cadence, Heart, Gear where gears are on, vs best / vs last with a ghost. [ride-free-road-surface]
7. Road | Watts, Easier and Harder ≥ 44 px, in slot 1's row beside ⚑, TV and End ride. [ride-free-road-surface]
8. No teaching sentence (G4), no hint naming unbound keys (D14). [ride-free-road-surface]
9. At 1440 × 900 the Skyline on screen, full width, the dot inside. [ride-free-road-surface]
10. Carrying on next time is offered on the road-end card, not while riding. [ride-free-road-surface]

#### ride-free-road-world

Capture: world on, `/ride?road=<hairpin>`, 14 s in. Targets: v2-ride; v3-roads (in-ride frame); world-realism-tier3.

1. The world draws in slot 2, so the capture differs from ride-free-road. [ride-free-road-surface] [probe:world]
2. ride-road-world's layout items 2–15 hold, ride-free-road's road line as slot 1. [ride-surface] [ride-free-road-surface]
3. ride-road-world's world items 16–27 hold, under their own tags.
4. Easier and Harder reachable at ≥ 44 px while the world shows. [ride-free-road-surface]

#### ride-free-road-ghost

Capture: as ride-free-road-world, after a seeded earlier effort on the same road; the ghost issue adds this surface. Targets: v3-roads, world-ghost. Canon: ADR-0068; SPEC “Road segments and ghosts”.

1. A ghost is your figure in your own kit, drawn see-through, clearly lighter than a live rider. [3245-ghosts]
2. A ghost has no name tag, ring, shadow, trail or glow; ≤ three show, in one instanced draw. [probe:renderer.draws] [3245-ghosts]
3. No ghost in an ERG workout, session, bunch, race, game or tow. [test:ghost placement] [3245-ghosts]
4. A faded live rider (#3227) is never drawn like a ghost. [multi:ride-session-road] [3245-ghosts]

#### ride-road-end

Capture: ride-free-road, then End ride.

1. A desk surface: follows the rider's scheme, the frame leaves the cave. [ride-cave]
2. “Carry on from km x next time” offered here, as one button. [ride-free-road-surface]
3. The road's name links to its route page (F1). [route-page]

#### ride-session-road

Capture: two dev riders (Designer and a second, name letters only) in one crew's voice channel, riding a session on the hairpin road, world on, the people column folded into its sheet (Jan, 2026-10-07, #3668), a sprint armed (`ride-session-sprint`), the jukebox seated, mixer muted. Then `ride-session-cheer-menu` and `ride-session-cheer`: the coach cheers the second rider from their crew tile's menu, captured while the thumb shows. Targets: v2-ride (bunch panel, moment card, seat); v2-erg.

1. Crew panel under the seat in the right column, ~18 % wide; rows ≥ 44 px; your row tinted neon at ~16 %; no crew number in watt. [ride-surface]
2. Moment card top-centre where it fits, otherwise under the seat (D12); border watt while live. [ride-surface] [multi:ride-session-sprint] [multi:ride-session-sprint-live]
3. Seat clear; the now-playing line directly under it at the seat's width. [ride-surface] [test:web/src/lib/session/RidingSurface.test.ts]
4. Name tags: small dark pills with a hairline, only over the two nearest riders and anyone speaking; merged when they would overlap; never in the corridor's lower half, nor over a panel, the chevron or a cheer's thumb. [test:web/src/lib/world/tags.test.ts] [3086-names-ring]
5. A crewmate's ring shows only where you may see their numbers (ADR-0059). [test:web/src/lib/world/ride-scene.test.ts] [3086-names-ring]
6. Both riders in the world: two figures abreast on the road, each in its own kit, not overlapping; your figure still in `RIDER_BOX`. [#3098]
7. The session's coach (here, you) wears a small violet chevron over the head: flat, unlit, the only one on the road. [#3098]
8. Formation, the front row's turn every 120 s, a far rider dithering to their place, the pull-over and the team car hold as SPEC “Riding a road together” says. [test:web/src/lib/world/bunch.test.ts] [#3098]
9. Each screen draws each rider where the other does, within 1 m along the road and across it. [test:web/e2e/bunch-world.spec.ts] [#3098]
10. A cheer for one rider, sent from their crew tile's menu, draws a thumbs-up over their head (a light disc, a dark thumb, flat, unlit, clear of the chevron); their tail light blinks at 2 Hz for 10 s in amber, neither danger's red nor any watt, steady under reduced motion; nothing about it glows. [multi:ride-session-cheer] [test:web/src/lib/world/ride-scene.test.ts] [#3116]

#### roadside-chalk

Capture: Design Watcher at the roadside of Designer's session on the hairpin road (world on, Design Partner riding), on the voice channel's page; `roadside-chalk-phone`, the deck on a 375 × 812 phone; then the watcher's socket double-taps, `roadside-chalk-refused`, the second stamp refused inside the hub's quarter second while the climb is still open; then lays a heart 18 m ahead of the bunch: `roadside-chalk-world`, Designer's ride with the heart on the road; `roadside-chalk-spent`, the deck once the road's one climb is chalked. Targets: none drawn; canon is the bar. Canon: ADR-0064; SPEC "The roadside".

1. The deck's six chalk stamps (arrow, heart, Allez, Hopp, cowbell, the watched rider's initial) sit in one row under the bottle, each ≥ 44 px, at desk and phone width with no sideways scroll; nothing is typed. [#3029] [probe:minTarget] [multi:roadside-chalk-phone]
2. With no climb left ahead the stamps are disabled, with one line saying so; a refused stamp says why and when to try again, in the same line (ADR-0064 Bounds). [#3029] [multi:roadside-chalk-spent] [multi:roadside-chalk-refused]
3. Chalk lies flat on the road ahead of the bunch, beside the riders' line as v2-erg's road paint sits beside the rider, in the road line's token, lit by the sky as the road's paint is (ADR-0072), never glowing, reading up the road. [#3029] [multi:roadside-chalk-world] [test:web/src/lib/world/chalk.test.ts]
4. Chalk is gone once the bunch rides over it. [#3029] [test:server/internal/hub/roadside_paint_test.go] [test:web/src/lib/world/chalk.test.ts]
5. ride-session-road's items hold around it. [ride-surface]

#### ride-session-flat

Capture: as ride-session-road, on a session with no road.

1. ride-workout-flat's items hold in the session's Training place. [ride-flat]
2. Crew rows ≥ 44 px; no crew number in watt (G2). [ride-flat]

#### ride-race

Capture: Designer and Design Partner race the hairpin road from Designer's voice channel, world off, the computer on RACE 20 s past km 0; the socket sends the start, as no screen offers a race yet. Then `ride-race-ride`, the same race on RIDE. Targets: v3-race (the RACE page; the radio line in slot 1). Canon: ADR-0067, ADR-0071; SPEC “Races”.

1. RACE reads the gap to your Category's par (“vs par”, “+0:18” ahead, “−0:18” behind), then your place in your Category (“in C”, “2nd of 2”); no W/kg; as tall as RIDE. [#3174] [multi:ride-race-ride]
2. Gap and place are the race model's: neon, flat, never watt; the page glows nothing. [#3174] [probe:wattCount]
3. The gap is at the computer's number size, never larger than the 3 s power. [#3174]
4. The team-car radio: one labelled line in slot 1, words ≥ 24 px, one closed phrase at most every 20 s, never a number RACE shows. [#3174] [test:web/src/lib/race/radio.test.ts]
5. The shelter bar and the matches gauge join with their issues. [#3265] [#3263]
6. ride-session-flat's items hold. [ride-flat]
7. In a race W/kg sits beside the 3 s power in the game's compact head (decided on #3174). [#3668]

#### ride-game-backyard, ride-game-collective

Capture: Designer coaching and Design Partner riding along in one crew's voice channel, simulated trainers, mixer muted; the coach's socket starts the game on the hairpin road (no screen does yet, #3794). Backyard Ramp from the start, shot at 0:14 and at 2:45 (`ride-game-backyard-arch`); Collective Ramp from 3.5 km, shot in round 2. Targets: none drawn; around the world it is the world layout (`lib/session/docks.ts`), where the game's card takes the column the crew holds otherwise. Canon: #3114; ADR-0065; SPEC "Game mode parameters", "The roadside", "Riding a road together".

1. A game on a road draws its world: the bunch on the road, as a session on a road does. [#3114]
2. Backyard Ramp: an arch where the bunch will be when the round ends; the KOM arch's chrome, no words (the round lives in the game's card), no glow; close ahead in the round's last seconds. [multi:ride-game-backyard-arch] [test:web/src/lib/world/game-road.test.ts] [#3114]
3. Collective Ramp: a fog sea, flat and unlit, creeps closer each round but never within 10 m of the riders; the road already climbed may sink into it (SPEC's fog sea "the climb crosses"); steps under reduced motion; none where no land lies below. [test:web/src/lib/world/game-road.test.ts] [#3114]
4. A rider a game puts out stands, stopped, on the verge at the first hairpin 300 m–5 km ahead; one cowbell as the bunch passes, under the roadside's sound ceiling. [test:web/src/lib/world/ride-scene.test.ts] [#3114]
5. The bunch rides the round's line in Backyard and Collective Ramp, and the called zone's middle in Floor is Lava. [test:server/internal/hub/game_road_test.go] [#3114]

#### ride-channel-free

Capture: the voice channel's free ride (`lib/ride/FreeRide.svelte`), world off.

1. ride-free-road's items 2–9 hold if the channel's free ride shares the road ride's component; otherwise the follow-up issue design/ride-free-road-surface files owns them. [ride-free-road-surface]
2. Cave covers the frame.

#### ride-ramp

Capture: `/ramp`, simulated trainer, 14 s in. Canon: ADR-0046 (a riding surface).

1. Riding panel kit and one-home table hold: ride-workout-flat items 1–8. [ride-flat]
2. Cave covers the frame.

#### ride-tv

Capture: world on, `/ride?w=openers` (no road: the flat TV), TV pressed, 1920 × 1080; the TV with a world belongs to #3091. Targets: v2-erg; v2-ride for the kit. Canon: SPEC's TV sizes; ADR-0046.

1. The 3 s power is the one watts figure, ≥ 12vh, in watt; the numbers row carries cadence and heart, not power. [ride-tv]
2. Nothing under 2.9vh, the exit hint, the scale's 0 / 300 and the FTP label included. [ride-tv] [test:tv-legibility.test.ts]
3. Exit control ≥ 44 px, in the top row beside title and clock, overlapping nothing. [ride-tv]
4. Top half: no empty region wider than a quarter of the screen. [ride-tv]
5. Time left ≥ 9vh. NEXT is describeBlock's text (D16), never “0 W”. [ride-tv]
6. Zone as digit and name inside the numbers panel, in its row. [ride-tv]
7. Secondary numbers ≥ 5vh; a unit ≤ half its number. [ride-tv]
8. Every block a `ride-panel`, one level deep; page control per D15. [ride-tv]
9. Interval graph: full-width panel along the bottom, clear of every control. [ride-tv]
10. Cave covers the frame; no sidebar.

#### ride-watch

Capture: the crew session's Watch view (`/crew/<id>/s/<session>/watch`) while a second dev rider rides; desk and phone.

1. Cave covers the frame (G1).
2. Only the followed rider's trail and dot glow (ADR-0072); nothing else in watt.
3. At 375 nothing scrolls sideways.

#### phone-ride

Capture: phone, world on, `/ride?w=openers`. Target: v2-phone's third phone (“Riding”), with D3.

1. One column of full-width `ride-panel`s in ADR-0046's slot order, 16 px gutters, ~10 px between panels; nothing docks over anything. [ride-phone]
2. Slot 1 uncut: “Block n of m · name”, time left, “Target W · range”, NEXT (D16). [ride-phone]
3. Head centred: the 3 s power, in watt, the largest number on the screen; time left the second largest; W/kg and zone on one line under the power; no other watts figure; sizes per the phone row the PR adds to SPEC (D1). [ride-phone]
4. Horizon full width. [ride-phone]
5. Controls: full-width rows of equal buttons ≥ 44 px tall; no label wraps; ⚑ visible without scrolling inside a panel. [ride-phone]
6. No road, no world. [3663-world-is-your-ride]
7. Floating navigation button covers no panel; the page scrolls down only. [ride-phone] [probe:overflowX]
8. Cave covers the frame.

#### phone-ride-road

Capture: phone, world on, `/ride?road=<hairpin>`.

1. Slot 1 is the road line, with the trainer chip. [ride-phone]
2. On a capable phone the world is a band in slot 2's place, between slot 1 and the numbers, nothing over it. [ride-phone] [probe:world]
3. On a climb the CLIMB page panel shows “CLIMB n OF m”, the class chip, to the top, left and average, the grade-ramp profile with your dot. [ride-phone] [#3645]
4. Skyline full width. [ride-phone]

#### hud, hud-shell

Capture: `/hud` in a second page while a road free ride runs: `hud-shell` at 320 × 132, the desktop shell's window; `hud` at 1440 × 900, ADR-0041's second-screen tab. Target: v2-phone's Team-car card, as the language for a compact numbers card. Canon: ADR-0041.

1. At 320 × 132 nothing changes; the shell shows the label row, clock at its right; the watts in watt, the target beside it when there is one; on a road, the grade line and next-2 km bars; nothing clipped.
2. In a large window the same block scales as one centred unit; the watts the largest element, ~a quarter of the window's height; words per the HUD row the PR adds to SPEC (D1). [ride-hud]
3. On a road ride the label reads “FREE RIDE · <road>”. [ride-hud]
4. Only the watts glows. Grade bars use the Skyline's grade ramp.
5. The cave's surface fills the window; the waiting and signed-out states scale the same way. [ride-hud]

#### ride-preride (a desk surface)

Capture: world off, `/ride`, with and without a remembered road, both schemes. Target: v3-modes' “/ride, alone” column. Canon: ADR-0062; ADR-0020's amendment, “Pages fill the column”.

1. First under the title, two tiles “Free ride” | “Workout”, each its name at display size with one line under it: “You drive the trainer. Hold a grade, or hold your watts.” / “The plan drives it. Last: <workout>.”; the chosen tile has the neon border. [ride-preride]
2. Same card: the eyebrow ROAD, then the road's name; “your last road” when it is the remembered one; buttons “Change” and “No road”. [ride-preride]
3. With a road chosen: the ways to ride it as chips on one line, only those that exist, one selected in neon; then “Feel: road x %, you feel y %”. [ride-preride]
4. With Workout chosen: the workout's name, duration and interval preview. [ride-preride]
5. Content starts top left, runs the column's width; no centred block. [ride-preride]
6. “Start the ride” is the primary button, ≥ 44 px, disabled with its one-line reason until a trainer is paired.
7. Tiles, chips and buttons ≥ 44 px tall. [ride-preride]
8. Follows the rider's scheme; in dark, cards surface-raised with a hairline.
9. Solo games one line in the card. [ride-preride]

#### ride-roadpick

Capture: `/ride` with “Change” opened, the hairpin and rolling route seeded. Target: v2-routes' rail rows.

1. Every road is the shared route row: name, class chips, stat line, story line; the name links to the route page. [route-row]
2. Empty state one line, “Your roads ride here — import a GPX, TCX or FIT.”, plus an “Import a route” button. [route-row]

### B. The world's look

#### dev-world

Capture: `/dev/world`, 9 s in, 1440 × 900; superseded by world-start and world-end once design/world-moment lands. Targets: world-bluehour-hairpin, world-realism-tier3, world-kom; v2-ride for the names.

1. The “Alpine blue hour” look is ADR-0072's ride light, as ride-road-world items 18–20; its colours an app.css token family. [3085-ride-light]
2. Road as ride-road-world item 21; orange snow poles belong to #3184. [world-road-surface]
3. Forest stands close to the road, no single cones on bare meadow; houses in small clusters, judged where a hamlet is in sight [multi:world-hamlet]. [world-forest]
4. The dev crew rides as ADR-0073 figures in distinct kits. [world-figure]
5. Names over the two nearest riders and anyone speaking; rings thin and flat. [test:web/src/lib/world/tags.test.ts] [3086-names-ring]
6. Every rider wears a wardrobe look: a catalogue jersey pattern in the look's own colours, a helmet of their own, no two riders in one look. [#3156]

#### world-start, world-end

Capture: `/dev/world?m=<metre>&p=0|1&cam=chase&look=bluehour&chrome=0`, 1440 × 900 and 1280 × 720; world-hamlet the same at m = 1100, a hamlet ahead; world-start also shoots `cam=side` (world-figure-side), `&kit=gipfelpunkte` with a white ground asked for (world-figure-dots), and `&kit=hoops&hold=0` and `&kit=gipfelpunkte&hold=0` four frames a quarter-second apart each (world-figure-motion-1 to 4, world-figure-dots-motion-1 to 4).

1. Two loads of the same URL give an identical frame. [world-moment] [multi:world-start-twice]
2. With `chrome=0` no dev chrome. [world-moment]
3. At p=0 no stars. At p=1 stars only in the dark upper sky, never in the peach band, light visibly darker. [3085-ride-light]
4. The dressing streams with the ground; a held moment draws all of it within the far ring from its first frame (trees, buildings, roadside pieces a ride would meet there), no gap where a tile is still to come. [#3699] [multi:world-start-twice]
5. Your jersey's pattern lies on the cloth, round the torso and down the sleeves, clean edges that do not crawl; Gipfelpunkte never puts its dots on a white ground. [#3156] [multi:world-figure-side] [multi:world-figure-dots] [multi:world-figure-motion] [multi:world-figure-dots-motion]
6. No kit colour reads as live data to the viewer: the probe counts none within the viewer's watt band or near a zone. [#3156] [probe:figure.kitCollisions]

### C. Roads library (desk)

#### workouts, phone-workouts

Capture: `/workouts`, the hairpin and rolling route seeded; whole page body, desk and phone, both schemes. Targets: v2-routes, v3-roads (“Your roads”), v2-collections (the rhythm).

1. Title and subline top left. The search box on its own row, ≤ ~420 px wide, reads “Find a workout or a route”, filters routes too. [workouts-page]
2. Every shelf opens with one header row: eyebrow left, the shelf's doors right on the same baseline (`btn-ghost btn-xs`, ≥ 28 px). [workouts-page]
3. Each door once; on an empty shelf the doors live only in the empty state. [workouts-page]
4. An empty state is one line plus its button; no “Nothing yet.” [workouts-page]
5. Sections 32 px apart; each eyebrow 8 px above its content. [workouts-page]
6. Route cards use the workout cards' grid, panel, radius and frame. [route-row]
7. Route card name: display face, bold, 16 px, truncating; class chips (Roman numerals) at its right, the hardest filled neon; an owner-only route carries the lock chip “Only you”. [route-row]
8. Second line “7.1 km · 571 m · 1 climb”, muted. [route-row]
9. Third line one of “Not ridden yet”, “Ridden 3× · last 29 Sep”, “Left off at km 21.3”. [route-row]
10. Actions: Ride (`btn-primary btn-xs`) bottom right, “Carry on” when there is somewhere to carry on; the rest of the card opens the route page; context menu Ride it, Open, a separator, Delete in the danger token. [route-row]
11. Phone order: title, search, Your workouts, Your routes, Measure, Curated; nothing scrolls sideways. [workouts-page]

#### route, phone-route

Capture: `/workouts/routes/<id>` for the hairpin and the rolling route (≥ 2 classed climbs, a descent, a flat); whole page body, desk and phone, both schemes. Targets: v2-routes (How column); v3-roads (stat row, your times); v2-summary (climbs table). Canon: ADR-0063; SPEC's route, place and segment sections.

1. Header: “← Workouts” in xs muted text over the name as `page-title`; one stat row in the display face: km, m climbed, classed climbs, loop or point to point. [route-page]
2. At ≥ 1024 px two columns: the road left; a How column of ~300 px right, top-aligned with the first drawing. [route-page]
3. At 1440 × 900 title, stats, shape, profile, How and the primary button show without scrolling. [route-page]
4. How: a stack of hairline rows, each an icon, a label, one line; the selected row a 1 px neon border: “Ride it” [route-page], “Workout on it” [route-workout-on], “Plan it for a crew” [route-plan-crew]. A row exists only once its flow works; never a disabled promise.
5. Which-stretch chips ≥ 28 px, selected in a neon border: Whole road; From km X, only when there is somewhere to carry on; One climb, only when the road has a classed climb. [route-page]
6. Exactly one primary: `btn-primary btn-lg`, the column's full width, enabled; Ride it opens `/ride?road=<id>&from=<m>`. [route-page]
7. “arrives with” nowhere. [#3660]
8. Owner-only route: the title carries “Only you”; Plan it for a crew absent. [route-plan-crew]
9. Shape in a fixed-height panel, ~280 px desk, ~220 px phone: neon line 2.5–3 px, classed climbs overpainted in the grade ramp; start dot, finish ring, circled km ticks; “Only you see this map” inside the panel's bottom-left corner. [road-drawing]
10. Profile a panel: area filled step by step with `--color-grade-1…5`; a Roman class badge (neon fill, on-neon text) above each climb's top; km along the bottom, top and bottom heights at the right; legend 0 · 3 · 6 · 9 · 12 %+; no translucent rectangle. [road-drawing]
11. Climbs one table: class chip, length and average %, gain, “top at km”, your best or “—”; numerals right-aligned; each climb once; names from #3136, generated on the fixture's climbs until then. [route-page]
12. Your rides: Best and Last lines, each with a date and linked to its ride; no rides, one teaching line. [route-page]
13. Rename (≤ ~480 px), the privacy line (once) and Delete (`btn-danger`) last, under one divider. [route-page]
14. Phone order: back link, title, stats, primary, How, stretch, profile, shape, climbs, rides, rename, privacy, Delete; drawings `width="100%"`; the table scrolls in its own box. [route-page] [road-drawing]
15. No watt, glow, shadow or blur anywhere.

#### import-idle, import, import-saved

Capture: `/workouts/import` idle; after the hairpin GPX is read; after Save. Desk and phone. Targets: v2-routes (dashed drop card, idle only); v2-summary (stat tiles).

1. Header “Import a workout or a route”, a subline naming .zwo and .erg, and .gpx, .tcx and .fit; with `?as=route`, “Import a route”. [importer]
2. Dashed border only while idle, or while dragging (then neon dashed on `bg-neon/5`); once a file is loaded the preview is a solid panel. [importer]
3. Panel's first row: file icon, file name in mono xs, “Choose another file” as a ghost button at the right. [importer]
4. The name an object title with the route page's stat row; shape and profile the shared drawings, the shape filling its panel. [importer] [road-drawing]
5. “At your pace” and “At the reference pace” two stat tiles; “What we fixed” only when something was fixed. [importer]
6. Action row: “Save to my routes” (`btn-primary btn-lg`); “Ride it now” (`btn-secondary btn-lg`), enabled; “Plan it for a crew”, linking to the session picker once design/route-plan-crew lands, absent until then. [importer]
7. After Save a banner “<name> is on your routes.” with Open it and Ride it, plus “Import another file”; nothing says a feature “is coming”. [importer]
8. Privacy line once; on a phone the actions stack full width, primary first. [importer]

#### routes

Capture: `/workouts/routes` and `?r=<id>`, at 1440, 1280, 1024 and 375 px wide. Target: v2-routes, the whole frame but its sidebar (D6).

1. `SectionTabs` “Workouts · Routes” top left of the content; sidebar unchanged. [routes-view]
2. “Routes” the `page-title`; source tabs only where they have data; “Import a route” a `btn-secondary` top right. [routes-view]
3. Filter chips for distance, ascent, and time at your pace. [routes-view]
4. At ≥ 1280 px three columns: a rail of ~240 px of route rows, the selected in a neon border; the road in the shared drawings; the How column. [routes-view]
5. Selection lives in `?r=`; the route page's back link reads “← Routes”. [routes-view]
6. The rail ends with a dashed card “Drop a GPX, TCX or FIT” and the privacy line. [routes-view]
7. At 1024–1279 px rail and road, How under the road; at 375 the rail only. [routes-view]
8. All four states render; the empty state teaches in one line. [routes-view]

### D. After the ride (desk)

#### closing-card, closing-card-road, closing-card-session

Capture: a simulated ride of ≥ 65 s, then End ride; as a workout ride, a road ride and a two-rider session; desk and phone, both schemes, plus once with reduced motion. Targets: v2-summary (layout); v3-motion (end state).

1. The card spans the content column; no max-width, no centred box. [closing-card]
2. Header is `RecapHeader`: eyebrow “<WEEKDAY> · <RIDE KIND> · SOLO|<CREW>”; the title below, ~26 px bold, display face; no logo. [closing-card]
3. Actions on the header row, right-aligned: secondary first, Done last and the only filled button; each ≥ 44 px. [closing-card]
4. At 1440 × 900 header, actions and the first tile row show without scrolling. [closing-card]
5. At ≥ 1280 px two columns, 16 px gap, tops aligned: left 470 px, the trace over the zone bar, or on a road the map over the profile; right, everything else. [closing-card]
6. Tiles are `RecapTiles`, 3 × 2, ~58 px tall, each an eyebrow label, a 24 px display-face value, a smaller muted unit; labels and order match the ride page's; a missing value drops its tile, never shows 0. [closing-card]
7. Section labels eyebrows without icons. The trace in zone tokens, with a dashed neon FTP line; no watt, no glow. [closing-card]
8. A medal never pushes the actions or tiles below the fold. [closing-card]
9. Road ride: the map shows the ridden trace in zones with climb labels such as “III · 11:06”; profile ~120 px tall, climbs labelled; climbs table CLIMB, CLASS, TIME, W/KG, VAM, TRY, VS BEST; “BEST −0:18” in the ok token only where SPEC's PB-highlight rule allows (≥ 35 m of gain, ≤ 3 per ride). [3141-road-recap]
10. The right column keeps a place for the crew climb board [#3147] and photos [#3230]. [3141-road-recap]
11. On the rider's own card only, a wallet panel bottom right: WALLET with the outlined Batzen mark; “+48 Batzen · now 1,284”; the wish line over a 6 px neon bar; “<n> Batzen to go, about <n> rides like this one”. [3158-wallet-panel]
12. A session's card: the same frame grows a roster section; no other rider's number in watt (ADR-0046). [closing-card]
13. Phone: one column, header, actions, tiles, the left column's content, then the rest. Reduced motion: the finished card at once. [closing-card] [multi:reduced-motion]

#### ride-detail

Capture: `/history/<seeded id>`, desk and phone; a crew session's ride on a road, ridden past its minute, as the road's owner sees theirs (`ride-detail-session-road`, desk) and as the other rider sees theirs (`ride-detail-session-road-rider`, desk: the generated name, G10). Target: v2-summary.

1. Header is the closing card's `RecapHeader`. [ride-page]
2. Actions one row: Share, “Download the poster”, Export, a separator, Delete last in danger; Delete also last in the context menu. [ride-page]
3. The same `RecapTiles` directly under the header; the road section reuses the closing card's grid. [ride-page] [#3140]
4. Phone: one column; actions wrap, Delete last. [ride-page]

#### poster

Capture: `/api/rides/<id>/card.png` for a road ride, 1080 × 1080. Target: v2-summary's profile.

1. The profile fills the middle band, in zone ink.
2. Each timed climb a summit tick labelled “<class> <name> · <time>”; labels never overlap (when two would, the later drops its name); climb names are #3136's. [poster-climbs]
3. km ticks every 10 km; a small height credit at the bottom. [poster-climbs]
4. No effort marked at save or hidden near a zone is labelled; no place name its audience may not see (G10). [poster-climbs] [test:internal/og]
5. Its own dark picture in both schemes; nothing on it glows.

#### history, history-rides

Capture: `/history` with no ride and with one seeded ride; whole page body, desk and phone. Target: v2-collections (the header; tabs per D6).

1. “Rides” the `page-title`, with its subline; directly under it `SectionTabs` “Rides · Collections”, left-aligned with the title. [collections]
2. The sidebar keeps one Rides row, lit on both tabs.
3. Empty state: a dashed box across the full width, one line plus “Ride solo”.
4. Phone: the tab strip fits one line.

#### collections

Capture: the Collections tab after one seeded road ride, desk and phone. Target: v2-collections.

1. Header: `page-title`, a lock icon, “Only you see these numbers”. [collections]
2. Three equal cards: EVEREST LADDER: Everest 8,849 m, Stratosphere 50,000 m and Kármán line 100,000 m, each “<done> of <target> m” over a 6 px bar [collections]; CLIMBS BY CLASS: HC and I–IV [collections]; REGIONS AND CONSISTENCY: Cantons “n of 26” and Eddington “E = n” [3145-explorer].
3. Explorer map 2/3 of the width: z14 tiles, ridden tiles neon at ~60 %; largest square outlined; ridden line ink; a caption box top left, tile credit bottom right; only what was ridden drawn. [3145-explorer]
4. Col book: eight columns of stamps, each height, name and “3× · best 44:36”; the latest stamp foil; a pass not yet ridden dashed at 50 %. [3143-col-book]
5. All on the neon ramp: no zones, watt or glow; “Everesting” never appears. [collections]
6. Before the first road ride each card is one teaching line. Phone: cards stack, the map scrolls in its own box, the col book has two columns. [collections]

### E. Home, settings and the landing page (desk)

#### home, phone-home

Capture: `/home` for Designer, in one crew with two sessions planned this week; desk and phone, both schemes. Targets: v3-events (week list); v2-summary (tiles). No Home mock: this list is the bar.

1. The page fills the column; every section starts on the title's left edge (x = 272 at 1440 px). [home]
2. Order: greeting; one action row; the set-up card only while steps remain, the Crew Tour (#3279) beside it where shown; four tiles; This week. The desktop-app notice last. [home]
3. At 1440 × 900 the This week heading and its first row show without scrolling. [home]
4. “Start a crew” once in the main column; the action row has exactly one filled button. [home]
5. At ≥ 1024 px four equal tiles: an eyebrow, a value at 24–28 px in the display face, a muted unit on the value's baseline; no neon or watt units; nothing glows. [home]
6. At ≥ 1280 px two equal columns: This week left; Around right now above Recent rides right. [home]
7. Week list: day headers eyebrows, today's “<DAY> · TODAY”; time in a fixed column of ~56 px; each row a kind eyebrow, title, muted meta line, right-aligned count; past rows dimmed; a session running now shows an ok-token dot and “· RIDING NOW”; rows ≥ 44 px, the whole row the link. [home-week]
8. Nothing this week: the next planned session under NEXT. Nothing at all: one teaching line and a link to a crew's Schedule. [home-week]
9. Phone: tiles 2 × 2, columns stacked; action buttons ≥ 44 px; nothing scrolls sideways. [home]

#### appearance, appearance-advanced

Capture: `/settings/appearance` whole page body; again with Advanced open; again under reduced motion; desk and phone, both schemes. Target: none drawn; the bar is ADR-0079's table and the Settings kit.

1. One fixed-width label column: every row's first control at the same x. [appearance]
2. Theme eyebrow “THEME · LIGHT” or “THEME · DARK”; “White” nowhere. [appearance]
3. Every single-choice row: one selected style (`btn-primary`), one unselected (`btn-secondary`), each ≥ 28 px. [appearance]
4. Theme cards: two equal columns, each a 64 × 44 swatch; the chosen card an ink border. [appearance]
5. The ROAD row is gone. A collapsed “Advanced” at the panel's foot holds World: Full · Steady · Light · Flat, each with ADR-0079's line. [3214-world-control]
6. Reduced motion: Flat chosen, with one “Show the world (steady camera)” button. [3214-world-control] [multi:reduced-motion]
7. Hints one muted line: right of the row at ≥ 1024 px, below it on a phone; nothing scrolls sideways. [appearance]

#### settings-this-computer

Capture: `/settings/notifications` whole page body with a stand-in desktop bridge: as macOS (`settings-this-computer`), Linux with the tray icon on (`-linux`) and off (`-linux-off`), a phone as macOS (`-phone`), a plain browser (`-browser`); both schemes. Target: none drawn; the bar is the Settings kit, ux.md's capability gating and ADR-0037's #3843 amendment.

1. "This computer" is one panel after the other Notifications sections, on the column's left edge; a plain browser shows none. [3843] [multi:browser]
2. Each switch one row: a checkbox on the label's first line, one muted hint under the label; every row's checkbox at the same x. [3843]
3. The tray row names the platform's place: "Show WattRoom in the menu bar" on macOS, "in the system tray" on Linux; by default unticked on macOS, ticked on Linux. [3843] [multi:linux]
4. Icon off on Windows or Linux: the launch-at-login hint says WattRoom opens when you sign in, names no tray. [3843] [multi:linux-off]
5. Nothing glows; nothing scrolls sideways at 375 px. [3843]

#### sound-dialog

Capture: a voice channel at 1440 × 900, the sidebar's Sound button, the dialog open without a call, at the top (`sound-dialog`) and scrolled to its foot (`sound-dialog-bottom`); then `/settings/voice` whole page body; both schemes. Both dialog shots carry `dialogTargets` in their probe JSON: every slider's and Done's height, each select's x and width, the dialog's scrollHeight against clientHeight. Target: none drawn; the bar is ux.md's tap-target rule and the dialog's own line, “the levels you reach for mid-ride”.

1. The five faders, the gate slider and Done have hit boxes ≥ 44 px tall (`btn-lg` for Done); thumb and track keep their drawn size, centred in the box. [3748] [probe:dialogTargets]
2. Device row: one column of full-width selects; no label wraps, none truncates to a stub; the three selects line up. [3748] [probe:dialogTargets]
3. `/settings/voice` draws the same faders at the 24 px desk floor, not 44; it does not grow with the dialog. [3748]
4. Nothing in the dialog glows; at 1440 × 900 it scrolls inside the window rather than clipping Done. [3748] [probe:dialogTargets]

#### landing

Capture: `/` signed out, desk and phone, both schemes.

1. The landing hero (`lib/brand/LandingHero.svelte`) renders as today, or with ADR-0073's figure; never broken or empty after the clay-rider modules go. [world-figure]

### F. Garage (desk)

#### garage-shop

Capture: `/garage`, Shop tab, after the dev-only Batzen grant; desk and phone, both schemes. Targets: shop-catalogue, v3-shop, v2-garage; D6–D9 apply.

1. One sidebar row, Garage, after Friends, lit on every tab; nothing else added to the sidebar. [garage-frame]
2. Header: the `page-title`; “Looks only. Nothing here makes you faster.” on the same baseline; the wallet right-aligned: outlined Batzen mark (~28 px), balance at ~24 px tabular, “Batzen” small beside it, “about N of your rides” muted under it. [garage-frame]
3. `SectionTabs` “Shop · Locker · Makers”, Makers only when #3254's flag is on; a search field right-aligned on the same row. [garage-frame] [garage-shop]
4. Rail 200–235 px wide: “All · Buy · Earn · Free”; BIKE and RIDER groups with muted counts; the chosen slot a filled row. [garage-shop]
5. Above the grid: the slot's name and “<n> items · <min>–<max> Batzen”. [garage-shop]
6. Four equal columns, 16 px gaps. Each card: a thumbnail 55–60 % of the card on the paper preview ground; era chip bottom left, STARTER top right; the name, a spec of ≤ two lines; a hairline; a price row with “Try on” as a secondary button. [garage-shop]
7. Item states: owned “Owned”, or “In your garage from day one” for a starter; worn shows WEARING; earned-only a how-to-earn line, no price; a crew item “Free for members”; one the rider cannot afford “about N rides”, its buy button disabled with that hint. [garage-shop]
8. No hero banner, no watt, no glow; all four states render. [garage-frame] [garage-shop]
9. Phone: the rail a chip row, the grid two columns; nothing scrolls sideways. [garage-shop]

#### garage-locker

Targets: shop-locker, v2-garage, v3-shop.

1. “The locker” centred over the stage; the figure on its bike on a dark stage with one lit ellipse, no glow, no bloom. [3157-locker]
2. Slot lists: 17 rider rows left, 22 bike rows right, each ~36 px; each row a 20 px numbered neon disc, slot eyebrow, item name, and “price”, “free” or “earned”; the discs on the figure match rows 1–39, no two overlapping by more than half a disc. [3157-locker]
3. Look switch “Golden hour · Diorama · Ride look” at the stage's top left. [3157-locker]
4. Try-on bar “Trying: <item>” with “Put it back” and “Wear it”; “Wear it” disabled with a hint when the rider cannot afford the item. [3157-locker]
5. Summary pills: slots filled, Batzen bought, “earned, never sold”; no dev pills; no watts, W/kg or weight. [3157-locker]
6. Without WebGL2, under reduced motion, or on a phone: a 2D SVG figure with the same callouts, no spin. [3157-locker] [multi:no-webgl]
7. Two cards side by side: “Earning, only you see this” and “The Swiss calendar, back every year”. [locker-earning]
8. Crew kit panel, only for a crew's owner or admins: a preview ~170 px wide; template pills; three rows of 34 px swatches; the crew's own icon the only emblem, no upload, no text. [3162-crew-kit] [multi:second-rider]

#### garage-makers

Capture: with #3254's flag on. Target: shop-makers.

1. Four equal columns, gaps ~18 px. [3255-makers]
2. Each maker card: a banner ~128 px tall in the maker's colour, with a round badge, the wordmark, an era chip; a paper body: an italic etymology line, a 2–3 line story, the discipline, three thumbnails, a hairline, “<n> items · <min>–<max> Batzen · <n> earned”. [3255-makers]
3. Badges round or oval, never shields; no cross, no “Swiss made”; wordmarks in the bundled OFL fonts. [3255-makers]
4. A card opens the Shop filtered to that maker; phone: the grid one column. [3255-makers]

### G. Open rides (desk)

#### open-rides

Target: v3-events, with D10. Canon: ADR-0076; SPEC “Open rides”.

1. At ≥ 1280 px two panes split by a hairline: This week (~480 px) and the selected ride. [3307-open-rides]
2. Filter pills “All · Open rides · Races · My crews”; the chosen pill a neon border and tint. [3307-open-rides]
3. Each row: the time, 15 px display face, in a fixed column; a kind eyebrow, with an ok-token dot for RIDING NOW; title and meta line; an outlined count pill “<n> crews · <n> alone”. [3307-open-rides]
4. Right pane: eyebrow “OPEN RIDE · HOSTED BY <crew> · <DAY TIME>”; title at 22 px; countdown ~44 px, in ink, not watt. [3307-open-rides]
5. Readiness chips; the pinned disclosure directly above the actions; “Enter the pen” as `btn-primary btn-lg`. [3307-open-rides]
6. Only the rider's own people named; strangers are counts. Phone: the list first; a ride opens as its own page. [3307-open-rides]
