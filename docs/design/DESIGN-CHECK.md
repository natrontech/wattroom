# Design check

Every PR a rider can see passes this check before it leaves draft. The check compares what the branch renders with the target Jan chose.

The comparison is made by a reviewer that:
- did not write the change;
- is not told what the change tried to do;
- builds its own checklist from the canon;
- defaults to FAIL.

Tests show a page is correct; they cannot show it looks right. This check does.

The canon it checks against:
- `docs/design/TARGETS.md`: surfaces, targets, standing deviations D1–D17, the one-home table, global rules G1–G10, flows and must-match lists;
- `docs/design/targets/`: the images.

## 1. Does this PR need it?

**Yes**, when the diff changes what a rider sees:
- anything under `web/src` that renders: components, routes, `app.css` tokens and `@utility` classes, `themes.ts`, `$lib/world`;
- server output that gets drawn: `internal/og` posters and share cards;
- the desktop shell's chrome.

**No**, when a rider cannot see the change: server logic with no rendered output, the protocol, tests, CI and docs. This is the same line `no-changelog` draws. If you are unsure, run the check; it costs minutes.

## 2. Which surfaces

The author does not choose the surfaces by judgement. They come from two sources:

1. **The issue's Surfaces line.** Use it before your first edit, while the diff is still empty.
2. **The surface map, after your last edit.** Run this from the worktree root:
   ```sh
   node web/scripts/design-surfaces.mjs
   ```
   It maps `git diff --name-only origin/main...HEAD` to surface ids, using `docs/design/surface-map.json`. For each surface it prints the files that selected it.

Every surface either source names gets captured.

If the map adds a surface after you have started, capture its “before” from main in a scratch worktree. Run each command from the worktree root named in its comment:

```sh
# from your worktree
git worktree add --detach <scratchpad>/before-main origin/main
# from <scratchpad>/before-main: run its own dev pair (§3), capture (§4), stop that pair, then
make dev-db-drop
# from your worktree again
git worktree remove <scratchpad>/before-main
```

A surface missing from TARGETS.md gets added in this PR. Give it:
- an id;
- a capture recipe;
- a target, or “none drawn, canon is the bar”;
- the canon it follows;
- a must-match list with owner and check tags;
- a line in `surface-map.json`.

The system grows through the PRs that need it.

This table is a readable copy of the map. When they disagree, the JSON wins and the table gets corrected.

| You changed | Surfaces |
|---|---|
| `RidingSurface`, `docks.ts`, `BikeComputer`, `computer-pages.ts`, `lib/session/RideHeader.svelte`, `Skyline`, `IntervalGraph`, `Instrument`, `FlatRoad`, `lib/world/ride-view.ts` | every `ride-*` and `phone-ride*`, `ride-tv`, `ride-ramp` |
| `RoadRiding`, `SoloRoadRide` | `ride-free-road`, `ride-free-road-world`, `ride-road-end`, `hud`, `hud-shell` |
| `lib/ride/FreeRide.svelte` | `ride-channel-free` |
| `routes/(app)/ramp/**` | `ride-ramp` |
| session `Training`, the crew session pages | `ride-session-road`, `ride-session-flat`, `closing-card-session` |
| the Watch page, `SpectatorView` | `ride-watch` |
| `TvMode`, `TvOverlay` | `ride-tv` |
| `lib/workout/ride-life.svelte.ts`, `routes/(app)/+layout.svelte` | `ride-free-road` (light OS), `ride-countin`, `ride-status`, plus one surface per group below |
| `$lib/world/**`, `RideWorld` | `world-start`, `world-end` (or `dev-world`), `ride-road-world`, `ride-free-road-world`, `ride-workout-world`, `phone-ride-road` |
| `$lib/brand/**` | `landing` |
| `PreRide`, `RoadPick` | `ride-preride`, `ride-roadpick` |
| `routes/(app)/workouts/**`, `RouteShape`, `RouteProfile`, `RoutePreview`, `RouteShelf`, `RoutePicker`, `RouteRow` | `workouts`, `phone-workouts`, `route`, `phone-route`, `import-idle`, `import`, `import-saved`, `routes`, `ride-roadpick` |
| `SessionSummary`, `OwnRide`, `SessionLayers`, `RecapHeader`, `RecapTiles` | `closing-card`, `closing-card-road`, `closing-card-session`, `ride-detail` |
| `routes/(app)/history/**` | `history`, `history-rides`, `ride-detail`, `collections` |
| `internal/og` | `poster` |
| `routes/(app)/home/**`, `$lib/home` | `home`, `phone-home` |
| `$lib/profile/Appearance` | `appearance`, `appearance-advanced` |
| `SectionTabs`, the Settings layout | `appearance`, `history`, `routes`, `garage-shop` |
| `routes/(app)/garage/**` | `garage-shop`, `garage-locker`, `garage-makers` |
| open rides | `open-rides` |
| `app.css` `@theme` or `@utility`, `themes.ts` | one surface per group, both schemes: `ride-workout-flat`, `ride-road-world`, `workouts`, `route`, `closing-card`, `home`, `appearance` |

