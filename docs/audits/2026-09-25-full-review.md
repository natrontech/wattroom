# Audit: the whole codebase — 2026-09-25

> **In progress.** This draft holds the claim while the review runs. The findings, the filed issues and the sound/not-checked lists land in this file before the PR is marked ready.

**The slice.** `server/`, `web/src/`, `desktop/`, `deploy/`, `scripts/`, `.github/workflows/`, `Makefile`, `Dockerfile` and the migrations. The docs are both the baseline and a subject, for drift.

**Excluded**:

- Generated code as a subject: `web/src/lib/protocol.ts` and `server/internal/store/db/*.sql.go`. The Go structs and the `.sql` queries that generate them were reviewed instead.
- The `/dev/*` mock routes, except as evidence of what the kit offers.
- Real-hardware BLE behaviour. No trainer was attached, so the FTMS code was read and the simulated trainer ridden.
- Strava payloads, which were never read (AGENTS.md hard rule). The integration code was read.
- Production (wattroom.ch) and `janlauber/homelab`, which were never touched.

**Method.** Read-only, at `ab669885`. One capture agent, ten lens reviewers and one adversarial verifier per critical, high, security or privacy finding.
