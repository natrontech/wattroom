# 0006 — Ride feedback: in-app flag → GitHub issue → agent fix → deliberate deploy

- Status: proposed; the deploy half partially superseded by [ADR-0019](0019-tagged-releases-and-a-self-converging-vm.md)
- Date: 2026-08-29

> **ADR-0019 (2026-08-31)** replaces the "One environment, deliberate deploys"
> paragraph below: the VM converges on a tag pinned in the homelab repo rather
> than waiting for `make sync-wattroom` from the Mac, and rolls itself back when
> a deploy fails its health gate. Everything else here stands — capture, the
> replayable trace, intake, the human-started agent, one Prometheus for the
> homelab, and snapshot-before-mutate.

## Context

The alpha's success signal is the crew choosing WattRoom weekly ([WATTROOM.md](../../WATTROOM.md) §Validation). That only works if the gap between "something felt wrong on the bike" and "it's fixed next Tuesday" is short and needs no effort from the rider. The rider is mid-interval, sweating, three metres from the screen — they will not write a bug report, most of them have no GitHub account, and by the evening they've forgotten which lap it happened on.

Everything the loop needs already exists in pieces: `/metrics` and slog JSON on the server, `SimulatedTrainer` behind the `Trainer` interface (#1), a Playwright smoke that rides a workout end-to-end (#6), 15 mocked screens under `/dev`, and a homelab control plane whose conventions (repo-is-truth, `make sync-<stack>`, snapshot-before-mutate, Prometheus as the one metrics system, nothing auto-pulls) already answer the ops half. What's missing is the wiring, not the parts.

## Decision

**Capture is one button, zero typing.** The ride dashboard keeps a bounded client-side ring buffer — ~120 s of ticks, WS/BLE state transitions, console errors — and a huge `⚑` flag control. A tap stamps a marker with the buffer and the rider keeps pedalling; no dialog, no permission prompt, nothing modal during a ride ([ux.md](../../.claude/rules/ux.md)). The post-ride card lists that ride's flags and invites one optional line each.

**The payload is a replayable trainer trace.** The captured power/cadence/HR series feeds back into `SimulatedTrainer` as a replay fixture, so every accepted report becomes a deterministic Playwright regression test. This — not pixels — is the artifact that makes a report actionable, and it is why no client-side screenshot capture is built: the agent reproduces from the trace and screenshots the real thing, attaching a before/after pair to the PR.

**Server enrichment without a log stack.** A `slog.Handler` tees into a bounded per-session ring buffer. At intake the server staples the session's own log lines, the build SHA, hub state, and a Grafana deep-link windowed on the incident onto the report.

**Intake writes to disk, then to GitHub.** `POST /api/feedback` validates at the boundary ([errors.md](../../.claude/rules/errors.md)), appends the report as JSONL to disk so a GitHub outage cannot lose it, then opens an issue labelled `feedback` with the payload gzipped in a `<details>` block. Reports fingerprint on (build SHA, first error, route): a matching open issue gets a comment instead of a duplicate, so one bad interval during a group ride produces one issue, not eight.

**One agent, started by a human.** Fixes are worked by a Claude Code `/loop` session Jan starts, one issue at a time, in a git worktree, ending in a draft PR carrying the regression test. No cron, no self-hosted runner, no unattended write access. The loop's instructions live in the repo as rules + a skill, vendor-neutral like the rest of `.claude/rules/`.

**One environment, deliberate deploys.** Production is `wattroom.ch` on a single VM per [ADR-0002](0002-single-vm-compose-deploy.md), deployed the way every other homelab workload is: CI publishes a GHCR image, the homelab repo pins the digest, the Mac drives `make sync-wattroom`. The VM pulls nothing on its own and nothing inbound is exposed beyond 443 and LiveKit's UDP media range. Snapshot before a deploy, `pg_dump` before a migration, forward-only migrations that survive one image rollback.

**The health check that counts is a ride.** HTTP 200 on the homepage proves nothing about whether a ride works. The #6 Playwright ride runs against production on a timer and pushes pass/fail plus duration to the existing pushgateway; the subsystem metrics that go quiet first — ticks per second per room, rides started vs completed — get the alerts. One test artifact, three jobs: CI check, pre-deploy gate, production synthetic.

## Consequences

Easier: a report costs the rider one tap and costs the fixer no archaeology, because the trace, the logs and the metrics window arrive together. Reproduction is deterministic rather than "worked on my machine". Nothing new is introduced on the ops side — the deploy is the homelab's existing stack pattern, the monitoring is the homelab's existing Prometheus, and the regression test is a test that already runs.

Harder: a report is an export of that rider's ride telemetry to a third party, against a "rides private by default" promise. Capture must say so in plain words at the moment of the tap, and the payload carries only the reporter's own data — never the room's.

Accepted ceilings, each with its upgrade trigger. Session logs are in-memory and die with the process — add Loki when a report needs logs older than the current server. Reports go to disk as JSONL with no database — add a table when there are enough to want queries. There is no staging environment, so a fix is proven by tests and local verification, and production is the first place it meets a real trainer — add `beta.wattroom.ch` when a bad deploy lands on a real ride. The agent runs only while a human is watching, so nothing progresses overnight — move to a scheduled headless run when the queue outgrows the attention. Nobody is told their report shipped except by reading the issue — add a notification when riders stop reporting. Screenshots exist only when the agent reproduces, so a browser- or GPU-specific rendering bug that reproduces nowhere else has no picture — that class of bug is the trigger for client-side capture, not a reason to build it now.
