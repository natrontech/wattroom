# 0001 — Record decisions as ADRs; WATTROOM.md is the founding set

- Status: accepted
- Date: 2026-07-16

## Context

The project started with an intensive decision phase: platform, stack, feature set, game design, privacy stance, and tooling were settled interactively and validated with deep research (see [RESEARCH.md](../RESEARCH.md)). Those ~35 decisions live in [WATTROOM.md](../../WATTROOM.md) as a table. As contributors join, future decisions need a home that captures *why*, survives Slack/PR archaeology, and can be proposed via PR.

## Decision

[WATTROOM.md](../../WATTROOM.md) is frozen as the founding decision record — it is edited only to mark a decision as superseded. Every decision from here on that changes architecture, protocol semantics, dependencies, product behavior, or tooling gets a numbered ADR in this directory, using [0000-template.md](0000-template.md), landing in the same PR as the change it explains. Contributors propose decisions the same way.

## Consequences

"Why did we do X?" has one answer path: WATTROOM.md table → ADR number. The founding document keeps its shape instead of becoming a changelog. Cost: small ceremony per decision — deliberately smaller than the decision itself.

## Amended 2026-09-10 (#656, [ADR-0050](0050-founding-record-and-current-state.md))

"WATTROOM.md is frozen as the founding decision record" now binds §§1–4 and 6–9 rather than the whole file: §5's scope and milestones move to `docs/ROADMAP.md` as current state, because a roadmap is a claim about the present and freezing one guarantees it goes false. "Edited only to mark a decision as superseded" gains a fixed shape — the inline divergence annotation ADR-0050 defines, which must name the issue or PR where the divergence happened.

The freeze itself is unchanged. A founding statement is still never deleted or rewritten, only annotated.