## 3. Your own dev pair

Work only in your own worktree. Ports and the database are derived per worktree.

Your shell keeps no environment between calls, so every command that uses a port:
- runs from the worktree root;
- starts with `eval "$(scripts/dev-env.sh print)";` in the same call.

(`make dev-env` only prints a banner; it sets nothing.)

```sh
eval "$(scripts/dev-env.sh print)"; make infra   # the shared Postgres + LiveKit; a no-op when up
```

Start both servers in the background. Redirect each one's output to a log in your scratchpad, and record its PID:

```sh
S=<your scratchpad>
nohup make dev-server > "$S/dev-server.log" 2>&1 & echo $! > "$S/dev-server.pid"
nohup make dev-web    > "$S/dev-web.log"    2>&1 & echo $! > "$S/dev-web.pid"
```

A harness background runner is fine too, as long as the PID is written the same way.
- Never pipe a server into `head`: SIGPIPE kills it.
- Wait until `eval "$(scripts/dev-env.sh print)"; curl -sf "http://localhost:$WATTROOM_DEV_WEB_PORT/api/healthz"` answers.
- A route directory created after Vite started gets no Tailwind classes until you restart `make dev-web`.

**Stop only what you started.** `make` spawns air, `go run` and Vite, so killing make's PID alone orphans them. Kill the process tree under each PID you recorded, then anything still listening on this worktree's derived ports:

```sh
eval "$(scripts/dev-env.sh print)"; S=<your scratchpad>
tree() { for c in $(pgrep -P "$1"); do tree "$c"; done; echo "$1"; }
kill $(tree "$(cat "$S/dev-server.pid")") $(tree "$(cat "$S/dev-web.pid")") 2>/dev/null
kill $(lsof -t -sTCP:LISTEN -iTCP:"$WATTROOM_DEV_SERVER_PORT" -iTCP:"$WATTROOM_DEV_WEB_PORT") 2>/dev/null
```

Never use `pkill`, `killall` or a kill by name pattern. Other agents' servers and the operator's own apps run on this machine.

Run `make dev-db-drop` before you remove a worktree. LiveKit is shared: if a capture joins voice, say so in the PR.

## 4. Capture “before”, before your first edit

Your branch is cut from `origin/main`, so a capture taken now shows main.
- Keep captures under `web/design-shots/<slug>/`, which git ignores.
  - Not under `web/test-results/`: every Playwright run empties it first, so an e2e run between “before” and “after” would take the before set with it.
- Never commit a capture.

```sh
eval "$(scripts/dev-env.sh print)"; make design-shots SURFACES="ride-road-world ride-free-road" SCHEME=both OUT="$PWD/web/design-shots/<slug>/before"
```

It runs `web/e2e/design-shots.spec.ts` against this worktree's dev pair and writes `OUT/dark/` and `OUT/light/`. Leave `SURFACES` out for every surface; leave `OUT` out for a dated folder under `web/design-shots/`. A surface that needs a second rider, a crew or a saved ride seeds it through the API, as the dev rider Designer, and reuses it on the next run. LiveKit is shared: say so in the PR when a capture joined voice.

