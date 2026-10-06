---
name: design-check
description: Run the design check on a rider-visible change: capture its surfaces, have a fresh subagent review them against docs/design/TARGETS.md, fix up to three rounds, and write the PR's Design check section.
---

# Design check

`docs/design/DESIGN-CHECK.md` is the procedure and wins where this file disagrees. Read it first; this is how to run it in Claude Code. `$S` is your scratchpad, `$WT` your worktree's root, `<slug>` the issue's.

## 1. Surfaces

- Take the issue's **Surfaces** line before your first edit.
- After your last edit, from `$WT`: `node web/scripts/design-surfaces.mjs > $S/surfaces.txt`. Its lines are `<surface> <- <file>`; the reviewer gets them as they are.
- The ids to capture are its first column plus the issue's: `ids="$(cut -d' ' -f1 $S/surfaces.txt | sort -u | tr '\n' ' ') <issue's ids>"`. `phone` and `tv` among them switch the phone and TV shots on.

## 2. Capture, in the background

- Rebase on `origin/main` first, so the merge base is main's head.
- After: one Bash call with `run_in_background: true`, then carry on until its notification arrives. Never poll it with `sleep`.
  ```sh
  make design-shots SURFACES="$ids" OUT=web/design-shots/<slug>/after-1 > $S/after-1.log 2>&1
  ```
- Before, meanwhile: `make design-before OUT=web/design-shots/<slug>/before`.
  - Exit 2 printed main's run id: `gh run watch <id> --exit-status` in the background, then `make design-before` again.
  - Exit 1, a surface missing from the download, or a `FAILED-<id>.png` in it: capture main from a scratch worktree, in the background once the branch's capture is done (two builds at once slow both):
    ```sh
    git worktree add --detach $S/main origin/main
    cd $S/main && make design-shots SURFACES="<those ids>" OUT=$WT/web/design-shots/<slug>/before > $S/before.log 2>&1
    ```
    Afterwards `make dev-db-drop` in it, then `git worktree remove $S/main`.
- When a finding asks whether something is new and the before is CI's, capture main locally the same way and hand both sets over as MULTI.
- Measurements come only from each `<id>.json`. Never type a number from a screenshot or the browser pane.

## 3. The reviewer: a fresh Agent every round

- `node web/scripts/design-surfaces.mjs --targets $ids > $S/canon-<n>.md`.
- Launch a `general-purpose` Agent (`run_in_background: false`) with DESIGN-CHECK's reviewer prompt **verbatim**, only the `{{…}}` slots filled: issue key and round, `surfaces.txt`'s lines, the canon file's absolute path, absolute paths to the target (`docs/design/targets/`), before, after and probe files, MULTI captures, your J1–J5 justifications with citations, inherited claims with their open issues.
- Never give it the diff, the PR body, your intent or an earlier verdict. Never resume one with SendMessage: a reviewer that knows the story grades the story.

## 4. Rounds 2 and 3

- Before each round's capture, note its commit: `git rev-parse HEAD > $S/round-<n>.sha`.
- Fix what DESIGN-CHECK step 6 says. The next round's ids are the surfaces the reviewer's `SURFACES:` lines did not PASS, plus those `node web/scripts/design-surfaces.mjs $(git diff --name-only $(cat $S/round-<n>.sha))` selects that this check captured. Capture them into `after-<n+1>/` and review them with a new Agent.
- A blocker or major after round 3: DESIGN-CHECK step 7, then the next independent issue.

## 5. Images, findings, PR body

- Load the `artifact-design` skill, then publish one private page with the **Artifact** tool: per surface a full-size row of target | before | after, then the verdict. Pass the images through `files`, copied into a folder in `$S`. Unavailable: send them to the maintainer with **SendUserFile**.
- The last reviewer's findings go in a PR review comment: `gh pr review <n> --comment --body-file $S/findings.md`.
- The PR body's `## Design check` is DESIGN-CHECK step 9's six lines: verdict and round, surfaces, the captures link (private), the findings link.
- Never commit captures; `web/design-shots/` is ignored.

## 6. Clean up

- `make design-shots` stops the server it started when it exits. Stop anything else you started by the PID you recorded, never with `pkill`, `killall` or a kill by name.
- A scratch worktree: `make dev-db-drop` in it, then `git worktree remove`.
