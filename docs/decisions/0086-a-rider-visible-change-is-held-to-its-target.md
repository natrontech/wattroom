# 0086 — A rider-visible change is held to its target

- Status: accepted; settles [#3665](https://github.com/natrontech/wattroom/issues/3665)
- Date: 2026-09-30
- Beside: [0005](0005-synthwave-visual-identity.md) (the cave and the glow rule, which the global rules check), [0071](0071-the-bike-computer-pages-slot-3.md) (the page control and PgUp/PgDn, standing deviations D14 and D15)
- Decided by Jan, 2026-09-30, in the design audit: "we need a mockup / design comparison verification during implementation"

## Context

Agents build rider-facing screens from an issue's text, and their own tests
pass. The screens that come out are often ugly and do not connect with each
other, and nobody compares them with the targets Jan chose before a PR is
marked ready. Tests show that a page is correct. They cannot show that it
looks right. The audit of 2026-09-30 collected the targets, one per surface,
into [docs/design/TARGETS.md](../design/TARGETS.md) (#3664). This ADR makes
them binding.

## Decision

### Every rider-visible PR is held to its surface's target, by a reviewer it does not steer

- A PR that changes what a rider sees carries a **Design check** section before it leaves draft. That is the same line the `no-changelog` label draws. The procedure is [docs/design/DESIGN-CHECK.md](../design/DESIGN-CHECK.md).
- The surfaces come from the issue and from the surface map, never from the author's judgement.
- The captures and their measurements come from the capture run, never from the author's notes.
- The reviewer:
  - is a fresh session that has not seen the diff or the intent;
  - builds its own checklist from TARGETS.md;
  - defaults to FAIL.
- An author never reviews their own change.
- At most three rounds. A blocker or major left after the third keeps the PR in draft. The issue then names the two canon lines that conflict and goes to Jan.

### Precedence: canon over target over app

- Canon is WATTROOM.md, `docs/decisions`, `docs/SPEC.md` and `.claude/rules`. Canon beats the target, and the target beats today's app.
- A mock that breaks canon is not copied where it breaks it.
- A must-match item that turns out to be wrong is changed in its own PR, citing the canon line that shows it wrong. It is never edited to make a round pass.

### The standing deviations live in TARGETS.md

Where canon already answered a question a mock left open, the answer is recorded once in TARGETS.md as a standing deviation, D1 onward. A reviewer never flags one, and an implementer never copies the mock where it breaks one. Among them:

- **D7.** The primary button stays the kit's ink `btn-primary`. Neon is structure, never a filled call to action.
- **D14.** PgUp and PgDn are Harder and Easier and never turn a page.
- **D15.** The bike computer's page control is “← name →” with position dots, on every layout.

## Consequences

- A rider-visible PR takes longer, by a capture and up to three reviews. The first review usually finds something the author could not see.
- A surface without a target gets one in the PR that first changes it: an id, a capture recipe, and a must-match list. The system grows through the PRs that need it.
- The rule sits where every contributor reads:
  - AGENTS.md's reading list and its definition of done;
  - `.claude/rules/ux.md`;
  - the PR template;
  - for Claude, the `design-check` skill.