The spec does the following:
- **Mute** the mixer, writing all four channels in one object: `{ music: 0, cues: 0, board: 0, share: 0 }`. Any capture code you add must do the same.
- **Assert** the ride is running and, on a world surface, that the world mounted. A shot that fails its assertion is written as `FAILED-<id>.png` with the error.
- **Write** `<id>.json` beside each image. This is the only valid source of measurements. A number measured by hand, typed into a note, or taken from a browser pane is never evidence.

World frames differ between runs. Compare structure. For the world's look, use `/dev/world`'s fixed moments, `world-start` and `world-end`.

## 5. Build, then capture “after”

Implement the issue. Re-run `node web/scripts/design-surfaces.mjs` (§2). Then capture every surface into `after-1/`:
- desk surfaces in both schemes;
- the `[multi:…]` captures that your owned items name.

If an item needs a measurement the capture does not yet write, add it to the capture code in this PR. Do not write it down by hand.

## 6. The reviewer

The reviewer is a **fresh session** with no access to your diff, your PR description, your intent, or an earlier reviewer's verdict. A reviewer that knows the story grades the story.

- In Claude Code, launch it with the Agent tool as a general-purpose subagent.
- In another harness, start a new session the same way.

Give it only the filled prompt at the end of this file:
- the issue key;
- the round;
- the surface map's output (surface ids and the files that selected each);
- absolute paths to the target, before, after and probe files;
- any justifications (§8).

It reads TARGETS.md itself and builds its own checklist from the owner tags. You do not decide which items it checks.

**If you cannot start a fresh reviewer session**, as in some agent harnesses:
1. Write a review bundle to `web/design-shots/<slug>/review-bundle.md`, holding every input above and the filled prompt.
2. Leave the PR draft, with “Design check: pending, no reviewer available in this session” and the bundle's contents in the PR body.
3. The orchestrator or the maintainer runs the prompt.

**Never review your own change.**

## 7. The fix loop: at most three rounds

A round is one “after” capture plus one fresh reviewer.

- **PASS:** you are done with the check.
- **FAIL:**
  1. Fix every blocker and major the reviewer found, whether on owned items, global rules, regressions or unnamed deviations.
  2. Fix minors where that is cheap; list the rest in the PR.
  3. Recapture everything into `after-<n+1>/`.
  4. Start the next round with a **new** reviewer (never resume the old one), which rechecks the full list and so catches regressions.

**After round 3, with a blocker or a major left:**
1. The PR stays draft. Its Design check section says FAIL and lists what is left, with the reviewer's evidence.
2. Comment on the issue with that evidence and what you tried.
3. A failure after three rounds is usually a conflict between canon and the target, or between two canon lines. Examples: SPEC's sizes against the corridor at 1440 × 900; a mock's hint against ADR-0071. Name the two lines that disagree, add `needs-human-input` to the issue, and mention the maintainer (Jan).
4. Move on to the next lane issue that does not depend on this one. The lane is mostly serial, so a silent stall stops everything behind it.

A PR is never marked ready with a FAIL.

Never edit a must-match item in TARGETS.md or in the issue to make a round pass. An item that is genuinely wrong gets its own PR, citing the canon line that shows it is wrong.

## 8. When a deviation may stand instead of being fixed

A deviation may stand only in the cases below. Record each one in the PR under “Justified deviations”, with the item, the reason and the citation. The next reviewer accepts or rejects it.

- **J1. Canon disagrees with the target.** Cite the ADR, the SPEC line, the rule, or a standing deviation D1–D17.
- **J2. Another issue owns the item.** Cite the issue, and show this PR left it no worse than before.
- **J3. The capture cannot show the target's state:** a second rider, a class of climb the fixture lacks, a flag that is off, a place name the geo pack does not yet supply. Extend the fixture if you can. Otherwise the item is CANNOT-TELL with that reason, never PASS, and the missing fixture is filed as an issue.
- **J4. A measured constraint.** The mock's proportions cannot hold canon's sizes, so the panel grows. Say by how much, from the probe. A panel never grows into the corridor.
- **J5. A platform or legal constraint:** the YouTube tile (at least 200 × 200, with nothing over it), WCAG, reduced motion.

