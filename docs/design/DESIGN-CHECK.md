# Design check

A PR a rider can see leaves draft only after this check: a reviewer that did not write it, is not told what it tried to do, builds its checklist from the canon (`TARGETS.md`, `targets/`) and defaults to FAIL holds what the branch renders against the target.

1. **Needed?** Yes when a rider can see the diff: what renders under `web/src`, `internal/og`, the desktop shell's chrome. No for server logic, the protocol, tests, CI and docs. Unsure: run it.
2. **Surfaces**: the issue's Surfaces line, plus `node web/scripts/design-surfaces.mjs` after your last edit (`surface-map.json` over your diff). A file every page shares selects a small core set. `phone` and `tv` add the phone and TV shots of every captured surface; only the files that lay those out, or the issue, name them. A surface TARGETS.md lacks gets its section (id, capture, target or "none drawn, canon is the bar", canon, tagged must-match list) and its map row in this PR.
3. **After**: rebase on `origin/main`, `make infra`, then `make design-shots SURFACES="<ids>" OUT=web/design-shots/<slug>/after-1` as a background job; wait on its exit, never in a sleep loop. It builds the branch, serves it on a fresh seeded database and shoots desk surfaces in both schemes, riding ones once. The `<id>.json` beside each image is the only valid measurement (one it lacks is added to the capture code); a failed shot is `FAILED-<id>.png`. It mutes the mixer (`{"music":0,"cues":0,"board":0,"share":0}`, one object); capture code you add does too.
4. **Before**: `scripts/design-before.sh web/design-shots/<slug>/before` fetches main's shots for your merge base from CI (`design-shots.yml`). Exit 2: main's run is still going, so `gh run watch <id>` in the background. Exit 1, or a surface missing or FAILED there: capture main yourself from `git worktree add --detach <scratch>/main origin/main`, then `make dev-db-drop` and `git worktree remove` it.
5. **Review**: a fresh reviewer each round, never resumed, given the prompt below verbatim with its slots filled and `node web/scripts/design-surfaces.mjs --targets <ids> > <scratch>/canon.md` as its canon. Never the diff, the PR body, your intent or an earlier verdict; never your own review. No fresh session possible: put the filled prompt in `web/design-shots/<slug>/review-bundle.md`, keep the PR draft with "Design check: pending", and the orchestrator runs it.
6. **Fix, three rounds at most.** Fix every blocker and major you caused, minors where cheap. Re-capture into `after-<n+1>/` only the surfaces not PASSed, plus those `node web/scripts/design-surfaces.mjs $(git diff --name-only <last round's commit>)` selects, and review those; a PASSed surface keeps its verdict. Never edit a must-match item to pass; a wrong one gets its own PR citing canon.
7. **A blocker or major after round 3**: the PR stays draft with FAIL. Comment the evidence on the issue, name the two canon lines that conflict, add `needs-human-input`, mention @janlauber, take the next independent issue.
8. **When a deviation may stand.** Justified (the next reviewer accepts or rejects it): J1 canon outranks the target (cite it); J2 an open issue owns the item, left no worse; J3 the capture cannot show the state (CANNOT-TELL, never PASS; file the fixture); J4 measured (by how much, from the probe; never into the corridor); J5 platform or law (YouTube tile, WCAG, reduced motion). **Never justifiable**: what the prompt's checklist says no justification covers, and "better than before". **Inherited** (#3720) never fails a PR: the same on BEFORE, no worse; no item of it owned by this issue; an open issue owns the fix (file one first). Worse on AFTER is a regression.
9. **PR body**: six lines at most; findings go in a PR review comment.
    ```md
    ## Design check
    Verdict: PASS, round 2 of 3 · blocker 0 · major 0 · minor 2
    Surfaces: ride-road-world, world-start, world-end
    Captures: <private link> (target | before | after per surface)
    Findings: <review comment link>
    ```
10. **Captures** live under `web/design-shots/` (ignored; never `web/test-results/`) and on one private page. Never commit or push them; main's are CI artifacts for 14 days.
11. **Ready** only with PASS, the section above, `make ci` green and the flow seen in the running app.

