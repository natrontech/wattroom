---
name: pickup-feedback
description: Turn one rider feedback report into a draft PR with a regression test. Use when working the feedback queue, typically driven by /loop.
---

# Pick up one rider report

A rider tapped `⚑` mid-ride and kept pedalling. The report arrived as a GitHub issue labelled
`feedback` with a payload attached ([ADR-0006](../../../docs/decisions/0006-alpha-feedback-loop.md)).
Your job this tick: **one** issue, from report to draft PR. Not two. Not a sweep of the queue.

## 1. Find work, or do nothing

```sh
gh issue list --label feedback --state open --search "no:assignee sort:created-asc" --limit 5
```

Nothing unassigned → say so in one line and stop. An empty queue is a fine outcome; do not go
looking for other work, and do not re-open triage on issues someone else has claimed.

## 2. Claim before you read deeply

`gh issue edit <n> --add-assignee @me` plus a one-line approach comment, per
[`.claude/rules/git.md`](../../rules/git.md). Claiming first is what stops two agents landing the
same fix; you can always unassign at step 4.

## 3. Read the report

The payload is gzipped in a `<details>` block: ~120 s of ticks, WS/BLE state transitions, console
errors, the session's server log lines, build SHA, browser/OS, trainer model. Check the comments
too — dedup means one issue can carry "also hit by three other riders", and how many riders and how
many builds it spans tells you whether it is a race or a regression.

Read the Grafana deep-link before forming a theory. It is windowed on the incident and it is the
cheapest way to tell "this rider's trainer dropped out" from "the hub stopped ticking for everyone".

## 4. Reproduce before you fix — this is the gate

Replay the captured trace through `SimulatedTrainer` and drive it with Playwright (#54). You are
looking to **see the symptom**, not to confirm a theory.

If it does not reproduce, do not fix by inference. Comment what you tried, what the trace shows,
and what is missing — a second occurrence, a firmware version, a hardware session per
[docs/HARDWARE-SESSIONS.md](../../../docs/HARDWARE-SESSIONS.md) — then unassign and stop. An
unreproduced bug with a plausible patch on top of it is worse than an open issue: it burns the
rider's report and leaves the real bug live.

Some classes genuinely will not reproduce off the rider's machine: GPU/browser rendering, one
specific trainer's firmware quirk. Say which class you think it is and what would settle it.

## 5. Fix, keeping the replay as the regression test

Branch `fix/<slug>`, draft PR early with `Closes #<n>`. The replay from step 4 **is** the test —
commit it as a fixture, with user and room identifiers stripped and the numeric series kept. The
fix is done when that test goes from failing to passing, and it stays in the suite afterwards.

Scope discipline is the whole point of one-issue-per-tick: anything else you notice becomes a new
issue on the right milestone, never extra commits on this PR.

## 6. Verify like a human would, then hand over

`make ci`, then the [`verify`](../verify/SKILL.md) skill — the affected flow observed working in the
running app, not "tests pass". Attach a before/after screenshot pair from the Playwright run to the
PR; the rider could not screenshot mid-ride, so you produce the picture. Comment on the issue with
what shipped and mark the PR ready.

Then stop. **Never merge, never push `main`, never deploy.** Production is `wattroom.ch` on one VM
and every deploy is a deliberate human act driven from the homelab repo — a fix sitting in a green
draft PR is a finished tick.

## Privacy

The payload is one rider's ride telemetry, held under a "rides private by default" promise. It stays
in the repo and the issue: never paste it into an external service, never widen it to other riders'
data, and strip identifiers from anything you commit as a fixture.