Never justifiable:
- a broken cave (G1);
- glow on neon, or watt on anything G2 does not list;
- a clipped or unreachable control;
- sideways page scroll;
- text over text;
- a live number shown twice;
- a stand-in rider or bot;
- a riding-surface size under SPEC's floor;
- a capped or centred desk page;
- a new card, strip or sub-row in the sidebar;
- a place or effort shown to someone who may not see it (G10);
- “it is better than before”: improvement is not the bar, the target is.

## 9. What goes in the PR body

This section is filled after the last round:

```md
## Design check

Issue: design/<key>
Surfaces (from the surface map): ride-road-world (1440×900, 1920×1080), ride-free-road-world
Targets: docs/design/targets/v2-ride.png, v2-erg.png
Images: <link> (target | before | after per surface; private to the maintainer's account)
Verdict: PASS (round 2 of 3) · blocker 0 · major 0 · minor 2 · cannot-tell 0

| # | Must match (owned) | Verdict | Evidence |
|---|---|---|---|
| 1 | box table recorded | PASS | TARGETS.md ride-road-world, table present |
| … | … | … | … |

Global rules: G1–G10 PASS (G4: watts 112 px, probe)
Regressions: none
Justified deviations: item 9, W/kg under the watts instead of beside it (J4: 30 % column, probe width 328 px)
Open elsewhere: item 18 sky (Refs #3085), item 23 figure (design/world-figure)
Minors left: …
```

**Images.** Publish one private page showing, for each surface, a row of target | before | after at full size, followed by the reviewer's final verdict.
- In Claude sessions, use the Artifact tool (private by default).
- Otherwise, send the files to the maintainer directly.

Put the link or the file names in the PR body and say the images are private. Never commit captures or push them anywhere else.

## 10. Before marking the PR ready

- The design check passes, and the PR body carries the section above.
- `make ci` is green, and the flow has been seen working in the running app (the `verify` skill).
- The dev pair you started is stopped: only your own PIDs, plus your own derived ports.

## Reviewer prompt (use verbatim; fill the {{…}} slots)

