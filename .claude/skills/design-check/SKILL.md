---
name: design-check
description: Run the design check on a rider-visible change: capture its surfaces, have a fresh subagent review them against docs/design/TARGETS.md, fix up to three rounds, and write the PR's Design check section.
---

# Design check

`docs/design/DESIGN-CHECK.md` is the procedure and wins wherever this file
disagrees with it. This is how to run it in Claude Code. Read DESIGN-CHECK.md
in full before step 1.

## 1. Does the PR need it?

DESIGN-CHECK §1. If a rider can see the diff, yes. If unsure, yes.

## 2. Surfaces

- Before your first edit, take the issue's **Surfaces** line.
- After your last edit, run `node web/scripts/design-surfaces.mjs` from the worktree root.
- Capture every surface either names. A surface TARGETS.md lacks gets its section, and its `surface-map.json` line, in this PR (§2).

## 3. Two dev pairs: main and the branch

The “before” comes from main, so run it in a scratch worktree, detached at
`origin/main` inside your scratchpad. Once you have edited your branch, it
shows your branch, not main. Start each pair from its own worktree root:

```sh
eval "$(scripts/dev-env.sh print)"; make infra
nohup make dev-server > "$S/<pair>-server.log" 2>&1 & echo $! > "$S/<pair>-server.pid"
nohup make dev-web    > "$S/<pair>-web.log"    2>&1 & echo $! > "$S/<pair>-web.pid"
```

- `$S` is your scratchpad.
- Use one Bash call per command, each starting with `eval "$(scripts/dev-env.sh print)";`, because the shell keeps no environment between calls.
- Wait until `curl -sf "http://localhost:$WATTROOM_DEV_WEB_PORT/api/healthz"` answers.
- Never pipe a server into `head`.

## 4. Capture

```sh
eval "$(scripts/dev-env.sh print)"; node web/scripts/design-capture.mjs --base "http://localhost:$WATTROOM_DEV_WEB_PORT" \
  --scheme dark --out "$PWD/web/test-results/design/<slug>/before" <surface …>
```

- Run it against main's pair into `before/`, and against the branch's pair into `after-<round>/`.
- A desk surface is captured in both schemes.
- Measurements come only from each `<id>.json` the script writes. Never type a number into the PR from a screenshot or the browser pane.
- The browser pane is often hidden, and a hidden pane throttles its frames. Capture headless through the script, not through the pane.
- If your own instrumentation patches the page (a wrapped `Worker.postMessage`, say), update it whenever the code it wraps changes. A stale patch breaks the page and looks like your bug.

## 5. The reviewer: a fresh Agent, every round

- Launch a `general-purpose` Agent with `run_in_background: false`.
- Its prompt is DESIGN-CHECK's reviewer prompt, **verbatim**, with only the `{{…}}` slots filled:
  - the issue key and the round;
  - the surface map's output, with the files that selected each surface;
  - absolute paths to the target, before, after and probe files;
  - the MULTI captures;
  - your J1–J5 justifications, each with its citation.
- Never give it the diff, the PR body, your intent or an earlier reviewer's verdict.
- Every round is a new Agent. Never resume one with SendMessage: a reviewer that knows the story grades the story.
- Where a finding asks whether something is new, capture it on main too, and hand both sets over as MULTI inputs. The frames are timed, not locked, and the reviewer must be told so.

## 6. The fix loop

DESIGN-CHECK §7: at most three rounds.

- Fix every blocker and major that your change caused, recapture into `after-<n+1>/`, and start a new reviewer.
- A finding that fails identically on main, on items your issue does not own, and that an open issue owns, is inherited (DESIGN-CHECK §8). Claim it in the reviewer's `{{INHERITED_OR_NONE}}` slot, citing that issue. A confirmed claim does not count, not even against the never-justifiable list. If no open issue owns the finding, file one first.
- If a blocker or major is left after round 3, the PR stays draft. Then:
  - comment the evidence on the issue;
  - name the two canon lines that conflict;
  - add `needs-human-input` and mention @janlauber;
  - move to the next independent issue.

## 7. The images and the PR body

- Publish one private page with the **Artifact** tool:
  - for each surface, a row of target | before | after at full size, then the final verdict;
  - pass the images through `files`, copied into a folder in your scratchpad;
  - load the `artifact-design` skill first.
- If publishing is unavailable, send the files to the maintainer with **SendUserFile** instead.
- Never commit captures. `web/test-results/` is ignored.
- Fill the PR's `## Design check` section from DESIGN-CHECK §9: the target, the surfaces, the image link (marked private) and the verdict, then the owned-items table, the global rules, the regressions, the justified deviations, what is open elsewhere, and the minors left.

## 8. Clean up

- Stop only what you started. Kill each PID tree you recorded, then whatever still listens on that worktree's derived ports (DESIGN-CHECK §3).
- Never use `pkill`, `killall` or a kill by name.
- In the scratch worktree, run `make dev-db-drop`, then `git worktree remove` it.
