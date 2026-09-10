# 0050 — Founding record and current state are different documents

- Status: accepted
- Date: 2026-09-10

## Context

[ADR-0001](0001-adrs-and-founding-decisions.md) froze [WATTROOM.md](../../WATTROOM.md) as the founding decision record — "it is edited only to mark a decision as superseded". The freeze is why that file is still trustworthy about *why* things were decided, and it should not be quietly dropped.

But the file does two jobs. Most of it records decisions and their arguments, which stay true as history whatever ships afterwards. §5 records **scope and milestones**, which is a claim about the present — and the present moved. M6 closed on 2026-08-29 and 155 M7 issues have shipped since; §5 mentions none of them. Three of its statements are now actively false: `WATTROOM.md:219` ticks off the switchable layouts [ADR-0020](0020-the-app-takes-discords-shape.md) retired, `:243` names the Jam card [ADR-0018](0018-one-music-surface-drop-the-jam-card.md) deleted, and `:251` lists four "explicitly not MVP" fast-follows that have shipped.

Under ADR-0001 as written, correcting any of them either breaks the rule or requires changing it. #656 records the conflict; #654 has been holding an edit to the Devices and iOS rows waiting on the answer.

The marking that does exist is inconsistent. Some rows carry a struck-through phrase and "Superseded by ADR-xxxx", some carry "Amended by", and the three false claims carry nothing at all. None of the shapes reliably says **where** the divergence happened.

## Decision

**Two classes of document, and a file belongs to exactly one.**

*Founding record* — frozen, edited only to annotate a divergence: WATTROOM.md §§1–4 and 6–9, and every ADR in this directory. They describe what was decided and why, and stay true as history.

*Current state* — maintained freely, no ceremony: `README.md`, `docs/ROADMAP.md`, [docs/SPEC.md](../SPEC.md), [docs/ARCHITECTURE.md](../ARCHITECTURE.md) and the rules in `.claude/rules/`. They describe what the product is now and are expected to change without an ADR.

**WATTROOM.md §5 moves to `docs/ROADMAP.md`** and becomes current state. A roadmap is a claim about the present; freezing one guarantees it goes false, and guarantees the freeze gets broken to fix it. §5's place in WATTROOM.md keeps a pointer and a divergence annotation, so the founding record still says a roadmap was part of the founding set, and where it went.

**A divergence is annotated at the statement it corrects, never in a ledger elsewhere.** Someone reading WATTROOM.md gets the correction at the point of the error; a ledger only helps a reader who already knows to go and check one.

The founding record comes in two shapes, so the annotation does too.

*Prose and bullets* — §§5–9, and where the three false claims live — take a blockquote immediately below the statement:

> **Diverged 2026-09-10 (#2055, [ADR-0020](0020-the-app-takes-discords-shape.md))** — the app took Discord's shape and a room now has one riding surface, so the switchable layouts this line ticks off were retired.

*Table cells and list items* — §2's decision table is 48 rows, and the ADRs are largely bulleted — take the marker inline, because a blockquote cannot live inside a table row and ends a list rather than continuing it. The rule generalises: a blockquote wherever a block can live, inline wherever it cannot. This extends the convention the table already uses: strike the superseded phrase, then

`**Diverged 2026-09-10 (#1236, ADR-0038)**: rooms are channels a crew member walks into and have no codes of their own.`

Three parts either way, all required: the ISO date; **at least one issue or PR number, or an ADR reference** — the *where*; and the argument in plain words. Exactly one of the six markings in the file today carries a reference at all (`WATTROOM.md:68`, `(#1236)`), and that gap is why this has a format instead of a habit. The statement above or beside the marker is left standing: it is what was decided, and deleting it is the thing the freeze exists to prevent.

`ci.yml`'s `docs` job checks the shape — every divergence marker in the founding record, in either form, carries an ISO date and at least one `#nnn` or `ADR-nnnn`. Same shape as the ADR-number, index and link checks already there.

**Who may edit what.** Current-state documents: anyone, any PR, like code. Founding record: an annotation only, and the annotation names the PR that earned it. Moving a section from one class to the other is itself an ADR.

## Consequences

Easier: WATTROOM.md can stop being false without anyone breaking a rule to fix it. #654 unblocks, and the five issues parked behind #656 — #653, #1011, #1650, #1694, #1829 — become mechanical amendments an agent writes rather than decisions waiting on a person. A reader gets the correction where the error is, and "why did we do X, and what happened to it?" stays one file.

Harder: two classes to keep straight, and a new document's class has to be decided when it is created. The line is genuinely blurry inside SPEC.md — it is listed as current state because its numbers are read by code and must be able to change, and because [AGENTS.md](../../AGENTS.md) already treats it as the live authority on product numbers.

Accepted ceilings, each with its trigger. The CI check validates the annotation's *shape*, never whether the argument is sound or the issue link is the right one — a reviewer does that, and no check can. Nothing detects a founding statement that has quietly gone false with no annotation at all; that is what an audit is for, and it is how §5 was caught — add a check when an audit misses one. Nothing rewrites the inconsistent markings already in the file: they are legible, the format binds going forward, and churning them would bury the annotations that carry real arguments.