```
You are the design reviewer for a WattRoom pull request. Your job is to find every way the AFTER
screenshots deviate from the TARGET and from WattRoom's design canon. You did not write this change
and you are not told what it tried to do. Default to FAIL: the PR passes only if you have checked
every item that applies against the pixels and the measurements and found no blocker and no major.

INPUTS
Issue key: {{ISSUE_KEY}}   (design/<key>, or #<n> for an existing issue the lane extends)
Round: {{ROUND}} of 3
Surfaces, each with the changed files that selected it (from the surface map, not from the author):
{{SURFACES_WITH_FILES}}
For each surface, absolute paths:
- TARGET image(s): {{TARGET_PATHS}}
- BEFORE (main): {{BEFORE_PATHS}}
- AFTER (this branch): {{AFTER_PATHS}}
- PROBES (the measurement JSON the capture run wrote; nothing else counts as a measurement):
  {{PROBE_PATHS}}
- MULTI captures (sequences, second rider, reduced motion, other scheme): {{MULTI_PATHS_OR_NONE}}
Justifications the author offers: {{JUSTIFICATIONS_OR_NONE}}
You may open docs/design/TARGETS.md and the ADRs, docs/SPEC.md sections and .claude/rules files it
cites. Open nothing else from the change.

BUILD YOUR CHECKLIST FIRST
1. Open docs/design/TARGETS.md. Read "How to read a target", "Precedence and standing deviations"
   (D1-D17), "One home per number", the global rules G1-G10, "Flows", and the section of every
   surface listed above.
2. OWNED items: every must-match item on those surfaces tagged [{{ISSUE_KEY_SHORT}}]. OTHER items:
   every other item on those surfaces. Standing deviations are never findings.
3. Each item's check tag says where its answer lives: no tag = the image; [probe:key] = that key in
   the probe JSON; [test:file] = open the file and confirm it asserts the item; [multi:capture] =
   that named capture. If the source is missing, the item is CANNOT-TELL. Never infer motion or
   state from a single still.
4. A justification is ACCEPTED only if it cites an ADR, a docs/SPEC.md line, a .claude/rules file,
   a standing deviation number or an issue that owns the item, and the citation really says so.
   None ever covers: the cave, glow or watt beyond G2's list, clipping, sideways scroll, text over
   text, a duplicated live number, a stand-in rider, a size under SPEC's floor, a capped or centred
   desk page, a sidebar card, or a privacy leak (G10).

METHOD, in this order
1. Open every image with your file-reading tool. Do not rely on file names or on anything said
   about them.
2. Before walking the checklist, write down, for each surface, the five largest visual differences
   between the TARGET's framed mock and the AFTER: position, grouping, size, alignment, empty
   space, colour, what is missing, what is extra. Ignore the mock's data (names, numbers, places);
   only the framed mock is the bar.
3. Walk the owned items one by one: PASS, FAIL or CANNOT-TELL, with evidence (where on the AFTER,
   as x,y or the panel's name; what you see; what the item asks; the probe value where tagged).
4. Walk the global rules the same way. On a riding surface always check: the whole frame dark,
   sidebar included; watt only on G2's three marks; exactly one watts figure; each number in its
   one home; nothing neon glowing; panels flat, unnested, unclipped, no empty band over 24 px;
   nothing in the corridor; sizes against SPEC; no sentence except a canon status line. On a desk
   surface: the page fills the column; left edges on one line; nothing glows; four states where
   shown; no sideways scroll at 375 px.
5. Compare AFTER with BEFORE on every item and rule. List anything that was right before and is
   worse now.
6. Hunt for ugliness no item names: left edges off by more than 4 px; uneven gaps; a label wrapped
   onto a second line; text over text; clipped or truncated text; a control floating outside every
   panel; two type styles for one kind of thing; a second accent competing with the first; a
   centred block with empty margins; a panel much larger than its content; one word or number
   shown twice; placeholder or stand-in data; anything that reads as a debug view.
7. Grade every finding:
   blocker - a global rule broken (cave, glow, clipped or unreachable control, sideways page scroll,
             text over text, a live number shown twice or wrong, a privacy leak), or an owned item
             plainly missed;
   major   - visibly off the target's structure: wrong place or grouping, an empty band over 24 px,
             an edge off by more than 8 px, a size under canon's floor, an element missing or
             extra, or any regression;
   minor   - detail within 8 px, tone, a spacing nit.
   CANNOT-TELL on an owned item counts as major unless its named source settles it.
   A global-rule break that BEFORE shows identically on the same surface, and that an open issue
   owns, is not graded: list it under OPEN-ELSEWHERE with that issue. Anything the PR adds or
   makes worse is a regression, graded as above.

OUTPUT, exactly this shape
VERDICT: PASS | FAIL
COUNTS: blocker=<n> major=<n> minor=<n> cannot-tell=<n>
FIRST-LOOK DIFFERENCES:
- <surface>: <five differences>
OWNED ITEMS:
| surface | # | item (short) | PASS/FAIL/CANNOT-TELL | severity | evidence |
GLOBAL RULES:
| rule | PASS/FAIL/CANNOT-TELL | severity | evidence |
REGRESSIONS: <list, or none>
UNNAMED DEVIATIONS: <list with severity, or none>
JUSTIFICATIONS: <each offered one: ACCEPTED or REJECTED, and why>
OPEN-ELSEWHERE: <other issues' items still open, one line each>
CONFLICTS: <any place where two canon lines, or canon and the target, cannot both be met, with the
two lines quoted; or none>
TO FIX FIRST: <the three changes that would most improve the AFTER, most important first>

VERDICT is PASS only when blocker=0 and major=0 across owned items, global rules, regressions and
unnamed deviations. Do not soften a finding because the AFTER improves on the BEFORE: improvement
is not the bar, the target is. Do not propose code. Do not ask questions; decide from what you see.
```
