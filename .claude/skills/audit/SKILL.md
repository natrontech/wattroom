---
name: audit
description: Audit a slice of WattRoom against its own intent — docs, ADRs, rules and code — and turn the findings into issues. Use for a broad sweep of a subsystem, not for reviewing one change.
---

# Audit a slice of the product

You are checking a subsystem against **what the project said it would build**, not just against
itself. WattRoom is unusually well specified — [WATTROOM.md](../../../WATTROOM.md) locks the
decisions, [docs/SPEC.md](../../../docs/SPEC.md) pins the numbers, `docs/decisions/` holds 26+ ADRs,
and [`.claude/rules/`](../../rules/) is the vendor-neutral canon. That is the baseline. A finding is
anything where intent, documentation and implementation disagree — in **either** direction.

This is not code review. `/code-review` reads a diff; this reads a subsystem and its history.

Worked example: [docs/audits/2026-09-04-non-riding.md](../../../docs/audits/2026-09-04-non-riding.md)
— one run, 62 issues, and the list of things checked and found sound.

## 1. Agree the slice and the exclusions first

An audit without a boundary becomes a sweep of the whole repo and finishes nothing well. Write the
slice down before starting: which areas are in, and what is explicitly out because it gets its own
pass. The 2026-09-04 run was "the whole website except the riding features", and naming the
exclusion is what kept seven parallel agents off the workout engine.

Ask for the boundary if the request does not carry one. Do not infer it.

## 2. Scout inline before fanning out

Cheap, and it shapes everything after: `gh issue list --state open`, `gh pr list --state merged
--limit 40`, `gh release list`, the directory tree, the largest files, and the open-issue titles.
Read WATTROOM.md, `docs/ARCHITECTURE.md` and the relevant ADRs **yourself**, now — you need them to
judge the findings later, and handing a condensed version to the agents stops seven of them each
re-reading the same 30 KB.

Check `git log` against the remote. A stale local main makes every finding suspect.

## 3. Fan out, one agent per area

One agent per area, sized to the plan the maintainer is on — **ask before spending a large fleet.**
Seven agents covered the non-riding half. Give every agent the same context block:

- the slice and the hard exclusion, repeated
- the condensed intent baseline from step 2, with pointers rather than pasted documents
- **rigor rules**: read the code before claiming anything; every finding cites `path:line`; no
  evidence, no finding; distinguish *broken* from *not built yet* from *drifted from the doc*; an
  absence is a finding only if the docs promise it or a user would hit it
- an explicit invitation to **question the locked decisions**, with evidence — a decision the code
  has quietly grown around is the most dangerous kind of finding, because the doc still reads as true
- a structured output schema: `title` (conventional-commit shaped), `severity`, `kind`, `evidence[]`,
  `problem`, `fix` — plus a `solid` field for what was checked and found fine

That last field matters. An audit that only reports damage tells you nothing about coverage, and the
next auditor re-litigates what this one already settled.

## 4. Verify the high-severity findings yourself — this is the gate

**Do not file an agent's high-severity finding without reading the code it cites.** Agents are
accurate about code and occasionally wrong about documents, and a confident wrong finding wastes a
maintainer's decision.

On 2026-09-04 an agent asserted that WATTROOM.md's milestone section was an established exception to
[ADR-0001](../../../docs/decisions/0001-adrs-and-founding-decisions.md)'s freeze. It is not — the ADR
says the file "is edited only to mark a decision as superseded", with no exemption. Verifying it
turned "update the stale roadmap" into "decide how a founding document records a divergence at all",
which is a different and much better issue.

Spot-check the rest. Say in the report which findings you verified and which you did not.

## 5. Dedupe across areas before filing

Two agents looking at the same bug from different sides produce two findings. The 2026-09-04 run had
two such pairs — the chat ban hole (lounge + server) and the display-name presence bug (lounge +
hub). Merge them into one issue and fold the second agent's evidence in as extra context; it is
usually the better half of the report.

## 6. File by a rule, not by feel

Pick a rule, state it, apply it. **`kind is bug OR severity is high`** worked well: it is arguable,
it splits cleanly, and it puts the boundary in the open where the maintainer can move it.

Every issue must stand alone — someone opening it in three months has none of this conversation:

- **What is broken** — the symptom a user or maintainer hits, not the code smell
- **Evidence** — the `path:line` refs
- **Proposed fix** — concrete, naming files and functions
- **Provenance footer** — which audit, which commit, and that it was read-only and unverified in a
  running app

Before creating anything: `gh issue list --search`, `gh pr list`, `git worktree list`, per
[AGENTS.md](../../../AGENTS.md). An audit is exactly the situation that generates duplicates.

Add sequencing notes where one issue must precede another — "land the three bugs in this file before
splitting it", "do the bundle fix first or this measurement is not attributable". They cost a line
and save a collision.

## 7. Everything else gets triaged, not dumped

The findings that miss the rule are still real. Put them somewhere durable, then work through them
with the maintainer rather than filing 40 issues nobody committed to. Whatever is left unfiled needs
a home that is not a chat message.

## 8. Separate the decisions — never implement them

Some findings are product, privacy, legal or process **decisions**. An agent must not settle them by
picking the option that is easiest to build. Bring each one to the maintainer with three parts:

1. **What was found** — stated without assuming any context
2. **Why it needs their input** — what makes it a judgement rather than a defect, and what you
   genuinely cannot decide for them
3. **Options, with a recommendation and its reasoning** — including the option of doing nothing

Label the resulting issues **`needs-human-input`** and say in the body that an agent must not build
it as written. Several of these are the maintainer's own first reaction, offered as a starting
position — the label is what stops that reaction being implemented as settled law.

When the answer arrives, follow it exactly. Several answers split into two issues (a code change plus
a record of the divergence; a fix plus the question it exposes) — that is normal, not scope creep.

## 9. Close the loop

- Comment on **adjacent existing issues** whose ground has moved, so blocked work is not picked up
  against a stale assumption. The 2026-09-04 run left notes on five.
- Cross-link issues that gate each other, in both directions.
- Record what was checked and found **sound** in the audit document. It is the part that stops the
  next audit re-deriving the same conclusions.
- Leave the canonical clone on `main` with no stray files. The audit document belongs in
  `docs/audits/`, not the repo root.

## Stop conditions

- **No boundary agreed** → ask for one; do not guess the slice.
- **A finding you cannot evidence** → drop it or mark it explicitly as unverified. A plausible
  finding with no `path:line` is worse than silence: it costs a maintainer a read to disprove.
- **A decision disguised as a bug** → step 8, always. Filing it as a bug invites an agent to
  implement one side of an open question.
