# 0019 — Releases are tags; the VM converges on a pinned tag and rolls itself back

- Status: accepted
- Date: 2026-08-31
- Supersedes: [ADR-0006](0006-alpha-feedback-loop.md)'s "One environment, deliberate deploys" paragraph. The rest of ADR-0006 — capture, the replayable trace, intake, the human-started agent — is untouched.
- Amends: [ADR-0002](0002-single-vm-compose-deploy.md), whose deploy path was "`git pull && docker compose up -d` (or a small deploy script/action)". This is that script, specified.

> **Amended 2026-09-01.** This ADR originally decided there would be no
> `CHANGELOG.md` — GitHub's `--generate-notes` was to be the changelog, on the
> grounds that conventional-commit squash titles make one for free. That is a
> commit-log dump, which [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
> names as a bad practice for the reason that matters here: a changelog is read
> by a person deciding whether to upgrade, and squash titles are written for
> reviewers. The rest of the decision is unchanged; only who writes the notes
> is. See the "changelog is written, not generated" paragraph below.

> **Amended again 2026-09-01.** The self-converging deploy is **not in this
> repo**. It lives with the operator, in `janlauber/homelab`, as carve-out 2 of
> that repo's update policy — modelled on the `stutz` auto-updater it already
> had. Two earlier amendments here (the homelab pin, then GHCR tracking) were
> written against a production this repo had guessed at: the app's
> `deploy/docker-compose.prod.yml` is not what runs, its Caddy is dropped
> because an edge proxy owns 80/443, and its Prometheus is dropped because the
> homelab has one metrics system. `deploy/` remains the self-hosting reference
> and the source of the alert rules; **releases are this repo's job, deploying
> them is the operator's.** Everything below about tags, changelogs, gates and
> expand/contract still stands — those are release properties, not deploy ones.

## Context

Jan is the only person with access to the homelab. Every deploy, every rollback, and every "did that break something" is therefore gated on his attention, and a deploy costs enough attention to be worth skipping — which is how a project ends up with a production running an image nobody can name.

Four gaps make the current path unsafe rather than merely tedious:

- **Nothing pins a version.** `publish.yml` moves `:main` on every push to main. There is no previous tag to go back to; a rollback means excavating a SHA from an Actions log. Rollback is not slow today, it is absent.
- **`/api/healthz` is not a health check.** [`server/main.go:76`](../../server/main.go) writes `ok` unconditionally, with no database ping. It is what `maintenance.html` polls and what any deploy gate would poll.
- **Alerts reach nobody.** The stack runs its own Prometheus with no Alertmanager, and two of the three rules in `deploy/alerts.yml` watch `wattroom_synthetic_ride_*` — a metric nothing produces, because the synthetic timer that `deploy/.env.example` already promises was never built. Production could be dead right now and nothing would say so.
- **Nothing snapshots before a deploy.** The nightly `pg_dump` is 14 days deep and up to 24 hours stale at the moment it matters most.

The binding technical constraint is the schema. `store.Open` runs goose at boot, so a deploy migrates itself, and migrations are forward-only in practice. Rolling the *image* back to N−1 leaves the schema at N: harmless for an added column, fatal for a dropped one. Any rollback story that ignores this is decoration.

ADR-0006 named the homelab's conventions — repo-is-truth, `make sync-<stack>`, snapshot-before-mutate, Prometheus as the one metrics system, nothing auto-pulls — and adopted all five. Three survive this ADR unchanged and one gets sharper. The one that does not survive is the Mac being the transport: `make sync-wattroom` is exactly the manual step whose cost this ADR exists to remove.

## Decision

**A release is a tag, cut by hand.** `make release` promotes the changelog through a release PR — main's ruleset rejects direct pushes and requires zero approvals, so the script opens it, merges it, and tags the resulting commit; tags themselves are unprotected — `publish.yml` has a tag trigger that builds `:2026.09.1` from the existing Dockerfile and cuts the GitHub Release from that changelog section. `:main` keeps building on every push, for testing; only tags are deployable.

**Versions are CalVer, `YYYY.0M.MICRO`** (amended 2026-09-01). MICRO is computed from the tags already in this month, so `make release` takes no argument. SemVer would be answering a question WattRoom does not have: there is no public API with downstream consumers to promise compatibility to, one VM runs one release, and the compatibility that actually matters — can I roll back — is guaranteed structurally by expand/contract migrations rather than by a version digit. What a CalVer number cannot say is "this one breaks something"; the changelog's Changed and Removed headings carry that, which is the other half of why they are written by hand.

**The changelog is written, not generated** (amended 2026-09-01, see the note above). `CHANGELOG.md` follows [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/): every PR adds one line to `## [Unreleased]` under the heading that fits, and `make release` promotes that section into a dated release and opens a fresh one, refusing outright when it is empty. The release body is that same section, so the file and the GitHub Release cannot disagree. Promotion happens *before* the tag, so a tag always points at a tree whose changelog already describes it.

**The VM converges on the newest published release** (amended 2026-09-01; this paragraph originally read "the deployed tag is pinned in the homelab repo"). No homelab repo existed to hold that pin, and standing one up to store a single line bought ceremony rather than safety — so the VM reads the highest CalVer tag from the registry it already authenticates to, and no second credential appears anywhere. What this gives up is repo-is-truth: what production runs is no longer a commit with an author and a date, and a deliberate rollback is `WATTROOM_PIN` in the VM's `.env` rather than `git revert`. That same field is what a failed health gate writes, so an automatic rollback cannot be undone five minutes later by a timer finding the same broken tag still newest. The original reasoning below still describes the intent.

**~~The deployed tag is pinned in the homelab repo, and the VM converges on it.~~** Repo-is-truth is preserved: what production is running is a line in git with a commit author and a date, not a fact in Jan's memory. Promotion is a one-line commit, doable from a phone; rollback is `git revert` of that commit. The VM pulls, but it pulls the repo's stated intent — never "whatever is newest" — which is the half of "nothing auto-pulls" worth keeping. Build and blessing stay separate events.

**The updater is a systemd timer and a shell script in `deploy/`**, on a five-minute cadence. In order: read the pin; if it matches `CURRENT`, exit. If `wattroom_room_riding > 0`, exit — a rider mid-interval is never interrupted for a deploy. *(As accepted this named `wattroom_room_riders`, on the assumption the metric already existed. It counts anyone holding a room socket, riding or not, so the guard would never have opened while someone left a tab in a room — #328. #372 added `wattroom_room_riding`, riders with a sample in the last 10s, and the updater reads that with the old gauge as fallback.)* Then `pg_dump` to the existing backup directory, write `PREVIOUS`/`CURRENT`, `docker compose up -d wattroom` at the new tag, and poll `/api/version` until it reports that tag, then `/api/healthz`. On success, notify. On timeout or failure, retag to `PREVIOUS`, `up -d`, and alert loudly. Roughly fifty lines of shell; no daemon, no agent framework, no Watchtower (which has neither health gating nor rollback).

**Rollback is an image tag, never the database.** The updater is forbidden from restoring a dump. A restore discards every ride recorded since that dump, which is a worse outcome than the bug being rolled back from, and it is not a decision a five-minute timer gets to make at 3am. `pg_dump` before a deploy is insurance for a human; restoring it is a deliberate break-glass path with a person present.

**Migrations are expand/contract, and this is a hard rule.** A release only adds — nullable columns, new tables, new indexes. Dropping or renaming happens one release *after* the release whose code stopped using the thing. This is the single load-bearing rule of the whole document: it is the only reason retagging to `PREVIOUS` is safe, and every other guarantee here is downstream of it. It sharpens ADR-0006's "forward-only migrations that survive one image rollback" from an aspiration into a review criterion.

**Monitoring moves to the homelab's Prometheus and Alertmanager.** The `prometheus` service, `deploy/prometheus.yml`, and `deploy/alerts.yml` leave this repository; the homelab scrapes `wattroom:8080` and the rules live next to every other alert Jan owns, with a routing path to his phone that already works. This is ADR-0006's "Prometheus as the one metrics system" applied literally — one Prometheus, not one per workload. Caddy stops proxying `/metrics` to the public internet, which it does today: rider counts and runtime internals are currently a `curl` away on a project whose canon is that privacy is architecture.

**`/api/healthz` learns to ping the database, and `/api/version` learns to report the tag.** Both are a handful of lines, and every gate in this document is worthless without them: the first makes "healthy" mean something, the second is the updater's proof that the image it asked for is the image now serving.

**The deep check stays the synthetic ride.** ADR-0006 specified one test artifact with three jobs and only the CI job was built; the Playwright config already accepts a deployed target and `POST /api/auth/synthetic` already exists to let it in. It gets the systemd timer `deploy/.env.example` already assumes, and a pushgateway to report into, which makes the two orphaned alert rules true as written.

## Consequences

Easier. Deploying is a one-line commit from anywhere, including a phone, and Jan never opens an SSH session to ship. Rollback is `git revert` plus five minutes of convergence, on the same path, with no special knowledge recalled under stress. What production is running is answerable from git history. A deploy that fails to come up healthy repairs itself instead of waiting to be noticed. And the alerting that has been notionally configured since #55 starts actually firing at a human.

Accepted, each with its trigger:

- **The VM holds a deploy key and reaches out on a timer.** New outbound surface and a credential on the box, against a homelab convention that nothing auto-pulls. Accepted for one private repo and one developer; revisit if the VM ever hosts something that is not WattRoom.
- **Cutting a release is two commits** — the tag here, the pin bump there. Deliberate: the pin bump *is* the promotion gate. If it turns out to be friction rather than ceremony, teaching the pin file to accept the literal `latest` is a two-line change. Not built now.
- **Expand/contract is enforced by nobody.** A migration that drops a column passes CI and breaks rollback silently, discovered only when a rollback is attempted — the worst possible moment. Accepted because the alternative is a schema-diff check nobody has written; the first time it bites is the trigger to write one.
- **Auto-rollback only covers "the new image did not come up healthy."** An image that comes up fine and is subtly wrong is caught by the 30-minute synthetic, and the response to that is a human reverting the pin. Automated recovery deliberately stops at the boundary where "broken" stops being mechanically decidable.
- **A release can sit undeployed through a long group ride.** That is the rider guard working, not failing.
- **The updater moves only the wattroom image.** Postgres, LiveKit, and Caddy stay pinned and are bumped by hand, deliberately, with a human watching.
- **Still no staging.** ADR-0006 accepted this and named `beta.wattroom.ch` as the trigger; nothing here changes that, though a self-healing deploy lowers the cost of not having one.

Revisit trigger: a second person with VM access, or the first time an automatic rollback makes an incident worse instead of better.
