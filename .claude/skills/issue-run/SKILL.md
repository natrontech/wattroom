---
name: issue-run
description: Take one issue from the queue to merged, or closed with evidence, in one fresh session, so the open-issue count falls. Use for autonomous queue work; scripts/issue-runs.sh starts each run. Never drive it with /loop.
---

# One issue run

A run takes one issue, or one batch (§1), to **merged** or **closed with evidence**, then ends. `scripts/issue-runs.sh` starts the next run in a fresh session. Never `/loop` this skill: a looping session carries every earlier issue in its context and costs about twice the tokens per merge (#3970).

**The score is the open-issue count.** A run that merges one fix and files two findings has made it worse. AGENTS.md and `.claude/rules/` bind every step; this skill only orders the work and spends the budget. `$S` is your scratchpad.

## 0. Main first

`gh run list --branch main --workflow ci.yml --limit 1`, and the same for `e2e.yml`. If either is red, fixing it is this run: find or file its issue, fix it, nothing else. Other workflows (`feedback-canary`, `design-shots`) are not main's health.

## 1. Pick

Not workable: labelled `needs-human-input`, `blocked`, `backlog` or `feedback` (the `pickup-feedback` skill owns that one); assigned; covered by an open PR; or named by a live branch or worktree. A branch whose PR closed standing down is not a claim but kept work. So is a decided draft (source 0).

If `$AGENT_COUNT` is above 1, prefer issues where `number % AGENT_COUNT == AGENT_INDEX`, so the agents beside you start apart. Take the first source that yields an issue:

0. **Decided drafts.** A draft PR parked by a round-3 design FAIL whose issue has since lost `needs-human-input`, with a maintainer comment after the draft's last push. The comment is the decision. Apply it, then run a fresh design check (one round) against the canon as it stands now, and land it. Nothing else resumes these, because the open draft reads as a claim.
   ```sh
   gh pr list --draft --author jlaubot --json number,title,closingIssuesReferences
   ```
1. **Kept work.** A PR closed unmerged ("standing down", "paused for budget") whose `Closes` issue is still open. Read why it stopped. Unless the maintainer rejected the approach, resume its branch, or `git fetch origin pull/<pr>/head` if the branch is gone. Don't start over.
   ```sh
   gh pr list --state closed --search "is:unmerged" --limit 30 --json number,headRefName,closingIssuesReferences
   ```
2. **Done on main.** An open issue that merged PRs name. Check its must-haves on main. If all are met, close it, naming the PRs and how you checked. If one is missing, that piece is your work.
   ```sh
   gh pr list --state merged --limit 300 --json body --jq '.[].body' | grep -oiE '(refs|part of) #[0-9]+' | grep -oE '[0-9]+' | sort -u > $S/named
   gh issue list --state open --limit 1000 --json number --jq '.[].number' | sort > $S/open
   comm -12 $S/named $S/open
   ```
3. **Bugs**, lowest milestone first: `gh issue list --state open --label bug --search "no:assignee" --limit 100 --json number,title,milestone,labels`, sorted by `.milestone.number`.
4. **The rest**, in the same order, smallest first.

**Batch** issues that name the same surface and the same rule (three "under 44 px on a riding surface" issues, say) into one PR, with one `Closes #n` line each, at most five. One design check then covers all of them.

**Claim before you read code.**

1. Check that `git ls-remote --heads origin | grep -E "[/-]<n>([-/]|$)"` names no branch other than kept work.
2. Cut `<type>/<n>-<slug>` per AGENTS.md. If the branch already exists, another agent took the issue seconds ago, so pick again.
3. Assign yourself and add a one-line comment.
4. Run `gh issue view <n> --json assignees,comments` again. If an earlier claim is there, stand down.

## 2. Before the code

- **Read the issue once**, with `--comments`. After that, check it with `--json state,assignees`.
- If it is already fixed, a duplicate, or canon answers it differently, close it with the evidence. That counts as a win.
- If it needs more than one PR of about 600 lines, make the body a checklist. Each PR says `Refs #n` and ticks its box, and the one that ticks the last box says `Closes #n`.
- Run `git log --since=21.days --format='%h %s' -- <the files you'll touch>`. Your change must not undo what those PRs fixed, so run their tests. Recent fixes keep re-fixing last week's fixes.

## 3. Build

- Reproduce first: a test or a design-shot probe that fails on main. Watch it fail.
- Make the smallest diff that meets the issue: no refactor, no cleanup next to it.
- If the design check applies (DESIGN-CHECK step 1), start its capture (`design-check` §2) as soon as the fix builds, not after everything else. Run it in the background with `timeout: 3600000`, because a headless run otherwise stops it at 10 minutes. Seven of the 13 PRs closed unmerged around 2026-10-09 stopped with this step still to run.

## 4. Prove

- Run `make test > $S/test.log 2>&1; echo exit=$?` with the Bash timeout at 600000, then the same for `make lint`, as separate commands. `make ci` stops at the first failure and hides the rest. Read failures with `grep -nE 'FAIL|Error|panic' $S/test.log | head -40`, not the whole log.
- On a fresh worktree, a DB test that fails at about 3 s is the migrate lock: rerun it once. A failure that passes on one rerun is a flake. If an open issue owns it, comment there; otherwise move on.
- Run the `verify` skill for server or web behaviour, the `go-review` skill for hub, protocol, BLE or stats Go, and the `design-check` skill when the PR's issue is labelled `design` or names Surfaces: one round, then land.
- A logic change (not markup or CSS alone) gets one fresh review before ready: the `code-review` skill, or else a fresh Agent given only the issue and `git diff origin/main...`. Fix what it confirms.
- Wait for CI in one call: `scripts/wait-checks.sh <pr>` with the Bash timeout at 600000. It waits for every check, e2e included, because auto-merge ignores e2e. Exit 2 means run it again. Exit 1 names the failing job, so read only that: `gh run view <run-id> --log-failed | tail -n 80`.

## 5. Land

If you're behind main, `git merge origin/main` and push. Never force-push. Mark the PR ready and merge per AGENTS.md, with the squash subject. Check that the PR says `MERGED` and its issues `CLOSED`, and only then clean up.

## 6. Findings

AGENTS.md "Doing it" sets the budget. Comment on the open issue that owns a finding. File at most one new issue per run, only for what a rider would notice or what breaks CI. Minors go in your PR comment.

## 7. Tokens

Every turn re-reads the whole context, so what you load early you pay for on every later turn.

- **Wait in one call** (§4), or in the background with a `timeout` and wait for its notification. Never poll with `sleep`: each poll is a full-context turn, and polling took about 4,700 calls in three weeks.
- **Read canon by section.** TARGETS.md through `node web/scripts/design-surfaces.mjs --targets <ids>`; it was read whole 183 times. For WATTROOM.md, find the heading with `grep -n '^#'` and read that range. Specs come from `docs/spec/<area>.md`.
- **Logs go to `$S`.** Read the failing lines, never a whole build, test or CI log.
- **Design captures stay with the reviewer.** The run takes numbers from the probe `.json` and never opens a capture. For `verify`, prefer the page's text or a Playwright assertion to a screenshot.
- **Sweep with a subagent.** "Where is X used" across the repo goes to an Explore agent, and you get its answer, not its files. Read whole only the files you change (code-quality).

## 8. Stuck

Run `date` when you start. At two hours without a green PR, or on the third failure of the same kind, stop:

1. Push the branch, then close its PR and keep the branch. An open PR reads as a claim.
2. Comment on the issue: what works, what doesn't, and the one command or decision that unblocks it.
3. Unassign yourself. If something outside the code blocks it, add `blocked` and mention @janlauber in the comment. A mention is the push that tells him. Otherwise the next run resumes the branch as kept work.
4. End the run.

If the issue already has two stand-downs, add `needs-human-input` and mention @janlauber with the blocker instead, so no run takes it up a third time.

A design finding is never a stand-down and never holds a PR in draft: fix the blockers you caused, leave the rest in the findings comment and land (DESIGN-CHECK steps 6 and 7).

Kill only processes you started, by PID.

## 9. The last line

End with exactly one line. `scripts/issue-runs.sh` logs it:

```
run: #<issue>[,#<issue>…] merged|closed-done|closed-dup|blocked|released pr:<n>|- opened:<new issues>
```

If nothing is workable, the line is `run: queue empty`, and the runner waits half an hour.
