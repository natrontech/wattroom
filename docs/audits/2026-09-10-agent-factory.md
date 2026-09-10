# Audit — the agent factory itself — 2026-09-10

Run against main @ `db37a9b9` (release 2026.09.112). This one audits the **process**, not a
subsystem: the issue board, CI cost, the rules and skills every agent reads, worktree hygiene, and
the in-app feedback loop. Measurements are from the GitHub API and the local clone, not estimates.

Closed #656, #1297, #1334, #1670 (in part), #1949 and #1730; produced #2052, #2055, #2056, #2058
and #2060; cut `needs-human-input` from **38 open issues to 8**.

## The brief

> i think we have wayy to many github issues open. […] also lets review our whole claude / codex
> agent setup and rules to make things more efficient […] less capable models and then we have
> review agents with more capabilities, better ci's which currently are maybe also too bloated and
> some useless, and then a nice feedback loop of users directly in the wattroom […] we want to
> really improve this coding factory agent framework.

Three hypotheses. **Two of them did not survive measurement**, and saying so was more valuable than
acting on them.

## What the numbers said

| Claim | Measured | Verdict |
| --- | --- | --- |
| Too many open issues | 65 open against 83 / 215 / 120 closed on the previous three days; 915 issues and 1135 PRs lifetime | **Under one day of inventory.** Not a backlog |
| CI is bloated | `CI` 201 s avg, `e2e` 213 s, `publish` 117 s, `changelog` 9 s — parallel, path-gated, superseded runs cancelled. 3 failures in 140 concluded runs | **Lean.** Nothing to cut |
| The feedback loop needs building | ADR-0006's pipeline exists end to end — ring buffer, intake, JSONL, fingerprint dedup, issue filing, `pickup-feedback` | **Built, and it was broken** |

The real finding is the composition, not the count: **38 of 65 open issues carried
`needs-human-input` — 58%**, and 37 of the 65 came from audits, 27 of those decisions. Agents close
everything else within hours. The label was the only thing on the board that accumulated, and it
pointed at one person.

## The four findings

**1. The feedback loop was silently dead for ten days.** `feedback` has produced **one issue in its
entire lifetime**. Distroless creates `/data/feedback` as `root:root`, the server runs as uid 65532,
and `feedback.go:178` is disk-first — so a failed write skips filing the GitHub issue too. Container
healthy, `/api/healthz` 200, every rider report from 2026-08-30 to 2026-09-09 discarded. #1730's fix
was open and green for 14 hours; merged as #1753, with the probe widened to cover `/data/feedback`
and not only `/data/tracks` — the very path the outage was about.

**2. `needs-human-input` had inverted its own purpose.** Its job is to stop an agent implementing one
side of an open question. Applied to a defect it does the opposite: **it protects the defect**,
because no agent may touch it and the maintainer never reaches it. #1507 — Strava activity ids
surviving a disconnect, against the §7.4 WATTROOM.md binds us to — sat behind it for that reason.
#1651 was ADR-0036's own wording quoted back at itself; #1399 was what ADR-0039 already refused;
#1025 resolved by ADR-0001 alone. The trigger had drifted to *"there are two plausible options"*,
which canon usually settles. #2052 → PR #2053 added a decidability test, and made asking the default
and filing the fallback.

**3. ADR-0001's freeze had no way to record a divergence.** WATTROOM.md §5 ends at M6; 155 M7 issues
have shipped and three of its statements are actively false. Correcting any of them either broke the
freeze or required changing it, which blocked #656 and five issues behind it. ADR-0050 splits
founding record from current state, defines an inline divergence annotation in two shapes — a
blockquote for prose, an inline marker for a table cell, since §2 is 48 table rows — and adds a
`docs` gate. Follow-up in #2055.

**4. Nothing enforces worktree hygiene.** AGENTS.md step 7 says clean up; **4.4 GB across seven dead
worktrees** said otherwise, one holding an unmerged, PR-less commit that would have been lost.
Reclaimed to 218 MB. Still outstanding: 68 stale local branches, 33 fully merged.

## Verified good — worth not re-litigating

- **CI.** Every job carries a comment naming the issue that justified it (#716, #814, #963, #1043,
  #1171). Path filters keep `e2e` and `desktop` off docs-only PRs; `cancel-in-progress` on pull
  requests but never on main; `changelog` split into its own workflow precisely so a label can clear
  it. A 2% failure rate is agents running `make ci` locally first, not a weak suite — 712 Go test
  functions, 1402 vitest tests, 22 e2e specs. **There is no fat here.** The opening hypothesis was
  wrong and the evidence is in the table above.
- **The safety boundary for unattended agents already holds.** Main has a ruleset, everything goes
  through a PR, nothing in this repo deploys. An agent restricted to draft PRs cannot reach
  production. ADR-0006's "no unattended write access" is more conservative than the machinery
  requires.
- **Per-worktree ports and databases** (#552) work exactly as documented.

## Proposed, not built

- **Route the model tier by path, not by task description.** The instinct in the brief — cheap models
  write, expensive models review — is backwards for this repo. The expensive bugs here are silent
  ones (root-owned volumes, out-of-order goose migrations, an unclaimed tab writing ERG at 1 Hz).
  None are caught by reading a diff; they are caught by whoever *wrote* it thinking about the
  deployed artifact. Expensive: `server/internal/hub`, `protocol`, `store/migrations`, `auth`,
  `web/src/lib/ble`. Cheap: `docs/`, `changelog.d/`, ADR amendments, doc-drift fixes, module splits
  (#1698). Once #2055 lands, the whole stale-doc cluster is cheap-tier work.
- **Give every accepted ceiling a probe.** ADR-0006 lists its ceilings explicitly; 50 ADRs do this. A
  ceiling with no probe is where the next ten-day silent outage lives — the distroless bug sat under
  one. #1753's image probe is the right shape; the cheapest next one is a daily job that posts a
  synthetic feedback report to production and fails if no issue appears. `POST /api/auth/synthetic`
  and a `synthetic-monitor` user already exist; the only scheduled workflow in the repo is the weekly
  vulncheck, so ADR-0006's production canary has a door and nothing walking through it.
- **`make worktree-gc`** — remove worktrees whose branch is merged and tree is clean, and *refuse* on
  unmerged commits so an orphan shouts instead of rotting.

## Noted, deliberately not filed as process changes

- **"Agents work forever" is not blocked on tooling or permission.** It was blocked on a queue that
  was 58% pointed at one person. 38 → 8 is the actual unblock; nothing else was needed.
- **A 7-day auto-adopt default was proposed and rejected** in favour of asking the maintainer while
  they are at the keyboard. That is now the rule in `audit/SKILL.md` step 8, and it is the better
  answer: a filed decision costs a context load to re-enter, an asked one costs a sentence.
- **35 audit documents now live in this directory.** The audit machine is the issue firehose, and
  that is fine as long as step 8's test holds. It is worth watching whether it does.

## Not checked

Nothing was run against production. The homelab repo owns deploying and was not read, so whether its
timer keys off the GitHub Release or the GHCR tag — which decides whether #1753's probe actually
gates a bad image — is unverified. Model-tier routing and the ceiling probes are proposals with no
implementation behind them. Codex's behaviour under the amended rules was not observed; only the
rule text was changed, in the vendor-neutral files it reads.