## Reviewer prompt

```
You review a WattRoom PR's screenshots. You did not write it and are not told what it tried to do.
Find every way AFTER deviates from the TARGET and the canon. Default to FAIL.

Issue {{ISSUE_KEY}}, round {{ROUND}} of 3. Surfaces, each with the files that selected it:
{{SURFACES_WITH_FILES}}
Canon: {{CANON_PATH}}, TARGETS.md cut to these surfaces; read it whole first. You may open what
it cites (ADRs, docs/spec/ via docs/SPEC.md's index, .claude/rules), nothing else of the change.
Per surface: TARGET {{TARGET_PATHS}} | BEFORE, main {{BEFORE_PATHS}} | AFTER {{AFTER_PATHS}} |
PROBES {{PROBE_PATHS}} (the only measurements) | MULTI {{MULTI_PATHS_OR_NONE}}
BEFORE is shot on Linux in software GL, AFTER on the author's machine: glyph raster and the world's
pixels differ, structure must not. Justifications: {{JUSTIFICATIONS_OR_NONE}}
Inherited claims, each with its open issue: {{INHERITED_OR_NONE}}

Checklist. OWNED: must-match items on these surfaces tagged [{{ISSUE_KEY_SHORT}}]; OTHER: the rest;
plus the global rules. Standing deviations are never findings. Check tags: none = the image,
[probe:k] = that probe key, [test:f] = f asserts it, [multi:c] = that capture; source missing =
CANNOT-TELL; never infer motion from one still. A justification stands only if its citation says
so, and none covers: the cave, glow or watt beyond G2, a clipped or unreachable control, sideways
scroll, text over text, a duplicated live number, a stand-in rider, a size under SPEC's floor, a
capped or centred desk page, a sidebar card, strip or sub-row, a privacy leak (G10). An inherited claim stands only if BEFORE fails the same and
no better, no item is OWNED, and the cited open issue owns it; it is then OPEN-ELSEWHERE, uncounted.

Method. 1 Open every image; trust no file name. 2 Per surface, the five largest differences between
the TARGET's framed mock (ignore its data) and AFTER. 3 Owned items: PASS/FAIL/CANNOT-TELL with
evidence (where, what you see, what it asks, probe value). 4 Global rules likewise. Riding: whole
frame dark, sidebar too; watt on G2's three marks only; one watts figure; each number in its home;
no neon glow; panels flat, unnested, unclipped, no empty band over 24 px; nothing in the corridor;
SPEC sizes; no sentence but a canon status line. Desk: fills the column; left edges aligned; no
glow; four states; no sideways scroll at 375 px. 5 AFTER against BEFORE: anything worse is a
regression. 6 Ugliness no item names: edges off over 4 px, uneven gaps, wrapped labels, clipped
text, floating controls, two type styles for one thing, competing accents, centred blocks,
oversized panels, repeats, stand-in data, debug looks.
Grades: blocker = a global rule broken, an owned item plainly missed; major = off the target's
structure (place, grouping, empty band over 24 px, edge off over 8 px, under a floor, missing or
extra) or any regression; minor = within 8 px, tone, spacing. CANNOT-TELL on an owned item is
major unless its named source settles it.

Output exactly:
VERDICT: PASS | FAIL
COUNTS: blocker=n major=n minor=n cannot-tell=n
SURFACES: <surface>: PASS | FAIL | CANNOT-TELL, one line each
FIRST-LOOK: <surface>: <five differences>
OWNED: | surface | # | item | verdict | severity | evidence |
GLOBAL: | rule | verdict | severity | evidence |
REGRESSIONS, UNNAMED, JUSTIFICATIONS, INHERITED, OPEN-ELSEWHERE, CONFLICTS (two canon lines that
cannot both hold, quoted): a line each, or none
TO FIX FIRST: three changes, most important first
PASS only with blocker=0 and major=0 across all of it, confirmed inherited left out. Improvement
is not the bar; the target is. Propose no code. Ask nothing.
```
